"""MQTT adapter: maps Simulation onto the Complex/... topics (spec §7). No business logic here."""
import json
import logging
import threading
import time

from scenarios import ScenarioError
from simulation import Simulation

ROOT = "Complex"
log = logging.getLogger("simulator.mqtt")


def device_topic(layer: str, area: str, unit_id: str, device_type: str) -> str:
    return f"{ROOT}/{layer}/{area}/{unit_id}/{device_type}"


def parse_device_topic(topic: str) -> tuple[str, str, str, str]:
    parts = topic.split("/")
    if len(parts) != 5 or parts[0] != ROOT or not all(parts[1:]):
        raise ValueError(f"topic non valido: {topic}")
    return parts[1], parts[2], parts[3], parts[4]


def _decode(payload: bytes | str) -> object:
    """JSON payload, or None when it cannot be decoded."""
    try:
        return json.loads(payload)
    except (ValueError, TypeError):
        return None


class SimulatorService:
    def __init__(self, sim: Simulation, client, settings: dict):
        self.sim = sim
        self.client = client
        self.settings = settings
        self._lock = threading.RLock()   # paho callbacks run on the network thread, tick on the main one
        self._areas = {d.device_id: d.area for d in sim.model.devices()}
        self._last_clock = None
        self._last_sample = None
        self._last_full_states = None

    # ------------------------------------------------------------ publishing

    def _publish(self, topic: str, payload, qos: int, retain: bool) -> None:
        is_connected = getattr(self.client, "is_connected", None)
        if is_connected is not None and not is_connected():
            return          # everything retained is republished by on_connect
        if not isinstance(payload, str):
            payload = json.dumps(payload, ensure_ascii=False)
        self.client.publish(topic, payload, qos=qos, retain=retain)

    def _device_topic(self, layer: str, device_id: str) -> str:
        unit_id, _, device_type = device_id.partition(".")
        return device_topic(layer, self._areas[device_id], unit_id, device_type)

    def _publish_states(self, real_ts: float, only_changed: bool) -> None:
        for msg in self.sim.actuator_states(real_ts, only_changed):
            self._publish(self._device_topic("state", msg["device_id"]), msg, 1, True)

    def _publish_clock(self, real_ts: float) -> None:
        self._publish(f"{ROOT}/clock", self.sim.clock.to_message(real_ts), 1, True)

    def publish_scenarios(self) -> None:
        with self._lock:
            self._publish(f"{ROOT}/scenarios", self.sim.scenarios.to_message(), 1, True)
            self.sim.scenarios_changed = False

    # ------------------------------------------------------------- callbacks

    def on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if getattr(reason_code, "is_failure", False):
            log.warning("connessione al broker rifiutata: %s", reason_code)
            return
        now = time.time()
        with self._lock:
            client.subscribe(f"{ROOT}/cmd/#", qos=1)
            client.subscribe(f"{ROOT}/control/#", qos=1)
            self._publish(f"{ROOT}/status/simulator", "online", 1, True)
            self._publish(f"{ROOT}/model", self.sim.model.to_json(), 1, True)
            self._publish_clock(now)
            self._publish_states(now, only_changed=False)
            self.publish_scenarios()
        log.info("connesso al broker, topic retained ripubblicati")

    def on_message(self, client, userdata, msg) -> None:
        print(f"RAW Ricevuto {msg.topic}", flush=True)
        try:
            with self._lock:
                log.info("Ricevuto topic: %s", msg.topic)
                self._dispatch(msg.topic, msg.payload, time.time())
        except Exception:                       # never let a message stop the simulation
            log.exception("errore nel gestire %s", getattr(msg, "topic", "?"))

    def _dispatch(self, topic: str, raw: bytes | str, now: float) -> None:
        if topic.startswith(f"{ROOT}/cmd/"):
            try:
                _, area, unit_id, device_type = parse_device_topic(topic)
            except ValueError as exc:
                log.warning("%s", exc)
                return
            ack = self.sim.handle_command(f"{unit_id}.{device_type}", _decode(raw), now)
            if ack is not None:
                self._publish(device_topic("ack", area, unit_id, device_type), ack, 1, False)
            self._publish_states(now, only_changed=True)
        elif topic == f"{ROOT}/control/scenario":
            payload = _decode(raw)
            try:
                self.sim.handle_scenario_control(payload, now)
            except ScenarioError as exc:
                log.warning("controllo scenario ignorato (%s): %r", exc, payload)
                return
            self.publish_scenarios()
        elif topic == f"{ROOT}/control/clock":
            payload = _decode(raw)
            try:
                self.sim.handle_clock_control(payload)
            except ValueError as exc:
                log.warning("controllo orologio ignorato (%s): %r", exc, payload)
                return
            self._publish_clock(now)
        else:
            log.warning("topic non gestito: %s", topic)

    # ------------------------------------------------------------------ loop

    def tick(self, real_ts: float) -> None:
        try:
            with self._lock:
                self._tick(real_ts)
        except Exception:                       # keep the loop alive; the error is logged
            log.exception("errore nel passo di simulazione")

    def _tick(self, real_ts: float) -> None:
        self.sim.step(self.settings["physics_step_s"])
        second = int(real_ts)
        if second != self._last_clock:
            self._last_clock = second
            self._publish_clock(real_ts)
        sample = int(real_ts // self.settings["sampling_period_s"])
        if sample != self._last_sample:
            self._last_sample = sample
            for reading in self.sim.sample_readings(real_ts):
                self._publish(self._device_topic("raw", reading["device_id"]), reading, 0, False)
        full = int(real_ts // self.settings["actuator_state_period_s"])
        if full != self._last_full_states:
            self._last_full_states = full
            self._publish_states(real_ts, only_changed=False)
        else:
            self._publish_states(real_ts, only_changed=True)
        if self.sim.scenarios_changed:
            self.publish_scenarios()
