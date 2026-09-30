"""Simulation: one step of the whole complex, readings, actuator states, commands and controls.

No MQTT here: mqtt_io.SimulatorService maps this class onto the Complex/... topics.
"""
import copy
import random
from datetime import datetime

from clock import SimClock
from devices import ActuatorDevice, SensorDevice
from energy import BuildingState, Flows, actuator_power, apartment_flows, charger_power, pv_power, step_battery
from environment import Environment
from model import ComplexModel
from occupancy import EVFleet, Occupancy
from physics import (ApartmentInputs, ApartmentState, StairwellState, cooling_active, heating_active, ignite,
                     spread_fire, step_apartment_air, step_apartment_hazards, step_stairwell)
from scenarios import ActiveScenario, ScenarioError, ScenarioManager

_APARTMENT_FIELDS = {"temperature": "temperature", "humidity": "humidity", "co2": "co2", "smoke": "smoke",
                     "gas": "gas", "co": "co", "noise_level": "noise", "light": "light"}
_FLOW_FIELDS = {"power": "power_w", "water_flow": "water_l_min", "gas_flow": "gas_m3_h"}
READING_DECIMALS = 3


class Simulation:
    def __init__(self, model: ComplexModel, start: datetime, seed: int | None = None):
        self.model = model
        s = model.settings
        self.seed = s["seed"] if seed is None else seed
        p = model.physics
        self.clock = SimClock(start, s["clock"]["speed"], s["clock"]["max_speed"])
        self.env = Environment(p["outdoor"], self._rng("environment"), self.clock.now)
        self.occupancy = Occupancy(model, p, self._rng("occupancy"))
        self._chargers = model.units_of("charger")
        self.ev = EVFleet([u.id for u in self._chargers], p["ev"], self._rng("ev"))
        self._apartment_units = model.apartments()
        self._building_units = model.units_of("building")
        self.apartments = {u.id: ApartmentState() for u in self._apartment_units}
        self.stairwells = {u.id: StairwellState() for u in model.units_of("stairwell")}
        self.buildings = {u.id: BuildingState() for u in self._building_units}
        self.sensors: dict[str, SensorDevice] = {}
        self.actuators: dict[str, ActuatorDevice] = {}
        for d in model.devices():
            if d.kind == "sensor":
                self.sensors[d.device_id] = SensorDevice(d, model.sensor_types[d.type], p["drift_rate_per_min"])
            else:
                override = None
                if d.type == "ev_charger":
                    override = {"max_power_w": model.units[d.unit_id].attrs["max_power_w"]}
                self.actuators[d.device_id] = ActuatorDevice(d, model.actuator_types[d.type], override)
        self.scenarios = ScenarioManager(model, self._rng("scenarios"))
        self.scenarios_changed = False
        self._noise_rng = self._rng("noise")
        self._fire_rng = self._rng("fire")
        self._adjacency = {u.id: list(u.adjacent) for u in self._apartment_units}
        self._flows: dict[str, Flows] = {}
        self._charger_w: dict[str, float] = {u.id: 0.0 for u in self._chargers}
        self._essential_ok: dict[str, bool] = {u.id: True for u in self._building_units}
        self._lit: set[str] = set()                 # apartments set on fire by an active scenario
        self._published: dict[str, object] = {}     # last published actuator state, for only_changed
        self._essential: dict[str, list[ActuatorDevice]] = {u.id: [] for u in self._building_units}
        for act in self.actuators.values():
            bid = self._building_of(act.device.unit_id)
            if act.atype.essential and bid is not None:
                self._essential[bid].append(act)
        self._update(0.0)

    def _rng(self, name: str) -> random.Random:
        return random.Random(f"{self.seed}-{name}")

    def _state(self, unit_id: str, atype: str) -> dict:
        return self.actuators[f"{unit_id}.{atype}"].effective

    # ------------------------------------------------------------------ step

    def step(self, real_dt: float) -> None:
        dt = self.clock.advance(real_dt)
        self._update(dt)

    def _update(self, dt: float) -> None:
        now = self.clock.now
        p = self.model.physics
        effects = self.scenarios.effects(now)

        # Fires started by scenarios; stopped scenarios hand their fires to the firefighters.
        for apt in sorted(effects.burning - self._lit):
            ignite(self.apartments[apt], p)
        for apt in self._lit - effects.burning:
            if self.apartments[apt].fire > 0:
                self.apartments[apt].extinguishing = True
        self._lit = set(effects.burning)
        if not effects.burning:
            for s in self.apartments.values():
                if s.fire > 0:
                    s.extinguishing = True

        all_buildings = {u.id for u in self._building_units}
        park_powered = not all_buildings <= effects.blackout
        irrigation_on = park_powered and self._state("park", "irrigation")["state"] == "on"
        self.env.step(now, dt, effects.env, irrigation_on)
        out = self.env.state

        building_siren = {b: self._state(f"{b}-S", "evacuation_siren")["siren"] == "on" for b in all_buildings}
        evacuate = {u.id for u in self._apartment_units
                    if self._state(u.id, "alarm")["siren"] == "on" or building_siren[u.attrs["building"]]}
        self.occupancy.step(now, dt, evacuate, effects.forced)
        self.ev.step(now, dt, self._charger_w)

        for u in self._building_units:
            b = self.buildings[u.id]
            b.grid_ok = u.id not in effects.blackout
            b.pv_power_w = pv_power(u.attrs["pv_peak_w"], out.sun, out.cloudiness, p)

        types = self.model.actuator_types
        for u in self._apartment_units:
            s, a = self.apartments[u.id], u.attrs
            bid = a["building"]
            activity = self.occupancy.activity(u.id, now)
            inp = ApartmentInputs(
                outdoor=out, people=self.occupancy.home[u.id], awake=self.occupancy.awake(u.id, now),
                actuators={t: self._state(u.id, t) for t in u.actuators}, volume_m3=a["volume_m3"],
                orientation=a["orientation"], insulation=a["insulation"], powered=self.buildings[bid].grid_ok,
                showering=activity.showering, cooking=activity.cooking,
                siren_on=self._state(u.id, "alarm")["siren"] == "on" or building_siren[bid],
                gas_leak_rate=effects.gas_leaks.get(u.id, 0.0), co_rate=effects.co_sources.get(u.id, 0.0))
            heating, cooling = heating_active(s, inp, p), cooling_active(s, inp, p)
            step_apartment_air(s, inp, dt, p)
            step_apartment_hazards(s, inp, dt, p)
            flows = apartment_flows(inp, types, heating, cooling, effects.appliances_max, p)
            if not inp.powered and not self._essential_ok[bid]:
                flows.power_w = 0.0
            self._flows[u.id] = flows

        spread_fire(self.apartments, self._adjacency, dt, self._fire_rng, p)

        for sid, st in self.stairwells.items():
            bid = self.model.units[sid].attrs["building"]
            members = [self.apartments[x] for x in self.model.units[sid].adjacent if x in self.apartments]
            step_stairwell(st, members, self._state(sid, "smoke_vent")["position"] == "open",
                           self._state(sid, "stair_lights")["mode"], out, dt, p)

        for u in self._building_units:
            load = sum(actuator_power(act.atype, act.effective) for act in self._essential[u.id])
            self._essential_ok[u.id] = step_battery(self.buildings[u.id], self._state(u.id, "battery")["mode"],
                                                    u.attrs["battery_kwh"], u.attrs["battery_max_w"], load, dt)

        for c in self._chargers:
            st = self._state(c.id, "ev_charger")
            self._charger_w[c.id] = charger_power(st["mode"], st["max_power_w"], self.ev.cars[c.id],
                                                  self.buildings[c.attrs["building"]].grid_ok)

    def _building_of(self, unit_id: str) -> str | None:
        u = self.model.units[unit_id]
        if u.kind == "building":
            return u.id
        return u.attrs.get("building")

    # ------------------------------------------------------------- readings

    def true_value(self, device_id: str) -> float:
        unit_id, _, t = device_id.partition(".")
        unit = self.model.units[unit_id]
        if t not in unit.sensors:
            raise KeyError(device_id)
        if unit.kind == "apartment":
            if t == "occupancy":
                return float(self.occupancy.home[unit_id])
            if t in _FLOW_FIELDS:
                return getattr(self._flows[unit_id], _FLOW_FIELDS[t])
            return getattr(self.apartments[unit_id], _APARTMENT_FIELDS[t])
        if unit.kind == "stairwell":
            if t == "occupancy":
                return float(self.occupancy.transit[unit_id])
            return getattr(self.stairwells[unit_id], t)
        if unit.kind == "building" and t == "pv_power":
            return self.buildings[unit_id].pv_power_w
        if unit.kind == "park":
            return getattr(self.env.state, t)
        raise KeyError(device_id)

    def _sim_time(self) -> str:
        return self.clock.now.isoformat(timespec="seconds")

    def sample_readings(self, real_ts: float) -> list[dict]:
        sim_time = self._sim_time()
        out = []
        for did, sensor in self.sensors.items():
            value = sensor.read(self.true_value(did), self._noise_rng, real_ts)
            if value is None:
                continue
            out.append({"device_id": did, "value": round(value, READING_DECIMALS), "unit": sensor.stype.unit,
                        "timestamp": real_ts, "sim_time": sim_time})
        return out

    def _actuator_power(self, act: ActuatorDevice) -> float:
        t, uid = act.device.type, act.device.unit_id
        if t == "battery":
            return self.buildings[uid].battery_power_w
        if t == "ev_charger":
            return self._charger_w[uid]
        bid = self._building_of(uid)
        if bid is not None and not act.atype.essential and not self.buildings[bid].grid_ok:
            return 0.0
        return actuator_power(act.atype, act.effective)

    def actuator_states(self, real_ts: float, only_changed: bool) -> list[dict]:
        sim_time = self._sim_time()
        out = []
        for did, act in self.actuators.items():
            msg = act.state_message(real_ts, sim_time, round(self._actuator_power(act), 1))
            key: object = copy.deepcopy(act.declared)
            if act.device.type == "battery":
                msg["state"]["soc_pct"] = round(self.buildings[act.device.unit_id].battery_soc_pct, 1)
            elif act.device.type == "ev_charger":
                car = self.ev.cars[act.device.unit_id]
                msg["state"]["car_connected"] = car.connected
                msg["state"]["energy_needed_kwh"] = round(car.energy_needed_kwh, 2)
                key = (key, car.connected)
            changed = self._published.get(did) != key
            self._published[did] = key
            if changed or not only_changed:
                out.append(msg)
        return out

    # ------------------------------------------------------------- controls

    def handle_command(self, device_id: str, payload: object, real_ts: float) -> dict | None:
        cmd_id = payload.get("cmd_id") if isinstance(payload, dict) else None
        act = self.actuators.get(device_id)
        if act is None:
            return {"cmd_id": cmd_id, "status": "rejected", "reason": "dispositivo sconosciuto", "timestamp": real_ts}
        if not isinstance(payload, dict) or "command" not in payload:
            return {"cmd_id": cmd_id, "status": "rejected",
                    "reason": "comando non valido: atteso un oggetto JSON", "timestamp": real_ts}
        return act.apply_command(cmd_id, payload["command"], real_ts)

    def handle_scenario_control(self, payload: object, real_ts: float) -> ActiveScenario | None:
        if not isinstance(payload, dict):
            raise ScenarioError("comando di controllo non valido")
        action = payload.get("action")
        if action == "start":
            sc = self.scenarios.start(payload.get("scenario"), payload.get("target"), payload.get("params"),
                                      real_ts, self.clock.now)
            try:
                if sc.scenario == "sensor_fault":
                    self.sensors[sc.target].set_fault(sc.params["mode"], sc.params, real_ts)
                elif sc.scenario == "actuator_fault":
                    self.actuators[sc.target].set_fault(sc.params["mode"])
            except ValueError as exc:
                self.scenarios.stop(sc.scenario_id)
                raise ScenarioError(str(exc)) from None
        elif action == "stop":
            sc = self.scenarios.stop(payload.get("scenario_id"))
            if sc.scenario == "sensor_fault":
                self.sensors[sc.target].clear_fault()
            elif sc.scenario == "actuator_fault":
                self.actuators[sc.target].clear_fault()
        else:
            raise ScenarioError("comando di controllo non valido")
        self.scenarios_changed = True
        return sc

    def handle_clock_control(self, payload: object) -> None:
        if not isinstance(payload, dict) or not ({"speed", "jump_to"} & payload.keys()):
            raise ValueError("comando orologio non valido")
        if "speed" in payload:
            self.clock.set_speed(payload["speed"])
        if "jump_to" in payload:
            self.clock.jump_to(payload["jump_to"])
