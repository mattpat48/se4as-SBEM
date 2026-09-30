"""The 14 scenarios: start/stop, target validation, and their effects on the model parameters."""
import copy
import random
from dataclasses import dataclass, field
from datetime import datetime

from devices import ACTUATOR_FAULTS, SENSOR_FAULTS
from environment import EnvEffects
from model import ComplexModel


class ScenarioError(Exception):
    pass


REQUIRED = object()   # marks a parameter without default

SCENARIOS: dict[str, dict] = {
    "fire":           {"target": "apartment", "params": {}},
    "gas_leak":       {"target": "apartment", "params": {"rate": 2}},
    "co_poisoning":   {"target": "apartment", "params": {"rate": 30}},
    "earthquake":     {"target": "complex", "params": {"magnitude": 5.8, "duration_s": 30}},
    "heatwave":       {"target": "complex", "params": {"delta": 10, "days": 3}},
    "cold_wave":      {"target": "complex", "params": {"delta": -10, "days": 3}},
    "pollution":      {"target": "complex", "params": {"factor": 4}},
    "power_peak":     {"target": "complex", "params": {}},
    "storm":          {"target": "complex", "params": {}},
    "solar_surplus":  {"target": "complex", "params": {}},
    "blackout":       {"target": "complex_or_building", "params": {}},
    "sensor_fault":   {"target": "sensor", "params": {"mode": REQUIRED, "drift_rate": None}},
    "actuator_fault": {"target": "actuator", "params": {"mode": REQUIRED}},
    "cascade":        {"target": "complex", "params": {"magnitude": 5.8, "gas_after_min": 5,
                                                       "fire_after_min": 10, "targets": None}},
}

_ENUMS = {("sensor_fault", "mode"): SENSOR_FAULTS, ("actuator_fault", "mode"): ACTUATOR_FAULTS}


@dataclass
class ActiveScenario:
    scenario_id: str
    scenario: str
    target: str
    params: dict
    started_at: float
    sim_started_at: datetime


@dataclass
class Effects:
    env: EnvEffects = field(default_factory=EnvEffects)
    blackout: set[str] = field(default_factory=set)
    forced: str | None = None
    appliances_max: bool = False
    gas_leaks: dict[str, float] = field(default_factory=dict)
    co_sources: dict[str, float] = field(default_factory=dict)
    burning: set[str] = field(default_factory=set)


def _is_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class ScenarioManager:
    def __init__(self, model: ComplexModel, rng: random.Random):
        self.model = model
        self.rng = rng
        self.active: list[ActiveScenario] = []
        self._counter = 0
        self._apartments = {u.id for u in model.apartments()}
        self._buildings = {u.id for u in model.units_of("building")}
        devices = model.devices()
        self._sensors = {d.device_id for d in devices if d.kind == "sensor"}
        self._actuators = {d.device_id for d in devices if d.kind == "actuator"}

    def _valid_target(self, kind: str, target: object) -> bool:
        return {
            "apartment": lambda t: t in self._apartments,
            "complex": lambda t: t == "complex",
            "complex_or_building": lambda t: t == "complex" or t in self._buildings,
            "sensor": lambda t: t in self._sensors,
            "actuator": lambda t: t in self._actuators,
        }[kind](target)

    def _params(self, scenario: str, given: object) -> dict:
        if given is None:
            given = {}
        if not isinstance(given, dict):
            raise ScenarioError("parametro non valido: params")
        defaults = SCENARIOS[scenario]["params"]
        for key, value in given.items():
            if key not in defaults:
                raise ScenarioError(f"parametro non valido: {key}")
            allowed = _ENUMS.get((scenario, key))
            if allowed is not None:
                if value not in allowed:
                    raise ScenarioError(f"parametro non valido: {key}")
            elif key == "targets":
                if not (isinstance(value, list) and value and all(t in self._apartments for t in value)):
                    raise ScenarioError(f"parametro non valido: {key}")
            elif not _is_number(value) or (key in ("duration_s", "days", "factor", "rate", "drift_rate",
                                                   "gas_after_min", "fire_after_min") and value < 0):
                raise ScenarioError(f"parametro non valido: {key}")
        params = {k: v for k, v in defaults.items() if v is not None and v is not REQUIRED}
        params.update(copy.deepcopy(given))
        for key, value in defaults.items():
            if value is REQUIRED and key not in params:
                raise ScenarioError(f"parametro non valido: {key}")
        return params

    def _cascade_targets(self) -> list[str]:
        first, second = self.rng.sample(sorted(self._buildings), 2)
        pick = lambda b: self.rng.choice(sorted(a for a in self._apartments if a.startswith(f"{b}-")))
        return [pick(first), pick(second)]

    def start(self, scenario: str, target: str, params: dict | None,
              real_ts: float, sim_now: datetime) -> ActiveScenario:
        if not isinstance(scenario, str) or scenario not in SCENARIOS:
            raise ScenarioError(f"scenario sconosciuto: {scenario}")
        if not isinstance(target, str) or not self._valid_target(SCENARIOS[scenario]["target"], target):
            raise ScenarioError(f"target non valido per {scenario}: {target}")
        merged = self._params(scenario, params)
        if any(a.scenario == scenario and a.target == target for a in self.active):
            raise ScenarioError("scenario già attivo su questo target")
        if scenario == "cascade" and "targets" not in merged:
            merged["targets"] = self._cascade_targets()
        self._counter += 1
        sc = ActiveScenario(f"sc-{self._counter:04d}", scenario, target, merged, real_ts, sim_now)
        self.active.append(sc)
        return sc

    def stop(self, scenario_id: str) -> ActiveScenario:
        for sc in self.active:
            if sc.scenario_id == scenario_id:
                self.active.remove(sc)
                return sc
        raise ScenarioError(f"scenario_id sconosciuto: {scenario_id}")

    def effects(self, sim_now: datetime) -> Effects:
        e = Effects()
        forced: set[str] = set()
        quake: list[float] = []
        for sc in self.active:
            elapsed = max(0.0, (sim_now - sc.sim_started_at).total_seconds())
            p, name = sc.params, sc.scenario
            if name == "fire":
                e.burning.add(sc.target)
            elif name == "gas_leak":
                e.gas_leaks[sc.target] = e.gas_leaks.get(sc.target, 0.0) + p["rate"]
            elif name == "co_poisoning":
                e.co_sources[sc.target] = e.co_sources.get(sc.target, 0.0) + p["rate"]
            elif name == "earthquake":
                if elapsed < p["duration_s"]:
                    quake.append(p["magnitude"])
            elif name in ("heatwave", "cold_wave"):
                if elapsed < p["days"] * 86400:
                    e.env.temp_delta += p["delta"]
            elif name == "pollution":
                e.env.pm_factor *= p["factor"]
            elif name == "storm":
                e.env.storm = True
            elif name == "solar_surplus":
                e.env.clear_sky = True
                forced.add("all_away")
            elif name == "power_peak":
                forced.add("all_home")
                e.appliances_max = True
            elif name == "blackout":
                e.blackout |= self._buildings if sc.target == "complex" else {sc.target}
            elif name == "cascade":
                if elapsed < SCENARIOS["earthquake"]["params"]["duration_s"]:
                    quake.append(p["magnitude"])
                if elapsed >= p["gas_after_min"] * 60:
                    rate = SCENARIOS["gas_leak"]["params"]["rate"]
                    for t in p["targets"]:
                        e.gas_leaks[t] = e.gas_leaks.get(t, 0.0) + rate
                if elapsed >= p["fire_after_min"] * 60:
                    e.burning.add(p["targets"][0])
        e.env.earthquake_magnitude = max(quake) if quake else None
        e.forced = "all_home" if "all_home" in forced else ("all_away" if forced else None)
        return e

    def to_message(self) -> dict:
        return {"active": [{"scenario_id": sc.scenario_id, "scenario": sc.scenario, "target": sc.target,
                            "params": copy.deepcopy(sc.params), "started_at": sc.started_at,
                            "sim_started_at": sc.sim_started_at.isoformat(timespec="seconds")}
                           for sc in self.active]}
