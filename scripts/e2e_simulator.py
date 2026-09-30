"""End-to-end check of the simulator against the running stack (mosquitto + simulator).

Usage (from the repo root, with the stack up):
    uv run --no-project --python 3.11 --with 'paho-mqtt>=2,<3' python scripts/e2e_simulator.py

Prints PASS/FAIL for each check and exits with 1 if any check fails.
"""
import json
import os
import sys
import threading
import time
import uuid

import paho.mqtt.client as mqtt

HOST = os.getenv("MQTT_HOST", "localhost")
PORT = int(os.getenv("MQTT_PORT_HOST", "1883"))
USER = os.getenv("MQTT_USERNAME", "admin")
PASSWORD = os.getenv("MQTT_PASSWORD", "adminpassword123")


class Bus:
    def __init__(self):
        self.lock = threading.Condition()
        self.status = None
        self.clock = None
        self.scenarios = {"active": []}
        self.raw_ids: set[str] = set()
        self.smoke: list[float] = []
        self.acks: list[tuple[str, dict]] = []
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"e2e-{uuid.uuid4().hex[:6]}")
        self.client.username_pw_set(USER, PASSWORD)
        self.client.on_connect = lambda c, u, f, rc, p: c.subscribe("Complex/#", qos=1)
        self.client.on_message = self._on_message

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            payload = msg.payload.decode(errors="replace")
        with self.lock:
            t = msg.topic
            if t == "Complex/status/simulator":
                self.status = payload
            elif t == "Complex/clock":
                self.clock = payload
            elif t == "Complex/scenarios":
                self.scenarios = payload
            elif t.startswith("Complex/raw/"):
                self.raw_ids.add(payload["device_id"])
                if t == "Complex/raw/A/A-2-1/smoke":
                    self.smoke.append(payload["value"])
            elif t.startswith("Complex/ack/"):
                self.acks.append((t, payload))
            self.lock.notify_all()

    def wait(self, predicate, timeout: float) -> bool:
        with self.lock:
            return self.lock.wait_for(predicate, timeout)

    def send(self, topic: str, payload: dict) -> None:
        self.client.publish(topic, json.dumps(payload), qos=1).wait_for_publish(timeout=5)

    def command(self, unit_path: str, command: dict) -> str:
        cmd_id = str(uuid.uuid4())
        self.send(f"Complex/cmd/{unit_path}", {"cmd_id": cmd_id, "command": command,
                                               "issued_by": "e2e", "timestamp": time.time()})
        return cmd_id

    def ack_for(self, cmd_id: str):
        for _, ack in self.acks:
            if isinstance(ack, dict) and ack.get("cmd_id") == cmd_id:
                return ack
        return None

    def start_scenario(self, scenario: str, target: str, params: dict | None = None, timeout: float = 5):
        self.send("Complex/control/scenario", {"action": "start", "scenario": scenario,
                                               "target": target, "params": params or {}})
        found = {}

        def active():
            for sc in self.scenarios.get("active", []):
                if sc["scenario"] == scenario and sc["target"] == target:
                    found["id"] = sc["scenario_id"]
                    return True
            return False
        return found["id"] if self.wait(active, timeout) else None


def main() -> int:
    bus = Bus()
    bus.client.connect(HOST, PORT)
    bus.client.loop_start()
    results: list[tuple[str, bool]] = []
    started: list[str] = []

    def check(name: str, ok: bool) -> None:
        results.append((name, ok))
        print(f"{'PASS' if ok else 'FAIL'}  {name}", flush=True)

    try:
        check("1. Complex/status/simulator = online",
              bus.wait(lambda: bus.status == "online", 10))

        check("2. almeno 414 sensori su Complex/raw/#",
              bus.wait(lambda: len(bus.raw_ids) >= 414, 12))

        bus.send("Complex/control/clock", {"speed": 60})
        check("3. orologio a velocità 60",
              bus.wait(lambda: isinstance(bus.clock, dict) and bus.clock.get("speed") == 60, 3))

        cid = bus.command("A/A-2-1/window", {"position": "open"})
        check("4. comando finestra → ack ok",
              bus.wait(lambda: (bus.ack_for(cid) or {}).get("status") == "ok", 3))

        cid = bus.command("A/A-2-1/hvac", {"setpoint": 40})
        ok = bus.wait(lambda: bus.ack_for(cid) is not None, 3)
        ack = bus.ack_for(cid) or {}
        check("5. set-point 40 → ack rejected con motivo",
              ok and ack.get("status") == "rejected" and ack.get("reason") == "setpoint 40 fuori da 16–30")

        sc = bus.start_scenario("actuator_fault", "A-2-1.lights", {"mode": "no_ack"})
        if sc:
            started.append(sc)
        cid = bus.command("A/A-2-1/lights", {"level": 80})
        check("6. actuator_fault no_ack → nessun ack",
              sc is not None and not bus.wait(lambda: bus.ack_for(cid) is not None, 3))

        sc = bus.start_scenario("fire", "A-2-1")
        if sc:
            started.append(sc)
        check("7. incendio in A-2-1 → fumo > 1 su Complex/raw",
              sc is not None and bus.wait(lambda: any(v > 1 for v in bus.smoke), 60))
    finally:
        for scenario_id in started:
            bus.send("Complex/control/scenario", {"action": "stop", "scenario_id": scenario_id})
        bus.command("A/A-2-1/window", {"position": "closed"})
        bus.send("Complex/control/clock", {"speed": 1})
        stopped = bus.wait(lambda: not ({s["scenario_id"] for s in bus.scenarios.get("active", [])} & set(started)), 5)
        restored = bus.wait(lambda: isinstance(bus.clock, dict) and bus.clock.get("speed") == 1, 3)
        check("8. pulizia: scenari fermati, orologio a velocità 1", stopped and restored)
        bus.client.loop_stop()
        bus.client.disconnect()

    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
