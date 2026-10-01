"""End-to-end check of the 3D view against the running stack (mosquitto + simulator + view).

Usage (from the repo root, with the stack up):
    uv run --no-project --python 3.11 --with 'paho-mqtt>=2,<3' python scripts/e2e_view.py
    uv run --no-project --python 3.11 --with 'paho-mqtt>=2,<3' python scripts/e2e_view.py --only ws_data admin_ok

Prints PASS/FAIL for each check and exits with 1 if any check fails.
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.request
import uuid

import paho.mqtt.client as mqtt

WS_HOST = os.getenv("VIEW_WS_HOST", "localhost")
WS_PORT = int(os.getenv("VIEW_WS_PORT", "9001"))
VIEW_USER = os.getenv("VIEW_MQTT_USERNAME", "view")
VIEW_PASSWORD = os.getenv("VIEW_MQTT_PASSWORD", "viewpassword123")
TCP_HOST = os.getenv("MQTT_HOST", "localhost")
TCP_PORT = int(os.getenv("MQTT_PORT_HOST", "1883"))
ADMIN_USER = os.getenv("MQTT_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("MQTT_PASSWORD", "adminpassword123")
VIEW_HTTP = os.getenv("VIEW_HTTP", "http://localhost:8080")

# The filters the `view` user may read (view spec §5.3).
VIEW_FILTERS = ["Complex/model", "Complex/clock", "Complex/scenarios", "Complex/status/#",
                "Complex/raw/#", "Complex/state/#", "Complex/ack/#"]


class Bus:
    def __init__(self, user: str, password: str, websockets: bool, filters: list[str]):
        self.lock = threading.Condition()
        self.model = None
        self.scenarios = None
        self.raw_ids: set[str] = set()
        self.acks: list[tuple[str, dict]] = []
        self.connected = False
        self.filters = filters
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=f"e2e-view-{uuid.uuid4().hex[:6]}",
                                  transport="websockets" if websockets else "tcp")
        self.client.username_pw_set(user, password)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc, props):
        with self.lock:
            self.connected = not rc.is_failure
            self.lock.notify_all()
        if not rc.is_failure and self.filters:
            client.subscribe([(f, 1) for f in self.filters])

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            payload = msg.payload.decode(errors="replace")
        with self.lock:
            t = msg.topic
            if t == "Complex/model":
                self.model = payload
            elif t == "Complex/scenarios":
                self.scenarios = payload
            elif t.startswith("Complex/raw/") and isinstance(payload, dict):
                self.raw_ids.add(payload.get("device_id"))
            elif t.startswith("Complex/ack/"):
                self.acks.append((t, payload))
            self.lock.notify_all()

    def start(self, host: str, port: int) -> "Bus":
        self.client.connect_async(host, port)
        self.client.loop_start()
        return self

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()

    def wait(self, predicate, timeout: float) -> bool:
        with self.lock:
            return self.lock.wait_for(predicate, timeout)

    def send(self, topic: str, payload: dict) -> None:
        self.client.publish(topic, json.dumps(payload), qos=1).wait_for_publish(timeout=5)


def check_page() -> bool:
    with urllib.request.urlopen(f"{VIEW_HTTP}/", timeout=10) as r:
        page_ok = r.status == 200 and '<div id="root">' in r.read().decode()
    with urllib.request.urlopen(f"{VIEW_HTTP}/config.js", timeout=10) as r:
        config_ok = (r.status == 200 and "ws://localhost:9001" in r.read().decode()
                     and "no-store" in (r.headers.get("Cache-Control") or ""))
    return page_ok and config_ok


def check_ws_data() -> bool:
    bus = Bus(VIEW_USER, VIEW_PASSWORD, True, VIEW_FILTERS).start(WS_HOST, WS_PORT)
    try:
        return bus.wait(lambda: bus.model is not None and len(bus.raw_ids) >= 400, 25)
    finally:
        bus.stop()


def check_admin_ok() -> bool:
    bus = Bus(ADMIN_USER, ADMIN_PASSWORD, False, ["Complex/raw/#"]).start(TCP_HOST, TCP_PORT)
    try:
        return bus.wait(lambda: len(bus.raw_ids) >= 1, 15)
    finally:
        bus.stop()


def check_debug_cmd() -> bool:
    bus = Bus(VIEW_USER, VIEW_PASSWORD, True, ["Complex/ack/A/A-2-1/window"]).start(WS_HOST, WS_PORT)
    try:
        if not bus.wait(lambda: bus.connected, 10):
            return False
        time.sleep(0.5)   # let the subscription settle before publishing
        cmd_id = str(uuid.uuid4())

        def acked(status: str):
            return any(isinstance(a, dict) and a.get("cmd_id") == cmd_id and a.get("status") == status for _, a in bus.acks)
        bus.send("Complex/cmd/A/A-2-1/window", {"cmd_id": cmd_id, "command": {"position": "open"},
                                                "issued_by": "debug", "timestamp": time.time()})
        ok = bus.wait(lambda: acked("ok"), 5)
        bus.send("Complex/cmd/A/A-2-1/window", {"cmd_id": str(uuid.uuid4()), "command": {"position": "closed"},
                                                "issued_by": "debug", "timestamp": time.time()})
        return ok
    finally:
        bus.stop()


def check_acl_scenario() -> bool:
    view = Bus(VIEW_USER, VIEW_PASSWORD, True, []).start(WS_HOST, WS_PORT)
    admin = Bus(ADMIN_USER, ADMIN_PASSWORD, False, ["Complex/scenarios"]).start(TCP_HOST, TCP_PORT)
    try:
        if not view.wait(lambda: view.connected, 10):
            return False
        view.send("Complex/control/scenario", {"action": "start", "scenario": "storm", "target": "complex"})
        time.sleep(3)
        admin.wait(lambda: admin.scenarios is not None, 5)
        storms = [s for s in (admin.scenarios or {}).get("active", []) if s.get("scenario") == "storm"]
        for s in storms:   # the ACL failed: clean up, then report the failure
            admin.send("Complex/control/scenario", {"action": "stop", "scenario_id": s["scenario_id"]})
        return admin.scenarios is not None and not storms
    finally:
        view.stop()
        admin.stop()


CHECKS = {
    "page": ("la pagina risponde e config.js contiene l'URL del broker (no-store)", check_page),
    "ws_data": ("utente view via WebSocket: Complex/model e almeno 400 sensori raw", check_ws_data),
    "admin_ok": ("utente admin su 1883 continua a ricevere Complex/raw", check_admin_ok),
    "debug_cmd": ("comando di debug dell'utente view → ack ok", check_debug_cmd),
    "acl_scenario": ("l'utente view non può avviare scenari (ACL)", check_acl_scenario),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="+", metavar="CHECK", help=f"checks to run: {', '.join(CHECKS)}")
    args = parser.parse_args()
    names = [n for n in (args.only or CHECKS) if n in CHECKS]
    for n in set(args.only or []) - set(CHECKS):
        print(f"SKIP  {n} (check non disponibile)")

    results: list[tuple[str, bool]] = []
    for name in names:
        label, fn = CHECKS[name]
        try:
            ok = fn()
        except Exception as exc:  # noqa: BLE001 - a crashed check is a failed check
            print(f"      {name}: {exc!r}")
            ok = False
        results.append((name, ok))
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {label}", flush=True)

    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
