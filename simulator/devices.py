"""Sensor and actuator devices: measurement pipeline, commands, acks, injected faults."""
import copy
import random

from model import ActuatorType, Device, SensorType

SENSOR_FAULTS = ("stuck", "drift", "offline")


class SensorDevice:
    def __init__(self, device: Device, stype: SensorType, drift_rates: dict):
        self.device = device
        self.stype = stype
        self.fault: tuple[str, dict, float] | None = None
        lo, hi = stype.valid_range
        self._default_drift = drift_rates.get(device.type, drift_rates["default_span_fraction"] * (hi - lo))
        self._last: float | None = None
        self._frozen: float | None = None

    def set_fault(self, mode: str, params: dict, real_ts: float) -> None:
        if mode not in SENSOR_FAULTS:
            raise ValueError(f"guasto sconosciuto: {mode}")
        rate = params.get("drift_rate")
        if rate is not None and (isinstance(rate, bool) or not isinstance(rate, (int, float))):
            raise ValueError("drift_rate deve essere un numero")
        self.fault = (mode, dict(params), real_ts)
        self._frozen = self._last

    def clear_fault(self) -> None:
        self.fault = None
        self._frozen = None

    def read(self, true_value: float, rng: random.Random, real_ts: float) -> float | None:
        st = self.stype
        value = true_value
        if st.noise > 0 and (st.rest_value is None or true_value > st.rest_value):
            value += rng.gauss(0, st.noise)
        lo, hi = st.valid_range
        value = min(hi, max(lo, value))
        if self.fault is None:
            self._last = value
            return value
        mode, params, started = self.fault
        if mode == "offline":
            return None
        if mode == "stuck":
            if self._frozen is None:
                self._frozen = value
            return self._frozen
        rate = params.get("drift_rate", self._default_drift)
        return value + rate * (real_ts - started) / 60


ACTUATOR_FAULTS = ("no_ack", "no_effect")


def _is_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_command(atype: ActuatorType, command: object) -> str | None:
    """Return an Italian rejection reason, or None when the command is valid."""
    if not isinstance(command, dict):
        return "comando non valido: atteso un oggetto JSON"
    if not command:
        return "comando vuoto"
    for key, value in command.items():
        rule = atype.commands.get(key)
        if rule is None:
            return f"chiave sconosciuta: {key}"
        if "enum" in rule:
            if value not in rule["enum"] or not isinstance(value, str):
                return f"{key} '{value}' non ammesso (valori: {', '.join(rule['enum'])})"
        elif "min" in rule:
            if not _is_number(value):
                return f"{key} deve essere un numero"
            if rule.get("integer") and not float(value).is_integer():
                return f"{key} deve essere intero"
            if not rule["min"] <= value <= rule["max"]:
                return f"{key} {value:g} fuori da {rule['min']:g}–{rule['max']:g}"
        elif rule.get("string"):
            if not isinstance(value, str):
                return f"{key} deve essere un testo"
        elif rule.get("bool"):
            if not isinstance(value, bool):
                return f"{key} deve essere true/false"
    return None


class ActuatorDevice:
    def __init__(self, device: Device, atype: ActuatorType, default_override: dict | None = None):
        self.device = device
        self.atype = atype
        self._default = {**atype.default, **(default_override or {})}
        self.declared: dict = copy.deepcopy(self._default)
        self.effective: dict = copy.deepcopy(self._default)
        self.fault: str | None = None

    def set_fault(self, mode: str) -> None:
        if mode not in ACTUATOR_FAULTS:
            raise ValueError(f"guasto sconosciuto: {mode}")
        self.fault = mode

    def clear_fault(self) -> None:
        self.fault = None
        self.effective = copy.deepcopy(self.declared)

    def apply_command(self, cmd_id: str | None, command: object, real_ts: float) -> dict | None:
        if self.fault == "no_ack":
            return None
        reason = validate_command(self.atype, command)
        if reason is not None:
            return {"cmd_id": cmd_id, "status": "rejected", "reason": reason, "timestamp": real_ts}
        changes = dict(command)
        if changes.pop("clear", False) is True:
            self.declared = {k: self._default[k] for k in self._default}
        for key, value in changes.items():
            rule = self.atype.commands[key]
            self.declared[key] = int(value) if rule.get("integer") else value
        if self.fault != "no_effect":
            self.effective = copy.deepcopy(self.declared)
        return {"cmd_id": cmd_id, "status": "ok", "state": copy.deepcopy(self.declared), "timestamp": real_ts}

    def state_message(self, real_ts: float, sim_time: str, power_w: float) -> dict:
        return {"device_id": self.device.device_id, "state": copy.deepcopy(self.declared),
                "power_w": power_w, "timestamp": real_ts, "sim_time": sim_time}
