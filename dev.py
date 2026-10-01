#!/usr/bin/env python3
"""Interactive dev launcher for the SE4AS stack (macOS and Windows).

Stdlib only, Python >= 3.9. Start it with ./dev.command (macOS) or dev.bat (Windows),
or directly with `python3 dev.py`. Everything goes through `docker compose`, so it
works the same with Docker Desktop and OrbStack.
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MOSQUITTO = "iot_mosquitto"
SCENARIOS_FILE = ROOT / "simulator" / "scenarios.py"

ALL_SERVICES = ["influxdb", "mosquitto", "grafana", "nodered", "sensors", "analyzer",
                "ui", "planner", "simulator", "view"]

PRESETS = {
    "view": {"label": "Vista 3D (mosquitto + simulator + view)",
             "services": ["mosquitto", "simulator", "view"]},
    "mapek": {"label": "Pipeline MAPE-K senza Node-RED",
              "services": ["influxdb", "mosquitto", "grafana", "sensors", "analyzer",
                           "planner", "ui", "simulator", "view"]},
    "full": {"label": "Stack completo (Node-RED con Telegram disattivato)",
             "services": list(ALL_SERVICES)},
}

URLS = {
    "view": "http://localhost:8080",
    "grafana": "http://localhost:3000",
    "ui": "http://localhost:8501",
    "nodered": "http://localhost:1880",
    "influxdb": "http://localhost:8086",
}

TARGET_HINTS = {
    "apartment": "id appartamento, es. A-2-1",
    "complex_or_building": "'complex' oppure un palazzo, es. B",
    "sensor": "id sensore (vedi la scheda di dettaglio nella vista 3D)",
    "actuator": "id attuatore (vedi la scheda di dettaglio nella vista 3D)",
}


# ---------------------------------------------------------------- pure helpers

def parse_env(text: str) -> dict:
    """Minimal .env parser: KEY=VALUE lines, '#' comments, optional surrounding quotes."""
    env = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def parse_selection(raw: str, count: int) -> list:
    """'3, 1 3' -> [1, 3]. Raises ValueError on empty input or out-of-range items."""
    items = raw.replace(",", " ").split()
    if not items:
        raise ValueError("nessuna scelta")
    picked = set()
    for item in items:
        if not item.isdigit() or not 1 <= int(item) <= count:
            raise ValueError(f"scelta non valida: {item}")
        picked.add(int(item))
    return sorted(picked)


def compose_env(base: dict, telegram_live: bool) -> dict:
    """Environment for docker compose: Telegram silenced (chat id 0) unless explicitly live."""
    env = dict(base)
    if not telegram_live:
        env["TELEGRAM_CHAT_ID"] = "0"
    return env


def up_command(services: list, build: bool = True) -> list:
    return ["docker", "compose", "up", "-d"] + (["--build"] if build else []) + list(services)


def mqtt_auth(env_file: dict) -> list:
    return ["-u", env_file.get("MQTT_USERNAME", ""), "-P", env_file.get("MQTT_PASSWORD", "")]


def mqtt_pub_command(env_file: dict, topic: str, payload: dict) -> list:
    return (["docker", "exec", MOSQUITTO, "mosquitto_pub"] + mqtt_auth(env_file)
            + ["-q", "1", "-t", topic, "-m", json.dumps(payload)])


def load_scenarios(path: Path) -> dict:
    """{scenario name: target kind}, read from the simulator's SCENARIOS literal without importing it."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        value = getattr(node, "value", None)
        targets = node.targets if isinstance(node, ast.Assign) else [getattr(node, "target", None)]
        if isinstance(value, ast.Dict) and any(getattr(t, "id", None) == "SCENARIOS" for t in targets):
            catalog = {}
            for key, spec in zip(value.keys, value.values):
                fields = {k.value: v for k, v in zip(spec.keys, spec.values)}
                catalog[key.value] = fields["target"].value
            return catalog
    raise ValueError(f"SCENARIOS non trovato in {path}")


def default_target(kind: str):
    return "complex" if kind in ("complex", "complex_or_building") else None


def scenario_start_payload(name: str, target: str, params) -> dict:
    payload = {"action": "start", "scenario": name, "target": target}
    if params:
        payload["params"] = params
    return payload


def parse_active_scenarios(raw: str) -> list:
    try:
        return list(json.loads(raw).get("active", []))
    except (ValueError, AttributeError):
        return []


# ---------------------------------------------------------------- process helpers

def _resolve(cmd: list) -> list:
    # shutil.which finds npm.cmd / uv.exe on Windows, so no shell=True is needed.
    return [shutil.which(cmd[0]) or cmd[0]] + list(cmd[1:])


def run(cmd: list, env: dict = None, cwd: Path = None) -> int:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    try:
        return subprocess.call(_resolve(cmd), env=env, cwd=cwd or ROOT)
    except FileNotFoundError:
        print(f"!! comando non trovato: {cmd[0]}")
        return 127
    except KeyboardInterrupt:
        print("\n(interrotto)")
        return 130


def capture(cmd: list, timeout: float = 15) -> str:
    try:
        out = subprocess.run(_resolve(cmd), cwd=ROOT, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout)
        return out.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        raise SystemExit(0)
    return answer or default


def confirm(prompt: str, default: bool = False) -> bool:
    answer = ask(f"{prompt} ({'S/n' if default else 's/N'})").lower()
    return default if not answer else answer in ("s", "si", "sì", "y", "yes")


def choose(title: str, options: list) -> int:
    """Numbered menu; returns the 0-based index or -1 for 'back'."""
    print(f"\n{title}")
    for i, label in enumerate(options, 1):
        print(f" {i:>2}) {label}")
    print("  0) Indietro")
    answer = ask("Scelta")
    if answer.isdigit() and 1 <= int(answer) <= len(options):
        return int(answer) - 1
    return -1


def pause() -> None:
    ask("\nInvio per tornare al menu")


# ---------------------------------------------------------------- the launcher

class Launcher:
    def __init__(self) -> None:
        env_path = ROOT / ".env"
        self.env_file = parse_env(env_path.read_text(encoding="utf-8")) if env_path.exists() else {}
        self.uv = shutil.which("uv")

    # -- stack ----------------------------------------------------------------

    def services(self) -> list:
        listed = capture(["docker", "compose", "config", "--services"]).split()
        return listed or list(ALL_SERVICES)

    def pick_service(self, title: str):
        names = self.services()
        index = choose(title, names)
        return names[index] if index >= 0 else None

    def start(self, services: list) -> None:
        live = False
        if "nodered" in services:
            print("\n!! Node-RED inoltra gli allarmi su un canale Telegram REALE.")
            live = confirm("Usare il canale reale? (No = TELEGRAM_CHAT_ID=0)")
        if run(up_command(services), env=compose_env(os.environ, live)) != 0:
            print("\n!! Avvio fallito: controlla che Docker (Docker Desktop / OrbStack) sia acceso.")
            pause()
            return
        urls = [URLS[s] for s in services if s in URLS]
        if urls:
            print("\nPronto:")
            for url in urls:
                print(f"  {url}")
            if confirm("Aprire nel browser?", default=True):
                for url in urls:
                    webbrowser.open(url)
        pause()

    def start_preset(self, key: str) -> None:
        self.start(PRESETS[key]["services"])

    def start_manual(self) -> None:
        names = self.services()
        print("\nServizi disponibili:")
        for i, name in enumerate(names, 1):
            print(f" {i:>2}) {name}")
        try:
            picked = parse_selection(ask("Numeri separati da spazio (es. 2 9 10)"), len(names))
        except ValueError as exc:
            print(f"!! {exc}")
            return
        self.start([names[i - 1] for i in picked])

    def status(self) -> None:
        run(["docker", "compose", "ps"])
        pause()

    def logs(self) -> None:
        name = self.pick_service("Log di quale servizio? (Ctrl+C per uscire)")
        if name:
            run(["docker", "compose", "logs", "-f", "--tail", "100", name])

    def manage(self) -> None:
        options = ["Ferma tutto (stop, i container restano)",
                   "Butta giù tutto (down, rimuove i container; i dati restano)",
                   "Ferma un servizio",
                   "Riavvia un servizio",
                   "Ricostruisci e riavvia un servizio (dopo modifiche al codice)"]
        index = choose("Gestione stack", options)
        if index == 0:
            run(["docker", "compose", "stop"])
        elif index == 1 and confirm("Sicuro di voler rimuovere tutti i container?"):
            run(["docker", "compose", "down"])
        elif index in (2, 3, 4):
            name = self.pick_service("Quale servizio?")
            if not name:
                return
            if index == 2:
                run(["docker", "compose", "stop", name])
            elif index == 3:
                run(["docker", "compose", "restart", name])
            else:
                run(up_command([name]), env=compose_env(os.environ, False))
        else:
            return
        pause()

    # -- MQTT -----------------------------------------------------------------

    def publish(self, topic: str, payload: dict) -> bool:
        if run(mqtt_pub_command(self.env_file, topic, payload)) == 0:
            return True
        print("!! Pubblicazione fallita: mosquitto e simulator sono avviati? (voce 1 del menu)")
        return False

    def active_scenarios(self) -> list:
        raw = capture(["docker", "exec", MOSQUITTO, "mosquitto_sub"] + mqtt_auth(self.env_file)
                      + ["-C", "1", "-W", "3", "-t", "Complex/scenarios"])
        return parse_active_scenarios(raw)

    def spy(self) -> None:
        print("\nEsempi: Complex/#  (tutto, molto verboso)  Complex/scenarios  Complex/clock  Complex/ack/#")
        topic = ask("Topic da ascoltare (Ctrl+C per uscire)", "Complex/#")
        tty = ["-it"] if sys.stdin.isatty() else []
        run(["docker", "exec"] + tty + [MOSQUITTO, "mosquitto_sub"] + mqtt_auth(self.env_file)
            + ["-v", "-t", topic])

    def scenarios(self) -> None:
        while True:
            index = choose("Scenari & orologio", [
                "Avvia uno scenario",
                "Scenari attivi / fermane uno o tutti",
                "Velocità orologio (1–60)",
                "Salta a un orario (HH:MM o ISO, es. 2026-10-01T21:00)",
                "Rimetti l'orologio a velocità 1",
            ])
            if index < 0:
                return
            [self.start_scenario, self.stop_scenarios, self.clock_speed, self.clock_jump,
             lambda: self.publish("Complex/control/clock", {"speed": 1})][index]()

    def start_scenario(self) -> None:
        catalog = load_scenarios(SCENARIOS_FILE)
        names = list(catalog)
        index = choose("Quale scenario?", [f"{n:<15} target: {catalog[n]}" for n in names])
        if index < 0:
            return
        name = names[index]
        kind = catalog[name]
        target = default_target(kind) if kind == "complex" else ask(
            f"Target ({TARGET_HINTS[kind]})", default_target(kind) or "")
        if not target:
            print("!! target obbligatorio")
            return
        raw = ask("Parametri JSON (invio = predefiniti)")
        params = None
        if raw:
            try:
                params = json.loads(raw)
            except ValueError:
                print("!! JSON non valido")
                return
        if self.publish("Complex/control/scenario", scenario_start_payload(name, target, params)):
            time.sleep(1)
            self.print_active(self.active_scenarios())
            print("(se non compare, il simulatore l'ha rifiutato: vedi i log di 'simulator')")

    @staticmethod
    def print_active(active: list) -> None:
        if not active:
            print("\nNessuno scenario attivo.")
            return
        print("\nScenari attivi:")
        for i, sc in enumerate(active, 1):
            print(f" {i:>2}) {sc.get('scenario_id')}  {sc.get('scenario'):<15} {sc.get('target')}")

    def stop_scenarios(self) -> None:
        active = self.active_scenarios()
        self.print_active(active)
        if not active:
            return
        answer = ask("Numero da fermare, 't' = tutti, invio = niente").lower()
        if answer == "t":
            chosen = active
        else:
            try:
                chosen = [active[i - 1] for i in parse_selection(answer, len(active))]
            except ValueError:
                return
        for sc in chosen:
            self.publish("Complex/control/scenario", {"action": "stop", "scenario_id": sc["scenario_id"]})

    def clock_speed(self) -> None:
        raw = ask("Velocità (1 = tempo reale, max 60)", "60")
        try:
            speed = float(raw)
        except ValueError:
            print("!! numero non valido")
            return
        self.publish("Complex/control/clock", {"speed": int(speed) if speed.is_integer() else speed})

    def clock_jump(self) -> None:
        target = ask("Orario", "21:00")
        self.publish("Complex/control/clock", {"jump_to": target})

    # -- dev tools --------------------------------------------------------------

    def uv_cmd(self, *args: str) -> list:
        return ["uv", "run", "--no-project", "--python", "3.11"] + list(args)

    def need_uv(self) -> bool:
        if not self.uv:
            print("!! Serve uv: https://docs.astral.sh/uv/getting-started/installation/")
        return bool(self.uv)

    def need_npm(self) -> bool:
        if not shutil.which("npm"):
            print("!! Serve Node.js (npm): https://nodejs.org/")
            return False
        if not (ROOT / "view" / "node_modules").exists():
            return run(["npm", "install"], cwd=ROOT / "view") == 0
        return True

    def tests(self) -> None:
        index = choose("Test", [
            "Simulatore (pytest)",
            "Vista 3D (tsc + vitest)",
            "Questo launcher (pytest tests/)",
            "e2e simulatore (serve mosquitto + simulator avviati)",
            "e2e vista 3D (serve mosquitto + simulator + view avviati)",
        ])
        if index < 0:
            return
        if index == 1:
            if self.need_npm() and run(["npm", "run", "check"], cwd=ROOT / "view") == 0:
                run(["npm", "test"], cwd=ROOT / "view")
        elif self.need_uv():
            if index == 0:
                run(self.uv_cmd("--with-requirements", "requirements.txt", "--with", "pytest", "pytest", "-q"),
                    cwd=ROOT / "simulator")
            elif index == 2:
                run(self.uv_cmd("--with", "pytest", "pytest", "tests", "-q"))
            else:
                script = "scripts/e2e_simulator.py" if index == 3 else "scripts/e2e_view.py"
                run(self.uv_cmd("--with", "paho-mqtt>=2,<3", "python", script))
        pause()

    def view_dev(self) -> None:
        print("\nVite su http://localhost:5173 con ricarica a caldo (serve mosquitto avviato). Ctrl+C per uscire.")
        if self.need_npm():
            webbrowser.open("http://localhost:5173")
            run(["npm", "run", "dev"], cwd=ROOT / "view")

    # -- main loop --------------------------------------------------------------

    def menu(self) -> None:
        entries = [
            (PRESETS["view"]["label"], lambda: self.start_preset("view")),
            (PRESETS["mapek"]["label"], lambda: self.start_preset("mapek")),
            (PRESETS["full"]["label"], lambda: self.start_preset("full")),
            ("Scelta manuale dei servizi", self.start_manual),
            ("Stato dei container", self.status),
            ("Log di un servizio", self.logs),
            ("Scenari & orologio del simulatore", self.scenarios),
            ("Spia il traffico MQTT", self.spy),
            ("Test", self.tests),
            ("Vista 3D in sviluppo (npm run dev, :5173)", self.view_dev),
            ("Ferma / riavvia / ricostruisci", self.manage),
        ]
        if not capture(["docker", "info", "--format", "{{.ServerVersion}}"]).strip():
            print("!! Docker non risponde: avvia Docker Desktop (o `orb start` con OrbStack).")
        while True:
            print("\n=== SE4AS — avvio stack ===")
            for i, (label, _) in enumerate(entries, 1):
                print(f" {i:>2}) {label}")
            print("  0) Esci")
            answer = ask("Scelta")
            if answer == "0":
                return
            if answer.isdigit() and 1 <= int(answer) <= len(entries):
                try:
                    entries[int(answer) - 1][1]()
                except KeyboardInterrupt:
                    print("\n(interrotto)")


def main() -> None:
    if sys.version_info < (3, 9):
        sys.exit("Serve Python 3.9 o superiore.")
    if os.name == "nt":
        os.system("")  # enables ANSI handling in the Windows console
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        Launcher().menu()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
