"""Autonomic Planner Service implementing the Two-Tier Hybrid Decision Architecture.

Tier 1 — Safety Shielding (Deterministic Event-Condition-Action):
  Pre-emptively handles life-critical hazards (fire, gas/CO leak, earthquake)
  with hard-coded emergency sequences and locks the unit against Tier 2 overrides.

Tier 2 — Environmental Adaptation (Utility-Based Model-Predictive Planning):
  Uses SurrogateTransitionModel (learned from InfluxDB history and live MQTT streams)
  and UtilityPlanner (Multi-Attribute Utility Function balancing comfort, power, and
  actuator wear) to select and execute optimal adaptation plans.
"""
from __future__ import annotations

import copy
import json
import logging
import os
import threading
import time
from collections import defaultdict
from pathlib import Path

import paho.mqtt.client as mqtt

from executor.mqtt_adapter import MqttAdapter
from predictor import (
    DEFAULT_ACTUATORS,
    DEFAULT_WEATHER,
    SurrogateTransitionModel,
    UtilityPlanner,
    _parse_sim_time,
    normalize_actuators,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("planner")

DEFAULT_POLICIES_PATH = Path("/app/config/policies.json")
LOCAL_POLICIES_PATH = Path(__file__).resolve().parents[1] / "config" / "policies.json"


def load_planner_policies(path: Path | None = None) -> dict:
    candidates = [path] if path else [DEFAULT_POLICIES_PATH, LOCAL_POLICIES_PATH]
    for p in candidates:
        if p and p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                return raw.get("planner", {})
            except Exception as exc:
                logger.warning(f"Failed to read policies from {p}: {exc}")
    return {}


def _actuator_command_diff(current_actuators: dict, target_actuators: dict) -> dict[str, dict]:
    """Return only the actuator commands where target_actuators differs from current_actuators."""
    curr = normalize_actuators(current_actuators)
    targ = normalize_actuators(target_actuators)
    diff: dict[str, dict] = {}

    # 1. HVAC
    if targ["hvac"]["mode"] != curr["hvac"]["mode"]:
        if targ["hvac"]["mode"] == "off":
            diff["hvac"] = {"mode": "off"}
        else:
            diff["hvac"] = {"mode": targ["hvac"]["mode"], "setpoint": int(targ["hvac"]["setpoint"])}
    elif targ["hvac"]["mode"] != "off" and int(targ["hvac"]["setpoint"]) != int(curr["hvac"]["setpoint"]):
        diff["hvac"] = {"mode": targ["hvac"]["mode"], "setpoint": int(targ["hvac"]["setpoint"])}

    # 2. Ventilation
    if int(targ["ventilation"]["level"]) != int(curr["ventilation"]["level"]):
        diff["ventilation"] = {"level": int(targ["ventilation"]["level"])}

    # 3. Window
    if targ["window"]["position"] != curr["window"]["position"]:
        diff["window"] = {"position": targ["window"]["position"]}

    # 4. Blinds (only send if difference > 5% to avoid micro-adjustments)
    if abs(int(targ["blinds"]["position"]) - int(curr["blinds"]["position"])) > 5:
        diff["blinds"] = {"position": int(targ["blinds"]["position"])}

    return diff


class TwoTierPlanner:
    """Autonomic Planner combining Tier 1 Safety Shielding and Tier 2 Utility Optimization."""

    def __init__(self, adapter=None, mqtt_client=None, influx_client=None, policies: dict | None = None):
        self.policies = policies if policies is not None else load_planner_policies()
        self.adapter = adapter
        self.mqtt_client = mqtt_client
        self.influx_client = influx_client

        learn_cfg = self.policies.get("learning", {})
        self.transition_model = SurrogateTransitionModel(
            ridge_lambda=learn_cfg.get("ridge_lambda", 5.0),
            forgetting_factor=learn_cfg.get("forgetting_factor", 0.995),
        )
        self.utility_planner = UtilityPlanner(
            transition_model=self.transition_model,
            config=self.policies,
        )

        self.min_replan_interval_s = float(self.policies.get("min_replan_interval_s", 10.0))
        self.retrain_interval_s = float(learn_cfg.get("retrain_interval_s", 60.0))
        self.influx_window = str(learn_cfg.get("influx_window", "-2h"))
        self.influx_bucket = os.getenv("INFLUXDB_BUCKET", "iot_bucket")
        self.influx_org = os.getenv("INFLUXDB_ORG", "iot_org")

        self._lock = threading.RLock()
        self.clock_speed = 1.0
        self.model_topology = {}

        # State stores: area -> unit_id -> dict
        self.unit_sensors: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(dict))
        self.unit_actuators: dict[str, dict[str, dict]] = defaultdict(
            lambda: defaultdict(lambda: copy.deepcopy(DEFAULT_ACTUATORS))
        )
        self.unit_health: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(dict))

        # Tier 1 active hazards: area -> unit_id -> {risk_name: severity}
        self.active_hazards: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
        # Last Tier 1 dispatch timestamp to avoid flooding duplicate emergency commands every second
        self.last_tier1_dispatch: dict[tuple[str, str, str], float] = {}

        # Tier 2 state tracking
        self.prev_snapshots: dict[str, dict] = {}
        self.fresh_sensors: dict[str, set[str]] = defaultdict(set)
        self.last_plan_time: dict[str, float] = {}
        self.faulty_actuators: dict[str, dict[str, float]] = defaultdict(dict)  # unit_id -> {dev: expiry_ts}
        self.faulty_effective_state: dict[str, dict[str, dict]] = defaultdict(dict)  # unit_id -> {dev: state_dict}
        self.park_last_plan_ts = 0.0
        self.building_last_plan_ts: dict[str, float] = {}

    def is_tier1_active(self, area: str, unit_id: str) -> bool:
        """Return True if Tier 1 Safety Shield is currently active for this unit or complex."""
        with self._lock:
            unit_risks = self.active_hazards.get(area, {}).get(unit_id, {})
            if any(sev > 0 for sev in unit_risks.values()):
                return True
            park_risks = self.active_hazards.get("park", {}).get("park", {})
            if any(sev > 0 for sev in park_risks.values()):
                return True
            return False

    def _send_cmd(self, area: str, unit_id: str, device: str, command: dict, timeout: float = 0.3):
        if self.adapter is None:
            return {"status": "ok", "state": command}
        return self.adapter.send_command(area, unit_id, device, command, timeout=timeout)

    def _publish_plan(self, area: str, unit_id: str, plan_payload: dict) -> None:
        if self.mqtt_client is not None:
            try:
                self.mqtt_client.publish(
                    f"Complex/plan/{area}/{unit_id}",
                    json.dumps(plan_payload),
                    qos=1,
                    retain=True,
                )
            except Exception as exc:
                logger.debug(f"Failed to publish plan on Complex/plan/{area}/{unit_id}: {exc}")

    # ------------------------------------------------------------------ Tier 1: Safety Shield

    def handle_risk_event(self, area: str, unit_id: str, risk_name: str, severity: int, details: dict | None = None) -> dict:
        """Tier 1 Deterministic Event-Condition-Action (ECA) safety shield."""
        now = time.time()
        with self._lock:
            prev_sev = self.active_hazards[area][unit_id].get(risk_name, 0)
            if severity > 0:
                self.active_hazards[area][unit_id][risk_name] = severity
                last_sent = self.last_tier1_dispatch.get((area, unit_id, risk_name), 0.0)
                # Execute immediately on new hazard or severity escalation, or refresh every 30s
                if prev_sev == 0 or severity > prev_sev or (now - last_sent) >= 30.0:
                    self.last_tier1_dispatch[(area, unit_id, risk_name)] = now
                    commands_executed = self._execute_tier1_mitigation(area, unit_id, risk_name, severity)
                else:
                    commands_executed = []

                plan_info = {
                    "tier": 1,
                    "mode": "safety_shield",
                    "area": area,
                    "unit_id": unit_id,
                    "hazard": risk_name,
                    "severity": severity,
                    "details": details or {},
                    "commands_sent": commands_executed,
                    "timestamp": now,
                }
                self._publish_plan(area, unit_id, plan_info)
                return plan_info
            else:
                # Risk cleared (severity == 0)
                if risk_name in self.active_hazards[area][unit_id]:
                    del self.active_hazards[area][unit_id][risk_name]
                    self.last_tier1_dispatch.pop((area, unit_id, risk_name), None)
                    commands_executed = self._restore_after_tier1(area, unit_id, risk_name)
                    plan_info = {
                        "tier": 1,
                        "mode": "safety_restored",
                        "area": area,
                        "unit_id": unit_id,
                        "cleared_hazard": risk_name,
                        "commands_sent": commands_executed,
                        "timestamp": now,
                    }
                    self._publish_plan(area, unit_id, plan_info)
                    return plan_info
                return {"tier": 1, "mode": "idle", "area": area, "unit_id": unit_id}

    def _execute_tier1_mitigation(self, area: str, unit_id: str, risk_name: str, severity: int) -> list[dict]:
        logger.warning(f"TIER 1 SAFETY SHIELD: {risk_name} (severity={severity}) at {area}/{unit_id}")
        cmds = []

        def dispatch(t_area, t_unit, dev, cmd):
            self._send_cmd(t_area, t_unit, dev, cmd, timeout=0.1)
            self.unit_actuators[t_area][t_unit].setdefault(dev, {}).update(cmd)
            cmds.append({"area": t_area, "unit_id": t_unit, "device": dev, "command": cmd})

        if risk_name == "fire":
            # Apartment-level isolation & oxygen starvation
            if not unit_id.endswith("-S") and unit_id != area:
                dispatch(area, unit_id, "alarm", {"siren": "on"})
                dispatch(area, unit_id, "gas_valve", {"position": "closed"})
                dispatch(area, unit_id, "ventilation", {"level": 0})
                dispatch(area, unit_id, "window", {"position": "closed"})
                dispatch(area, unit_id, "hvac", {"mode": "off"})
                dispatch(area, unit_id, "resident_display", {"message": "EVACUATE FIRE", "level": "danger"})

            # Building & stairwell evacuation support
            dispatch(area, f"{area}-S", "smoke_vent", {"position": "open"})
            dispatch(area, f"{area}-S", "evacuation_siren", {"siren": "on"})
            dispatch(area, f"{area}-S", "stair_lights", {"mode": "evacuation"})
            dispatch(area, area, "elevator", {"mode": "recall"})
            dispatch("park", "park", "evacuation_signs", {"state": "on"})

        elif risk_name == "gas_co_leak":
            # Conflict resolution: if fire is active in the same unit, fire takes priority
            # (never open windows or run VMC during a fire as oxygen accelerates fire growth!)
            if self.active_hazards[area][unit_id].get("fire", 0) > 0:
                dispatch(area, unit_id, "gas_valve", {"position": "closed"})
                dispatch(area, unit_id, "window", {"position": "closed"})
                dispatch(area, unit_id, "ventilation", {"level": 0})
                return cmds

            # Gas/CO leak: shut off gas supply, maximize passive & active ventilation, turn off HVAC ignition
            dispatch(area, unit_id, "gas_valve", {"position": "closed"})
            dispatch(area, unit_id, "window", {"position": "open"})
            dispatch(area, unit_id, "ventilation", {"level": 3})
            dispatch(area, unit_id, "hvac", {"mode": "off"})
            dispatch(area, unit_id, "alarm", {"siren": "on"})
            dispatch(area, unit_id, "resident_display", {"message": "GAS/CO LEAK. WINDOWS OPEN.", "level": "danger"})

        elif risk_name == "earthquake":
            # Complex-wide seismic response: recall elevators, activate sirens & evacuation signs, shut gas valves
            dispatch("park", "park", "evacuation_signs", {"state": "on"})
            buildings = list(set(self.unit_sensors.keys()) | set(self.unit_actuators.keys()) | {"A", "B", "C", "D"})
            for b_id in sorted(buildings):
                if b_id in ("park", "complex"):
                    continue
                dispatch(b_id, b_id, "elevator", {"mode": "recall"})
                dispatch(b_id, f"{b_id}-S", "evacuation_siren", {"siren": "on"})
                dispatch(b_id, f"{b_id}-S", "stair_lights", {"mode": "evacuation"})
                known_units = set(self.unit_sensors.get(b_id, {}).keys()) | set(self.unit_actuators.get(b_id, {}).keys())
                for u_id in sorted(known_units):
                    if not u_id.endswith("-S") and u_id != b_id and not u_id.startswith("EV-"):
                        dispatch(b_id, u_id, "gas_valve", {"position": "closed"})
                        dispatch(b_id, u_id, "resident_display", {"message": "EARTHQUAKE: EVACUATE TO PARK", "level": "danger"})

        return cmds

    def _restore_after_tier1(self, area: str, unit_id: str, cleared_risk: str) -> list[dict]:
        logger.info(f"TIER 1 CLEARANCE: {cleared_risk} subsided at {area}/{unit_id}")
        cmds = []

        def dispatch(t_area, t_unit, dev, cmd):
            self._send_cmd(t_area, t_unit, dev, cmd, timeout=0.1)
            if "clear" in cmd:
                self.unit_actuators[t_area][t_unit][dev] = {"message": "", "level": "info"}
            else:
                self.unit_actuators[t_area][t_unit].setdefault(dev, {}).update(cmd)
            cmds.append({"area": t_area, "unit_id": t_unit, "device": dev, "command": cmd})

        earthquake_active = self.active_hazards.get("park", {}).get("park", {}).get("earthquake", 0) > 0

        if cleared_risk == "earthquake" and area == "park":
            # Restore buildings and apartments that do not have local active hazards
            buildings = set(self.unit_sensors.keys()) | set(self.unit_actuators.keys()) | {"A", "B", "C", "D"}
            for b_id in sorted(buildings):
                if b_id in ("park", "complex"):
                    continue
                known_units = set(self.unit_sensors.get(b_id, {}).keys()) | set(self.unit_actuators.get(b_id, {}).keys())
                for u_id in sorted(known_units):
                    if u_id.endswith("-S") or u_id == b_id or u_id.startswith("EV-"):
                        continue
                    if not self.active_hazards.get(b_id, {}).get(u_id):
                        dispatch(b_id, u_id, "gas_valve", {"position": "open"})
                        dispatch(b_id, u_id, "resident_display", {"clear": True})
                    else:
                        for rem_risk, rem_sev in list(self.active_hazards[b_id][u_id].items()):
                            if rem_sev > 0:
                                cmds.extend(self._execute_tier1_mitigation(b_id, u_id, rem_risk, rem_sev))

                b_has_evac_hazard = any(
                    r_map.get("fire", 0) > 0
                    for r_map in self.active_hazards.get(b_id, {}).values()
                )
                if not b_has_evac_hazard:
                    dispatch(b_id, f"{b_id}-S", "evacuation_siren", {"siren": "off"})
                    dispatch(b_id, f"{b_id}-S", "smoke_vent", {"position": "closed"})
                    dispatch(b_id, f"{b_id}-S", "stair_lights", {"mode": "normal"})
                    dispatch(b_id, b_id, "elevator", {"mode": "normal"})

        elif not unit_id.endswith("-S") and unit_id not in ("park", "complex", area):
            remaining_unit_risks = self.active_hazards[area][unit_id]
            if remaining_unit_risks:
                # Another hazard (e.g., gas_co_leak after fire clears) is still active in this unit:
                # re-apply its Tier 1 mitigation immediately!
                for rem_risk, rem_sev in list(remaining_unit_risks.items()):
                    if rem_sev > 0:
                        cmds.extend(self._execute_tier1_mitigation(area, unit_id, rem_risk, rem_sev))
            elif not earthquake_active:
                dispatch(area, unit_id, "alarm", {"siren": "off"})
                dispatch(area, unit_id, "gas_valve", {"position": "open"})
                dispatch(area, unit_id, "resident_display", {"clear": True})

        # Check if any unit in the building still has an active evacuation hazard (fire or earthquake)
        if area not in ("park", "complex") and not earthquake_active:
            building_has_fire = any(
                r_map.get("fire", 0) > 0 for r_map in self.active_hazards.get(area, {}).values()
            )
            if not building_has_fire:
                dispatch(area, f"{area}-S", "evacuation_siren", {"siren": "off"})
                dispatch(area, f"{area}-S", "smoke_vent", {"position": "closed"})
                dispatch(area, f"{area}-S", "stair_lights", {"mode": "normal"})
                dispatch(area, area, "elevator", {"mode": "normal"})

        # Turn off complex-wide park evacuation signs if no fire or earthquake remains in the complex
        any_complex_evac = any(
            r_name in ("fire", "earthquake") and sev > 0
            for a_map in self.active_hazards.values()
            for r_map in a_map.values()
            for r_name, sev in r_map.items()
        )
        if not any_complex_evac:
            dispatch("park", "park", "evacuation_signs", {"state": "off"})

        return cmds

    # ------------------------------------------------------------------ Tier 2: Utility-Based Planning

    def _check_actuator_power_fault(self, area: str, unit_id: str, typ: str,
                                    state_dict: dict, power_w: float | None, now: float) -> bool:
        """Detect silent `no_effect` actuator fault when reported power_w contradicts declared state."""
        if power_w is None or area in ("park", "complex") or unit_id.endswith("-S") or unit_id == area:
            return False

        # Only check electric power discrepancies if the apartment is powered
        apt_power = self.unit_sensors.get(area, {}).get(unit_id, {}).get("power")
        if apt_power is not None and apt_power <= 1.0:
            return False

        pw = float(power_w)
        exp_ts = max(now, time.time()) + 180.0
        if typ == "ventilation" and "level" in state_dict:
            decl_lvl = int(state_dict["level"])
            expected_w = 30.0 * decl_lvl
            if abs(pw - expected_w) > 12.0:
                eff_lvl = max(0, min(3, int(round(pw / 30.0))))
                logger.warning(
                    f"Tier 2 Monitor: silent no_effect fault on {unit_id}.ventilation "
                    f"(declared level={decl_lvl}, power_w={pw}W -> effective level={eff_lvl})"
                )
                self.faulty_actuators[unit_id]["ventilation"] = exp_ts
                self.faulty_effective_state[unit_id]["ventilation"] = {"level": eff_lvl}
                self.unit_actuators[area][unit_id]["ventilation"] = {"level": eff_lvl}
                return True

        elif typ == "hvac" and "mode" in state_dict:
            decl_mode = state_dict.get("mode", "off")
            setpoint = float(state_dict.get("setpoint", 22))
            t_in = self.unit_sensors.get(area, {}).get(unit_id, {}).get("temperature")
            if t_in is not None:
                if decl_mode == "cool" and t_in > setpoint + 1.0 and pw < 100.0:
                    logger.warning(
                        f"Tier 2 Monitor: silent no_effect fault on {unit_id}.hvac "
                        f"(declared mode=cool at T={t_in:.1f}C > {setpoint}C, but power_w={pw}W)"
                    )
                    self.faulty_actuators[unit_id]["hvac"] = exp_ts
                    eff_st = {"mode": "off", "setpoint": int(setpoint)}
                    self.faulty_effective_state[unit_id]["hvac"] = eff_st
                    self.unit_actuators[area][unit_id]["hvac"] = copy.deepcopy(eff_st)
                    return True
                elif decl_mode == "heat" and t_in < setpoint - 1.0 and pw < 20.0:
                    logger.warning(
                        f"Tier 2 Monitor: silent no_effect fault on {unit_id}.hvac "
                        f"(declared mode=heat at T={t_in:.1f}C < {setpoint}C, but power_w={pw}W)"
                    )
                    self.faulty_actuators[unit_id]["hvac"] = exp_ts
                    eff_st = {"mode": "off", "setpoint": int(setpoint)}
                    self.faulty_effective_state[unit_id]["hvac"] = eff_st
                    self.unit_actuators[area][unit_id]["hvac"] = copy.deepcopy(eff_st)
                    return True

        return False

    def process_monitored_message(self, topic: str, payload: dict) -> None:
        """Ingest validated sensor readings and actuator states from Complex/monitored/#."""
        parts = topic.split("/")
        if len(parts) < 5:
            return

        area, unit_id, typ = parts[2], parts[3], parts[4]
        kind = payload.get("kind", "sensor")
        quality = payload.get("quality", "ok")
        now = float(payload.get("timestamp", time.time()))
        sim_ts = _parse_sim_time(payload.get("sim_time"))

        with self._lock:
            if kind == "actuator" or "state" in payload:
                state_dict = payload.get("state")
                if isinstance(state_dict, dict):
                    power_w = payload.get("power_w")
                    if self._check_actuator_power_fault(area, unit_id, typ, state_dict, power_w, now):
                        return
                    active_faults = self._get_active_faulty_actuators(unit_id, time.time())
                    if typ in active_faults and typ in self.faulty_effective_state.get(unit_id, {}):
                        self.unit_actuators[area][unit_id][typ] = copy.deepcopy(
                            self.faulty_effective_state[unit_id][typ]
                        )
                    else:
                        self.unit_actuators[area][unit_id][typ] = copy.deepcopy(state_dict)
                return

            # Sensor or derived reading
            if "value" not in payload:
                return

            # Ignore suspect readings for Tier 2 comfort optimization if device is marked faulty,
            # but keep emergency sensors (smoke, gas, co, seismic) per safety principle D17
            health_status = self.unit_health[area][unit_id].get(typ, "ok")
            if (quality == "suspect" or health_status in ("stuck", "drift", "offline", "out_of_range")) and typ not in ("smoke", "gas", "co", "seismic"):
                return

            val = float(payload["value"])
            self.unit_sensors[area][unit_id][typ] = val

            # Direct fast-reflex safety check in case monitored emergency reading arrives before analyzer tick
            if area == "park" and typ == "seismic" and val >= 3.5:
                self.handle_risk_event("park", "park", "earthquake", min(100, max(50, int(val * 15))), {"seismic_mw": val})
            elif area != "park" and not unit_id.endswith("-S") and unit_id != area:
                if typ == "smoke" and val > 10.0:
                    self.handle_risk_event(area, unit_id, "fire", 100, {"smoke": val})
                elif (typ == "gas" and val > 10.0) or (typ == "co" and val > 100.0 and self.unit_sensors[area][unit_id].get("smoke", 0.0) <= 2.0):
                    self.handle_risk_event(area, unit_id, "gas_co_leak", 80, {typ: val})

            # Online transition model learning for apartment environmental states:
            # Wait until temperature, humidity, and co2 have all reported fresh values in the current cycle
            if (area not in ("park", "complex")
                    and not unit_id.endswith("-S")
                    and unit_id != area
                    and typ in ("temperature", "humidity", "co2")):
                self.fresh_sensors[unit_id].add(typ)
                if {"temperature", "humidity", "co2"} <= self.fresh_sensors[unit_id]:
                    self.fresh_sensors[unit_id].clear()
                    self._update_online_learning(area, unit_id, now, sim_ts)

    def _detect_silent_window_fault(self, area: str, unit_id: str, prev: dict,
                                    curr_state: dict, dt_s: float, now: float) -> bool:
        """Detect silent `no_effect` fault on window when declared open/closed disagrees with physics."""
        if dt_s < 180.0:
            return False
        prev_act = normalize_actuators(prev["actuators"])
        decl_pos = prev_act["window"]["position"]
        if decl_pos != "open":
            return False

        t_in = float(prev["state"]["temperature"])
        t_out = float(prev["weather"].get("temperature", 18.0))
        c_in = float(prev["state"]["co2"])
        c_out = float(prev["weather"].get("co2_outdoor", 420.0))

        # Only testable when there is a strong indoor-outdoor gradient
        if abs(t_out - t_in) < 4.5 and (c_in - c_out) < 400.0:
            return False

        act_open = copy.deepcopy(prev_act)
        act_open["window"] = {"position": "open"}
        act_closed = copy.deepcopy(prev_act)
        act_closed["window"] = {"position": "closed"}

        pred_open = self.transition_model.predict_next_state(prev["state"], act_open, prev["weather"], horizon_s=dt_s)
        pred_closed = self.transition_model.predict_next_state(prev["state"], act_closed, prev["weather"], horizon_s=dt_s)

        dt_sep = abs(pred_open["temperature"] - pred_closed["temperature"])
        if dt_sep >= 0.6:
            err_open = abs(curr_state["temperature"] - pred_open["temperature"])
            err_closed = abs(curr_state["temperature"] - pred_closed["temperature"])
            if err_closed < 0.35 * err_open:
                logger.warning(
                    f"Tier 2 Monitor: silent no_effect fault detected on {unit_id}.window "
                    f"(declared open, but dT matched closed window: obs={curr_state['temperature']:.2f}C, "
                    f"pred_open={pred_open['temperature']:.2f}C, pred_closed={pred_closed['temperature']:.2f}C)"
                )
                self.faulty_actuators[unit_id]["window"] = max(now, time.time()) + 180.0
                self.faulty_effective_state[unit_id]["window"] = {"position": "closed"}
                self.unit_actuators[area][unit_id]["window"] = {"position": "closed"}
                return True
        return False

    def _update_online_learning(self, area: str, unit_id: str, now: float, sim_ts: float | None) -> None:
        sensors = self.unit_sensors[area][unit_id]
        if not all(k in sensors for k in ("temperature", "humidity", "co2")):
            return

        curr_state = {
            "temperature": sensors["temperature"],
            "humidity": sensors["humidity"],
            "co2": sensors["co2"],
            "occupancy": sensors.get("occupancy", 1.0),
        }
        curr_act = copy.deepcopy(self.unit_actuators[area][unit_id])
        weather = {**DEFAULT_WEATHER, **self.unit_sensors.get("park", {}).get("park", {})}

        prev = self.prev_snapshots.get(unit_id)
        if prev is not None:
            if sim_ts is not None and prev.get("sim_ts") is not None:
                dt_s = sim_ts - prev["sim_ts"]
            else:
                dt_s = (now - prev["timestamp"]) * max(1.0, self.clock_speed)

            # Update once at least 8 seconds of simulated time have elapsed
            if dt_s >= 8.0:
                if not self.is_tier1_active(area, unit_id):
                    silent_fault = self._detect_silent_window_fault(area, unit_id, prev, curr_state, dt_s, now)
                    if not silent_fault:
                        self.transition_model.observe_transition(
                            prev["state"], prev["actuators"], prev["weather"], curr_state, dt_s
                        )
                    else:
                        curr_act = copy.deepcopy(self.unit_actuators[area][unit_id])
                self.prev_snapshots[unit_id] = {
                    "state": curr_state,
                    "actuators": curr_act,
                    "weather": weather,
                    "timestamp": now,
                    "sim_ts": sim_ts,
                }
        else:
            self.prev_snapshots[unit_id] = {
                "state": curr_state,
                "actuators": curr_act,
                "weather": weather,
                "timestamp": now,
                "sim_ts": sim_ts,
            }

    def _get_active_faulty_actuators(self, unit_id: str, now: float) -> dict[str, dict]:
        faults = self.faulty_actuators.get(unit_id, {})
        eff_map = self.faulty_effective_state.get(unit_id, {})
        expired = [dev for dev, exp in faults.items() if now >= exp]
        for dev in expired:
            del faults[dev]
            eff_map.pop(dev, None)
        return {
            dev: copy.deepcopy(eff_map.get(dev, DEFAULT_ACTUATORS.get(dev, {})))
            for dev in faults
        }

    def plan_for_apartment(self, area: str, unit_id: str, force: bool = False) -> dict | None:
        """Run Tier 2 Utility-Based Model-Predictive Planning for a single apartment."""
        if area in ("park", "complex") or unit_id.endswith("-S") or unit_id == area or unit_id.startswith("EV-"):
            return None

        now = time.time()
        with self._lock:
            # Pre-emption check: Tier 1 Safety Shield always takes priority over Tier 2
            if self.is_tier1_active(area, unit_id):
                return None

            if not force and (now - self.last_plan_time.get(unit_id, 0.0)) < self.min_replan_interval_s:
                return None

            sensors = self.unit_sensors.get(area, {}).get(unit_id, {})
            if "temperature" not in sensors and "co2" not in sensors:
                return None

            state = {
                "temperature": sensors.get("temperature", 22.0),
                "humidity": sensors.get("humidity", 50.0),
                "co2": sensors.get("co2", 500.0),
                "light": sensors.get("light", 300.0),
                "noise_level": sensors.get("noise_level", 35.0),
                "occupancy": sensors.get("occupancy", 1.0),
            }
            faulty_map = self._get_active_faulty_actuators(unit_id, now)
            for f_dev, f_st in faulty_map.items():
                self.unit_actuators[area][unit_id][f_dev] = copy.deepcopy(f_st)
            cur_act = copy.deepcopy(self.unit_actuators[area][unit_id])
            weather = {**DEFAULT_WEATHER, **self.unit_sensors.get("park", {}).get("park", {})}
            energy_balance = float(self.unit_sensors.get(area, {}).get(area, {}).get("energy_balance", 0.0))

            decision = self.utility_planner.select_best_plan(
                state=state,
                current_actuators=cur_act,
                weather=weather,
                faulty_actuators=faulty_map,
                energy_balance_w=energy_balance,
            )
            selected = decision["selected"]
            cmds_to_send = _actuator_command_diff(cur_act, selected["actuators"])

            commands_sent = {}
            new_fault_detected = False

            for dev, cmd in cmds_to_send.items():
                if dev in faulty_map:
                    continue
                ack = self._send_cmd(area, unit_id, dev, cmd, timeout=0.4)
                if ack is None:
                    # Actuator did not acknowledge (no_ack fault) -> mark faulty and replan
                    logger.warning(f"Tier 2 Executor: no_ack from {unit_id}.{dev}, marking faulty and selecting fallback")
                    self.faulty_actuators[unit_id][dev] = now + 120.0
                    self.faulty_effective_state[unit_id][dev] = copy.deepcopy(cur_act.get(dev, DEFAULT_ACTUATORS.get(dev, {})))
                    new_fault_detected = True
                elif isinstance(ack, dict) and ack.get("status") == "ok":
                    commands_sent[dev] = cmd
                    self.unit_actuators[area][unit_id][dev].update(cmd)
                else:
                    logger.warning(f"Tier 2 Executor: command rejected by {unit_id}.{dev}: {ack}")

            # If an actuator failed with no_ack during execution, immediately re-select an alternative plan
            if new_fault_detected:
                faulty_map = self._get_active_faulty_actuators(unit_id, now)
                decision = self.utility_planner.select_best_plan(
                    state=state,
                    current_actuators=self.unit_actuators[area][unit_id],
                    weather=weather,
                    faulty_actuators=faulty_map,
                    energy_balance_w=energy_balance,
                )
                selected = decision["selected"]
                fallback_cmds = _actuator_command_diff(self.unit_actuators[area][unit_id], selected["actuators"])
                for dev, cmd in fallback_cmds.items():
                    if dev in faulty_map:
                        continue
                    ack = self._send_cmd(area, unit_id, dev, cmd, timeout=0.4)
                    if isinstance(ack, dict) and ack.get("status") == "ok":
                        commands_sent[dev] = cmd
                        self.unit_actuators[area][unit_id][dev].update(cmd)

            if unit_id in self.prev_snapshots and commands_sent:
                self.prev_snapshots[unit_id]["actuators"] = copy.deepcopy(self.unit_actuators[area][unit_id])

            self.last_plan_time[unit_id] = now

            plan_record = {
                "tier": 2,
                "mode": "utility_optimization",
                "area": area,
                "unit_id": unit_id,
                "selected_plan": selected["name"],
                "utility": selected["utility"],
                "comfort_score": selected["comfort_score"],
                "comfort_details": selected["comfort_details"],
                "power_w": selected["power_w"],
                "wear": selected["wear"],
                "predicted_state": selected["predicted_state"],
                "commands_sent": commands_sent,
                "faulty_actuators": sorted(faulty_map.keys()),
                "model_updates": self.transition_model.n_updates,
                "timestamp": now,
            }
            self._publish_plan(area, unit_id, plan_record)
            return plan_record

    def plan_park_and_microgrid(self) -> None:
        """Adapt outdoor park effectors (irrigation, park_lights) and building battery/EV microgrid."""
        now = time.time()
        with self._lock:
            # 1. Park adaptation
            if now - self.park_last_plan_ts >= self.min_replan_interval_s:
                park_sensors = self.unit_sensors.get("park", {}).get("park", {})
                if park_sensors:
                    self.park_last_plan_ts = now
                    soil = float(park_sensors.get("soil_moisture", 50.0))
                    rain = float(park_sensors.get("rain_level", 0.0))
                    temp = float(park_sensors.get("temperature", 18.0))
                    light = float(park_sensors.get("light", 10000.0))

                    park_act = self.unit_actuators["park"]["park"]
                    curr_irrig = park_act.get("irrigation", {}).get("state", "off")
                    target_irrig = "on" if (soil < 35.0 and rain < 0.5 and temp > 2.0) else "off"
                    if target_irrig != curr_irrig:
                        ack = self._send_cmd("park", "park", "irrigation", {"state": target_irrig}, timeout=0.2)
                        if isinstance(ack, dict) and ack.get("status") == "ok":
                            park_act["irrigation"] = {"state": target_irrig}

                    curr_lights = park_act.get("park_lights", {}).get("state", "off")
                    target_lights = "on" if light < 150.0 else "off"
                    if target_lights != curr_lights:
                        ack = self._send_cmd("park", "park", "park_lights", {"state": target_lights}, timeout=0.2)
                        if isinstance(ack, dict) and ack.get("status") == "ok":
                            park_act["park_lights"] = {"state": target_lights}

            # 2. Building microgrid adaptation (battery & EV chargers)
            for b_id in ("A", "B", "C", "D"):
                if now - self.building_last_plan_ts.get(b_id, 0.0) < self.min_replan_interval_s:
                    continue
                b_sensors = self.unit_sensors.get(b_id, {}).get(b_id, {})
                if "energy_balance" not in b_sensors and "pv_power" not in b_sensors:
                    continue
                self.building_last_plan_ts[b_id] = now

                eb = float(b_sensors.get("energy_balance", 0.0))
                b_act = self.unit_actuators[b_id][b_id]
                curr_bat = b_act.get("battery", {}).get("mode", "idle")
                if eb > 600.0:
                    target_bat = "charge"
                elif eb < -600.0:
                    target_bat = "discharge"
                else:
                    target_bat = "idle"

                if target_bat != curr_bat:
                    ack = self._send_cmd(b_id, b_id, "battery", {"mode": target_bat}, timeout=0.2)
                    if isinstance(ack, dict) and ack.get("status") == "ok":
                        b_act["battery"] = {"mode": target_bat}

                # EV charger peak shaving & solar self-consumption (EV-A..EV-D)
                ev_id = f"EV-{b_id}"
                ev_act = self.unit_actuators[b_id][ev_id].get("ev_charger", {"mode": "charge", "max_power_w": 7400})
                curr_ev_mode = ev_act.get("mode", "charge")
                curr_ev_max = int(ev_act.get("max_power_w", 7400))
                if eb < -4000.0:
                    target_ev = {"mode": "pause", "max_power_w": 0}
                elif eb < -1500.0:
                    target_ev = {"mode": "charge", "max_power_w": 3700}
                else:
                    target_ev = {"mode": "charge", "max_power_w": 7400}

                if target_ev["mode"] != curr_ev_mode or abs(target_ev["max_power_w"] - curr_ev_max) > 500:
                    ack = self._send_cmd(b_id, ev_id, "ev_charger", target_ev, timeout=0.2)
                    if isinstance(ack, dict) and ack.get("status") == "ok":
                        self.unit_actuators[b_id][ev_id]["ev_charger"] = target_ev

    def run_periodic_cycle(self) -> list[dict]:
        """Run periodic InfluxDB model retraining and Tier 2 planning across all known units."""
        now = time.time()
        if (self.influx_client is not None
                and (now - self.transition_model.last_influx_train_ts) >= self.retrain_interval_s):
            self.transition_model.fit_from_influxdb(
                self.influx_client,
                bucket=self.influx_bucket,
                org=self.influx_org,
                window=self.influx_window,
                clock_speed=self.clock_speed,
            )

        plans = []
        with self._lock:
            areas_units = [
                (area, list(units.keys()))
                for area, units in self.unit_sensors.items()
                if area not in ("park", "complex")
            ]

        for area, unit_ids in areas_units:
            for unit_id in unit_ids:
                if unit_id.endswith("-S") or unit_id == area:
                    continue
                res = self.plan_for_apartment(area, unit_id)
                if res is not None:
                    plans.append(res)

        self.plan_park_and_microgrid()
        return plans

    # ------------------------------------------------------------------ MQTT routing

    def on_mqtt_message(self, topic: str, payload: dict) -> None:
        if topic == "Complex/clock":
            speed = payload.get("speed")
            if isinstance(speed, (int, float)) and speed > 0:
                self.clock_speed = float(speed)
            return

        if topic == "Complex/model":
            self.model_topology = payload
            return

        if topic.startswith("Complex/monitored/"):
            self.process_monitored_message(topic, payload)
            return

        if topic.startswith("Complex/health/"):
            parts = topic.split("/")
            if len(parts) >= 5:
                area, unit_id, typ = parts[2], parts[3], parts[4]
                with self._lock:
                    self.unit_health[area][unit_id][typ] = payload.get("status", "ok")
            return

        if topic.startswith("Complex/analysis/"):
            parts = topic.split("/")
            # Complex/analysis/{area}/{unit_id}/risk/{risk_name}
            if len(parts) >= 6 and parts[4] == "risk":
                msg_ts = payload.get("timestamp")
                if isinstance(msg_ts, (int, float)) and (time.time() - float(msg_ts)) > 120.0:
                    logger.info(f"Ignoring stale retained risk message on {topic} from {int(time.time() - float(msg_ts))}s ago")
                    return
                area, unit_id, risk_name = parts[2], parts[3], parts[5]
                severity = int(payload.get("severity", 0))
                details = payload.get("details", {})
                self.handle_risk_event(area, unit_id, risk_name, severity, details)
            # Complex/analysis/{area}/{unit_id}/comfort
            elif len(parts) >= 5 and parts[4] == "comfort":
                area, unit_id = parts[2], parts[3]
                sensors_snap = payload.get("sensors")
                if isinstance(sensors_snap, dict):
                    with self._lock:
                        for k, v in sensors_snap.items():
                            if isinstance(v, (int, float)):
                                self.unit_sensors[area][unit_id][k] = float(v)
                self.plan_for_apartment(area, unit_id)


def _init_influx_client():
    influx_url = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
    influx_token = os.getenv("INFLUXDB_TOKEN", "admin_token")
    influx_org = os.getenv("INFLUXDB_ORG", "iot_org")
    try:
        from influxdb_client import InfluxDBClient
        client = InfluxDBClient(url=influx_url, token=influx_token, org=influx_org)
        logger.info(f"Planner initialized InfluxDB client for {influx_url}")
        return client
    except Exception as exc:
        logger.warning(f"Planner could not initialize InfluxDB client: {exc}")
        return None


def main():
    mqtt_broker = os.getenv("MQTT_BROKER", "mosquitto")
    mqtt_port = int(os.getenv("MQTT_PORT", 1883))
    mqtt_user = os.getenv("MQTT_USERNAME")
    mqtt_password = os.getenv("MQTT_PASSWORD")

    adapter = MqttAdapter(broker=mqtt_broker, port=mqtt_port, username=mqtt_user, password=mqtt_password)
    influx_client = _init_influx_client()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="iot_planner")

    planner = TwoTierPlanner(
        adapter=adapter,
        mqtt_client=client,
        influx_client=influx_client,
    )

    # Attempt initial historical training from InfluxDB on startup
    if influx_client is not None:
        planner.transition_model.fit_from_influxdb(
            influx_client,
            bucket=planner.influx_bucket,
            org=planner.influx_org,
            window=planner.influx_window,
        )

    def on_connect(c, userdata, flags, reason_code, properties):
        logger.info("Planner connected, subscribing to Complex/analysis/#, Complex/monitored/#, Complex/health/#, Complex/clock, Complex/model")
        c.subscribe("Complex/analysis/#", qos=1)
        c.subscribe("Complex/monitored/#", qos=0)
        c.subscribe("Complex/health/#", qos=1)
        c.subscribe("Complex/clock", qos=1)
        c.subscribe("Complex/model", qos=1)

    def on_message(c, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            if isinstance(payload, dict):
                planner.on_mqtt_message(msg.topic, payload)
        except Exception as exc:
            logger.error(f"Planner error processing message on {msg.topic}: {exc}")

    if mqtt_user and mqtt_password:
        client.username_pw_set(mqtt_user, mqtt_password)

    client.on_connect = on_connect
    client.on_message = on_message

    while True:
        try:
            client.connect(mqtt_broker, mqtt_port, 60)
            break
        except Exception as exc:
            logger.warning(f"Planner connection failed: {exc}. Retrying in 5s...")
            time.sleep(5)

    client.loop_start()
    try:
        while True:
            time.sleep(5)
            planner.run_periodic_cycle()
    except KeyboardInterrupt:
        logger.info("Shutting down planner...")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
