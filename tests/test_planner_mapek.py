"""Comprehensive unit and closed-loop integration tests for the Two-Tier Hybrid
Decision Architecture (Tier 1 Safety Shielding + Tier 2 Utility-Based Model-Predictive
Planning) and end-to-end MAPE-K integration across Simulator, Monitor, Analyzer, and Planner.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import pytest  # noqa: F401
except ImportError:
    pytest = None

ROOT = Path(__file__).resolve().parents[1]
for sub in (ROOT, ROOT / "planner", ROOT / "analyzer", ROOT / "monitor", ROOT / "simulator"):
    p_str = str(sub)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)

from predictor import (  # noqa: E402
    SurrogateTransitionModel,
    UtilityPlanner,
    compute_actuator_wear,
    compute_comfort_score,
    estimate_action_power,
    predict_breach_probability,
)
from plan import TwoTierPlanner, _actuator_command_diff  # noqa: E402
from engine import AnalyzerEngine  # noqa: E402
from rules import evaluate_risks  # noqa: E402
from validator import Validator  # noqa: E402
from derived import DerivedCalculator  # noqa: E402
from model import load_model  # noqa: E402
from simulation import Simulation  # noqa: E402


# ------------------------------------------------------------------ Helpers & Mocks

class DummyAdapter:
    def __init__(self, fail_devices: set[str] | None = None):
        self.commands: list[tuple[str, str, str, dict]] = []
        self.fail_devices = fail_devices or set()

    def send_command(self, area: str, unit_id: str, device: str, command: dict, timeout: float = 0.5):
        self.commands.append((area, unit_id, device, command))
        if f"{unit_id}.{device}" in self.fail_devices or device in self.fail_devices:
            return None  # Simulate no_ack fault
        return {"cmd_id": "test-ack", "status": "ok", "state": command, "timestamp": time.time()}


class DummyMqttClient:
    def __init__(self):
        self.published: list[tuple[str, dict, bool]] = []

    def publish(self, topic: str, payload: str, qos: int = 0, retain: bool = False):
        data = json.loads(payload) if isinstance(payload, str) else payload
        self.published.append((topic, data, retain))


# ------------------------------------------------------------------ 1. SurrogateTransitionModel Tests

def test_predict_breach_probability_edge_cases():
    assert predict_breach_probability([], 300, 30.0) == 0.0
    now = int(time.time())
    assert predict_breach_probability([{"timestamp": now, "value": 35.0}], 300, 30.0) == 1.0
    assert predict_breach_probability([{"timestamp": now, "value": 20.0}], 300, 30.0) == 0.0

    rising = [
        {"timestamp": now - 120, "value": 26.0},
        {"timestamp": now - 60, "value": 27.5},
        {"timestamp": now, "value": 29.0},
    ]
    prob = predict_breach_probability(rising, 300, 30.0)
    assert 0.8 <= prob <= 1.0


def test_surrogate_model_physical_predictions():
    model = SurrogateTransitionModel()
    warm_state = {"temperature": 27.5, "humidity": 55.0, "co2": 1200.0, "occupancy": 2}
    cool_weather = {"temperature": 18.0, "humidity": 45.0, "light": 30000.0, "noise_level": 45.0}

    # Window open vs closed in cool weather
    pred_closed = model.predict_next_state(
        warm_state,
        {"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        cool_weather,
        horizon_s=1800,
    )
    pred_open = model.predict_next_state(
        warm_state,
        {"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "open"}, "blinds": {"position": 50}},
        cool_weather,
        horizon_s=1800,
    )
    assert pred_open["temperature"] < pred_closed["temperature"] - 2.0
    assert pred_open["co2"] < pred_closed["co2"] - 300.0

    # Active HVAC cooling in hot weather (low daytime RH at 34C)
    hot_weather = {"temperature": 34.0, "humidity": 30.0, "light": 80000.0, "noise_level": 50.0}
    pred_no_hvac = model.predict_next_state(
        warm_state,
        {"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 30}},
        hot_weather,
        horizon_s=1800,
    )
    pred_cool = model.predict_next_state(
        warm_state,
        {"hvac": {"mode": "cool", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 30}},
        hot_weather,
        horizon_s=1800,
    )
    assert pred_cool["temperature"] < pred_no_hvac["temperature"] - 1.0
    assert pred_cool["humidity"] < warm_state["humidity"]


def test_surrogate_model_online_learning_and_bounds():
    model = SurrogateTransitionModel(ridge_lambda=2.0)
    s0 = {"temperature": 25.0, "humidity": 55.0, "co2": 900.0, "occupancy": 2}
    act = {"hvac": {"mode": "cool", "setpoint": 21}, "ventilation": {"level": 2}, "window": {"position": "closed"}, "blinds": {"position": 50}}
    w = {"temperature": 30.0, "humidity": 50.0, "light": 50000.0}
    s1 = {"temperature": 24.8, "humidity": 54.5, "co2": 870.0, "occupancy": 2}

    # Invalid dt should be ignored
    assert not model.observe_transition(s0, act, w, s1, dt_seconds=0.0)
    assert not model.observe_transition(s0, act, w, s1, dt_seconds=99999.0)

    # Valid transition updates model
    for _ in range(10):
        assert model.observe_transition(s0, act, w, s1, dt_seconds=300.0)
    assert model.n_updates == 10
    # Verify physical sign invariants remain intact
    assert model.theta_T[0] > 0      # conduction > 0
    assert model.theta_T[1] > 0      # window > 0
    assert model.theta_T[4] > 0      # heating > 0
    assert model.theta_T[5] < 0      # cooling < 0
    assert model.theta_C[3] > 0      # window CO2 exchange > 0


def test_surrogate_model_influxdb_batch_training():
    class FakeRecord:
        def __init__(self, unit_id, typ, field, val, ts):
            self.values = {"unit_id": unit_id, "type": typ}
            self._field = field
            self._val = val
            self._ts = datetime.fromtimestamp(ts)

        def get_field(self):
            return self._field

        def get_value(self):
            return self._val

        def get_time(self):
            return self._ts

    class FakeTable:
        def __init__(self, records):
            self.records = records

    class FakeQueryApi:
        def query(self, flux_query, org=None):
            base = 1790440000
            if "readings" in flux_query:
                recs = []
                for step in range(5):
                    t = base + step * 30
                    recs.append(FakeRecord("A-0-1", "temperature", "value", 25.0 - 0.1 * step, t))
                    recs.append(FakeRecord("A-0-1", "humidity", "value", 55.0 - 0.2 * step, t))
                    recs.append(FakeRecord("A-0-1", "co2", "value", 800.0 - 15.0 * step, t))
                    recs.append(FakeRecord("A-0-1", "occupancy", "value", 2.0, t))
                    recs.append(FakeRecord("park", "temperature", "value", 19.0, t))
                    recs.append(FakeRecord("park", "humidity", "value", 50.0, t))
                    recs.append(FakeRecord("park", "light", "value", 20000.0, t))
                return [FakeTable(recs)]
            return [FakeTable([FakeRecord("A-0-1", "window", "position", "open", base)])]

    class FakeInfluxClient:
        def query_api(self):
            return FakeQueryApi()

    model = SurrogateTransitionModel()
    count = model.fit_from_influxdb(FakeInfluxClient(), bucket="iot_bucket", org="iot_org", window="-1h", clock_speed=10.0)
    assert count == 4
    assert model.n_updates == 4


# ------------------------------------------------------------------ 2. Tier 2 UtilityPlanner Tests

def test_utility_planner_prefers_passive_cooling_when_outdoor_is_cool():
    """REPORT_SE4AS §6 Environmental Adaptation Test (Part 1):
    When indoor is warm (27.5°C) and outdoor is cooler (18.5°C), Tier 2 must select
    passive cooling (opening windows, 0W HVAC) rather than expensive active HVAC (1500W).
    """
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 27.5, "humidity": 52.0, "co2": 700.0, "occupancy": 2},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        weather={"temperature": 18.5, "humidity": 50.0, "light": 25000.0, "noise_level": 45.0, "rain_level": 0.0, "wind_speed": 5.0},
    )
    selected = res["selected"]
    assert selected["actuators"]["window"]["position"] == "open"
    assert selected["actuators"]["hvac"]["mode"] == "off"


def test_utility_planner_switches_to_active_hvac_when_outdoor_is_hot():
    """REPORT_SE4AS §6 Environmental Adaptation Test (Part 2):
    When indoor is hot (28.0°C) and outdoor is even hotter (34.0°C heatwave),
    passive cooling is counterproductive and Tier 2 must select active HVAC cooling with windows closed.
    """
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 28.0, "humidity": 58.0, "co2": 650.0, "occupancy": 2},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        weather={"temperature": 34.0, "humidity": 55.0, "light": 85000.0, "noise_level": 50.0, "rain_level": 0.0, "wind_speed": 5.0},
    )
    selected = res["selected"]
    assert selected["actuators"]["hvac"]["mode"] == "cool"
    assert selected["actuators"]["window"]["position"] == "closed"
    assert selected["actuators"]["blinds"]["position"] <= 30


def test_utility_planner_selects_active_heating_in_cold_wave():
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 16.5, "humidity": 48.0, "co2": 600.0, "occupancy": 2},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 50}},
        weather={"temperature": 0.5, "humidity": 65.0, "light": 20000.0, "noise_level": 45.0},
    )
    selected = res["selected"]
    assert selected["actuators"]["hvac"]["mode"] == "heat"
    assert selected["actuators"]["window"]["position"] == "closed"


def test_utility_planner_handles_high_co2_in_cold_or_rainy_weather_via_vmc():
    """When CO2 is high (1350 ppm) but it is cold and raining outside, opening a window
    is penalized, so Tier 2 boosts VMC ventilation while keeping the window closed.
    """
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 22.0, "humidity": 55.0, "co2": 1350.0, "occupancy": 3},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        weather={"temperature": 6.0, "humidity": 85.0, "light": 10000.0, "rain_level": 15.0, "wind_speed": 25.0},
    )
    selected = res["selected"]
    assert selected["actuators"]["window"]["position"] == "closed"
    assert selected["actuators"]["ventilation"]["level"] == 3


def test_utility_planner_keeps_current_when_already_comfortable():
    planner = UtilityPlanner()
    cur_act = {"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}, "lights": {"level": 0}}
    res = planner.select_best_plan(
        state={"temperature": 22.4, "humidity": 50.0, "co2": 520.0, "occupancy": 1},
        current_actuators=cur_act,
        weather={"temperature": 21.0, "humidity": 50.0, "light": 25000.0, "noise_level": 45.0},
    )
    assert res["selected"]["name"] == "keep_current"


def test_utility_planner_adapts_around_faulty_actuator():
    """When window actuator is faulty (stuck closed), warm indoor + cool outdoor falls back
    to active cooling or ventilation instead of relying on the broken window.
    """
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 28.0, "humidity": 55.0, "co2": 1100.0, "occupancy": 2},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        weather={"temperature": 18.0, "humidity": 50.0, "light": 30000.0},
        faulty_actuators={"window"},
    )
    selected = res["selected"]
    assert selected["actuators"]["window"]["position"] == "closed"
    assert selected["actuators"]["hvac"]["mode"] == "cool" or selected["actuators"]["ventilation"]["level"] == 3


# ------------------------------------------------------------------ 3. TwoTierPlanner & Safety Shielding Tests

def test_tier1_fire_reaction_and_preemption_over_tier2():
    """REPORT_SE4AS §6 Fire Reaction Test:
    Verify immediate Tier 1 safety shield activation (siren on, gas shut, VMC 0, window closed,
    smoke vent open, elevator recalled, evacuation signs on) and verify that Tier 2 is pre-empted.
    """
    adapter = DummyAdapter()
    mqtt_client = DummyMqttClient()
    planner = TwoTierPlanner(adapter=adapter, mqtt_client=mqtt_client, policies={"min_replan_interval_s": 0.0})

    # Seed apartment sensors so Tier 2 would normally want to open windows or cool
    planner.on_mqtt_message("Complex/monitored/A/A-2-1/temperature", {"value": 28.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/A/A-2-1/humidity", {"value": 50.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/A/A-2-1/co2", {"value": 1200.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/park/park/temperature", {"value": 19.0, "quality": "ok"})

    # Inject fire risk from Analyzer
    planner.on_mqtt_message("Complex/analysis/A/A-2-1/risk/fire", {
        "area": "A", "unit_id": "A-2-1", "risk": "fire", "severity": 100, "details": {"smoke": 25.0, "temperature": 60.0}
    })

    assert planner.is_tier1_active("A", "A-2-1")
    sent = {(area, uid, dev): cmd for area, uid, dev, cmd in adapter.commands}
    assert sent[("A", "A-2-1", "alarm")] == {"siren": "on"}
    assert sent[("A", "A-2-1", "gas_valve")] == {"position": "closed"}
    assert sent[("A", "A-2-1", "ventilation")] == {"level": 0}
    assert sent[("A", "A-2-1", "window")] == {"position": "closed"}
    assert sent[("A", "A-2-1", "hvac")] == {"mode": "off"}
    assert sent[("A", "A-S", "smoke_vent")] == {"position": "open"}
    assert sent[("A", "A-S", "evacuation_siren")] == {"siren": "on"}
    assert sent[("A", "A", "elevator")] == {"mode": "recall"}
    assert sent[("park", "park", "evacuation_signs")] == {"state": "on"}

    # Attempt Tier 2 planning while fire is active -> must return None (pre-empted!)
    adapter.commands.clear()
    assert planner.plan_for_apartment("A", "A-2-1", force=True) is None
    assert adapter.commands == []

    # Clear fire risk -> Tier 1 restores safety devices and unlocks Tier 2
    planner.on_mqtt_message("Complex/analysis/A/A-2-1/risk/fire", {
        "area": "A", "unit_id": "A-2-1", "risk": "fire", "severity": 0, "details": {}
    })
    assert not planner.is_tier1_active("A", "A-2-1")
    tier2_plan = planner.plan_for_apartment("A", "A-2-1", force=True)
    assert tier2_plan is not None
    assert tier2_plan["tier"] == 2


def test_tier1_gas_co_leak_reaction():
    """REPORT_SE4AS §6 Gas/CO Leak Reaction Test:
    Verify instant gas valve closure, window opening, VMC level 3, HVAC off, and siren activation.
    """
    adapter = DummyAdapter()
    planner = TwoTierPlanner(adapter=adapter, policies={"min_replan_interval_s": 0.0})

    planner.on_mqtt_message("Complex/analysis/B/B-1-2/risk/gas_co_leak", {
        "area": "B", "unit_id": "B-1-2", "risk": "gas_co_leak", "severity": 80, "details": {"gas_lel": 15.0, "co_ppm": 0.0}
    })

    assert planner.is_tier1_active("B", "B-1-2")
    sent = {(area, uid, dev): cmd for area, uid, dev, cmd in adapter.commands}
    assert sent[("B", "B-1-2", "gas_valve")] == {"position": "closed"}
    assert sent[("B", "B-1-2", "window")] == {"position": "open"}
    assert sent[("B", "B-1-2", "ventilation")] == {"level": 3}
    assert sent[("B", "B-1-2", "hvac")] == {"mode": "off"}
    assert sent[("B", "B-1-2", "alarm")] == {"siren": "on"}


def test_tier2_automatic_fallback_on_actuator_no_ack():
    """When Tier 2 attempts to open a window for passive cooling and receives no_ack,
    it immediately marks the window faulty and falls back to an alternative effector (HVAC/VMC).
    """
    adapter = DummyAdapter(fail_devices={"A-0-1.window"})
    planner = TwoTierPlanner(adapter=adapter, policies={"min_replan_interval_s": 0.0})

    planner.on_mqtt_message("Complex/monitored/park/park/temperature", {"value": 18.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 28.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/humidity", {"value": 55.0, "quality": "ok"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/co2", {"value": 1000.0, "quality": "ok"})

    plan_res = planner.plan_for_apartment("A", "A-0-1", force=True)
    assert plan_res is not None
    assert "window" in plan_res["faulty_actuators"]
    # Fallback must have activated HVAC cool or VMC boost
    assert "hvac" in plan_res["commands_sent"] or "ventilation" in plan_res["commands_sent"]


# ------------------------------------------------------------------ 4. Full Closed-Loop MAPE-K Integration Test

def test_closed_loop_mapek_pipeline_with_simulator_monitor_analyzer_planner():
    """End-to-end closed-loop verification of Simulator -> Monitor -> Analyzer -> Planner -> Simulator."""
    model = load_model(ROOT / "config" / "complex.json")
    sim = Simulation(model, datetime.fromisoformat("2026-07-15T14:00:00"))
    sim.handle_clock_control({"speed": 60})

    # Wire Monitor -> Analyzer + Planner, Analyzer -> Planner, and Planner -> Simulator
    analyzer = AnalyzerEngine()
    analyzer.update_model(model.to_json())

    class LoopSimAdapter:
        def __init__(self):
            self.executed = []

        def send_command(self, area, unit_id, device, command, timeout=0.5):
            now = time.time()
            ack = sim.handle_command(f"{unit_id}.{device}", {"cmd_id": "loop", "command": command}, now)
            self.executed.append((area, unit_id, device, command, ack))
            return ack

    sim_adapter = LoopSimAdapter()
    planner = TwoTierPlanner(adapter=sim_adapter, policies={"min_replan_interval_s": 0.0})

    class InMemoryPublisher:
        def __init__(self):
            self.monitored_msgs = []
            self.health_msgs = []

        def update_config(self, cfg):
            pass

        def publish_monitored(self, topic, payload):
            self.monitored_msgs.append((topic, payload))
            analyzer.process_monitored(None, topic, payload)
            planner.on_mqtt_message(topic, payload)

        def publish_health(self, topic, payload):
            self.health_msgs.append((topic, payload))
            analyzer.process_health(None, topic, payload)
            planner.on_mqtt_message(topic, payload)

    pub = InMemoryPublisher()
    validator = Validator(pub)
    validator.update_model(model.to_json())
    derived = DerivedCalculator(pub, validator)
    derived.period_s = 0

    class AnalyzerBus:
        def publish(self, topic, payload_str, retain=False):
            planner.on_mqtt_message(topic, json.loads(payload_str))

    analyzer_bus = AnalyzerBus()

    # Step 1: Run normal hot summer afternoon with heatwave -> verify Tier 2 adapts apartments
    sc_heat = sim.handle_scenario_control({"action": "start", "scenario": "heatwave", "target": "complex", "params": {"delta": 12, "days": 2}}, time.time())
    sim.apartments["A-0-1"].temperature = 28.5

    base_ts = time.time()
    for step_idx in range(3):
        ts = base_ts + step_idx * 15.0
        sim.step(10.0)
        for st_msg in sim.actuator_states(ts, only_changed=False):
            uid, _, dtype = st_msg["device_id"].partition(".")
            area = model.units[uid].area
            validator.process_state(f"Complex/state/{area}/{uid}/{dtype}", st_msg)
        for r_msg in sim.sample_readings(ts):
            uid, _, dtype = r_msg["device_id"].partition(".")
            area = model.units[uid].area
            validator.process_raw(f"Complex/raw/{area}/{uid}/{dtype}", r_msg)
        derived.calculate()
        analyzer.run_periodic_analysis(analyzer_bus)

    # Verify online transition model learned from the simulated stream
    assert planner.transition_model.n_updates > 0
    # Verify Tier 2 commanded active cooling and/or shading in A-0-1 inside the simulator
    assert sim.actuators["A-0-1.hvac"].effective["mode"] == "cool"
    assert sim.actuators["A-0-1.window"].effective["position"] == "closed"

    # Step 2: Start a fire scenario in A-2-1 -> verify Tier 1 Safety Shield triggers and closes the loop in Simulator
    sim.handle_scenario_control({"action": "start", "scenario": "fire", "target": "A-2-1", "params": {}}, time.time())
    for step_idx in range(4):
        ts = base_ts + 100.0 + step_idx * 15.0
        sim.step(5.0)
        for r_msg in sim.sample_readings(ts):
            uid, _, dtype = r_msg["device_id"].partition(".")
            area = model.units[uid].area
            validator.process_raw(f"Complex/raw/{area}/{uid}/{dtype}", r_msg)
        analyzer.run_periodic_analysis(analyzer_bus)

    assert planner.is_tier1_active("A", "A-2-1")
    assert sim.actuators["A-2-1.alarm"].effective["siren"] == "on"
    assert sim.actuators["A-2-1.gas_valve"].effective["position"] == "closed"
    assert sim.actuators["A-2-1.ventilation"].effective["level"] == 0
    assert sim.actuators["A-S.smoke_vent"].effective["position"] == "open"
    assert sim.actuators["A.elevator"].effective["mode"] == "recall"
    assert sim.actuators["park.evacuation_signs"].effective["state"] == "on"
    sim.handle_scenario_control({"action": "stop", "scenario_id": sc_heat.scenario_id}, time.time())


def test_freezing_weather_high_co2_never_opens_window():
    """Regression test: when outdoor weather is freezing (0.0°C) and indoor is 22.6°C with high CO2,
    predict_next_state must NOT clamp the open-window temperature to 22.5°C, and UtilityPlanner
    must keep the window closed and boost VMC instead.
    """
    model = SurrogateTransitionModel()
    pred_open = model.predict_next_state(
        {"temperature": 22.6, "humidity": 50.0, "co2": 1400.0, "occupancy": 2},
        {"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 2}, "window": {"position": "open"}, "blinds": {"position": 100}},
        {"temperature": 0.0, "humidity": 60.0, "light": 10000.0},
        horizon_s=1800,
    )
    assert pred_open["temperature"] < 12.0

    planner = UtilityPlanner(transition_model=model)
    res = planner.select_best_plan(
        state={"temperature": 22.6, "humidity": 50.0, "co2": 1400.0, "occupancy": 2},
        current_actuators={"hvac": {"mode": "off", "setpoint": 22}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}},
        weather={"temperature": 0.0, "humidity": 60.0, "light": 10000.0, "rain_level": 0.0, "wind_speed": 5.0},
    )
    assert res["selected"]["actuators"]["window"]["position"] == "closed"
    assert res["selected"]["actuators"]["ventilation"]["level"] == 3


def test_online_learning_synchronization_and_noise_resilience():
    """Regression test: online learning must wait until all three sensors (temperature, humidity, co2)
    have arrived for the current cycle and use inverse-variance weighting so 10s noisy differences
    do not corrupt physical parameters.
    """
    import random
    planner = TwoTierPlanner(policies={"min_replan_interval_s": 0.0})
    planner.on_mqtt_message("Complex/monitored/park/park/temperature", {"value": 18.0, "timestamp": 1000.0})

    # Cycle 1 at t=1000: co2 arrives first, then humidity, then temperature
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/co2", {"value": 600.0, "timestamp": 1000.0})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/humidity", {"value": 50.0, "timestamp": 1000.0})
    assert "A-0-1" not in planner.prev_snapshots  # Must wait for temperature!
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 24.0, "timestamp": 1000.0})
    assert "A-0-1" in planner.prev_snapshots

    # Cycle 2 at t=1015: co2 arrives first -> must NOT trigger update before temperature arrives
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/co2", {"value": 590.0, "timestamp": 1015.0})
    assert planner.transition_model.n_updates == 0
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/humidity", {"value": 49.8, "timestamp": 1015.0})
    assert planner.transition_model.n_updates == 0
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 23.9, "timestamp": 1015.0})
    assert planner.transition_model.n_updates == 1

    # Verify 60 noisy 10s steps at clock_speed=1 do not blow up theta_T or theta_C
    rng = random.Random(42)
    m = SurrogateTransitionModel(ridge_lambda=5.0)
    true_T, true_C, true_H = 22.0, 600.0, 50.0
    act = {"hvac": {"mode": "cool", "setpoint": 20}, "ventilation": {"level": 1}, "window": {"position": "closed"}, "blinds": {"position": 100}}
    w = {"temperature": 30.0, "humidity": 50.0, "light": 50000.0}
    prev_s = {"temperature": true_T, "humidity": true_H, "co2": true_C, "occupancy": 2}
    for _ in range(60):
        true_T -= 2.0 * (10.0 / 3600.0)
        curr_s = {"temperature": true_T + rng.gauss(0, 0.1), "humidity": true_H + rng.gauss(0, 0.5), "co2": true_C + rng.gauss(0, 10), "occupancy": 2}
        m.observe_transition(prev_s, act, w, curr_s, 10.0)
        prev_s = curr_s
    assert abs(m.theta_T[0] - 0.167) < 0.05
    assert abs(m.theta_C[0] - 92.6) < 10.0


def test_tier1_earthquake_and_cascade_multi_hazard_recovery():
    """Regression test:
    1. Earthquake clearance restores building elevators, stair sirens, evacuation signs, and apartment gas valves.
    2. Multi-hazard cascade in same unit (gas_co_leak + fire): when fire clears while gas_co_leak remains active,
       Tier 1 immediately re-applies gas_co_leak mitigation (opening window and setting VMC to level 3).
    """
    adapter = DummyAdapter()
    planner = TwoTierPlanner(adapter=adapter, policies={"min_replan_interval_s": 0.0})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 22.0})

    # 1. Earthquake start & clearance
    planner.handle_risk_event("park", "park", "earthquake", 85, {"seismic_mw": 5.8})
    assert planner.is_tier1_active("A", "A-0-1")
    adapter.commands.clear()
    clr = planner.handle_risk_event("park", "park", "earthquake", 0, {})
    assert not planner.is_tier1_active("A", "A-0-1")
    sent = {(area, uid, dev): cmd for area, uid, dev, cmd in adapter.commands}
    assert sent[("park", "park", "evacuation_signs")] == {"state": "off"}
    assert sent[("A", "A", "elevator")] == {"mode": "normal"}
    assert sent[("A", "A-S", "evacuation_siren")] == {"siren": "off"}
    assert sent[("A", "A-0-1", "gas_valve")] == {"position": "open"}
    assert len(clr["commands_sent"]) > 0

    # 2. Cascade: gas_co_leak + fire in A-1-1, then fire clears while gas_co_leak remains active
    adapter.commands.clear()
    planner.handle_risk_event("A", "A-1-1", "gas_co_leak", 80, {"gas_lel": 15.0})
    planner.handle_risk_event("A", "A-1-1", "fire", 100, {"smoke": 25.0})
    assert planner.unit_actuators["A"]["A-1-1"]["window"]["position"] == "closed"
    assert planner.unit_actuators["A"]["A-1-1"]["ventilation"]["level"] == 0

    adapter.commands.clear()
    planner.handle_risk_event("A", "A-1-1", "fire", 0, {})
    sent_after_fire = {(area, uid, dev): cmd for area, uid, dev, cmd in adapter.commands}
    # Window and VMC must now open/boost for the still-active gas leak!
    assert sent_after_fire[("A", "A-1-1", "window")] == {"position": "open"}
    assert sent_after_fire[("A", "A-1-1", "ventilation")] == {"level": 3}
    assert sent_after_fire[("A", "A-1-1", "gas_valve")] == {"position": "closed"}
    assert sent_after_fire[("park", "park", "evacuation_signs")] == {"state": "off"}


def test_tier2_silent_no_effect_fault_detection_and_fallback():
    """Regression test: when an actuator (window or ventilation) has a silent `no_effect` fault
    (returns ack status=ok, but physical state/power stays stuck), TwoTierPlanner detects the
    silent fault and falls back to working effectors.
    """
    adapter = DummyAdapter()
    planner = TwoTierPlanner(adapter=adapter, policies={"min_replan_interval_s": 0.0})
    planner.on_mqtt_message("Complex/monitored/park/park/temperature", {"value": 17.5, "timestamp": 1000.0})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/power", {"value": 200.0, "timestamp": 1000.0})

    # Step 1: Warm apartment (28.0C) -> planner commands passive cooling (window=open)
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/co2", {"value": 950.0, "timestamp": 1000.0, "sim_time": "2026-07-15T14:00:00"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/humidity", {"value": 52.0, "timestamp": 1000.0, "sim_time": "2026-07-15T14:00:00"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 28.0, "timestamp": 1000.0, "sim_time": "2026-07-15T14:00:00"})
    plan1 = planner.plan_for_apartment("A", "A-0-1", force=True)
    assert plan1 is not None
    assert plan1["selected_plan"] in ("passive_cooling", "natural_air_flush")

    # Step 2: 5 simulated minutes later, temperature did NOT drop as open window would predict (stuck closed!)
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/co2", {"value": 980.0, "timestamp": 1010.0, "sim_time": "2026-07-15T14:05:00"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/humidity", {"value": 52.5, "timestamp": 1010.0, "sim_time": "2026-07-15T14:05:00"})
    planner.on_mqtt_message("Complex/monitored/A/A-0-1/temperature", {"value": 27.95, "timestamp": 1010.0, "sim_time": "2026-07-15T14:05:00"})

    plan2 = planner.plan_for_apartment("A", "A-0-1", force=True)
    assert plan2 is not None
    assert "window" in plan2["faulty_actuators"]
    assert plan2["commands_sent"].get("hvac", {}).get("mode") == "cool"


def test_monitor_sensor_drift_detection_and_microgrid_ev_peak_shaving():
    """Regression test:
    1. Validator detects sensor drift against building neighbor median and marks quality='suspect'.
    2. DerivedCalculator includes EV charger power_w and TwoTierPlanner throttles/pauses EV charging during peak deficit.
    """
    class CapturingPub:
        def __init__(self):
            self.monitored = []
            self.health = []

        def update_config(self, cfg):
            pass

        def publish_monitored(self, topic, payload):
            self.monitored.append((topic, payload))

        def publish_health(self, topic, payload):
            self.health.append((topic, payload))

    pub = CapturingPub()
    val = Validator(pub)
    val.update_model({
        "device_types": {"temperature": {"kind": "sensor", "valid_range": [-40, 150], "drift_check": True}},
        "units": [
            {"id": "A", "kind": "building", "area": "A"},
            {"id": "A-0-1", "kind": "apartment", "area": "A", "sensors": ["temperature"]},
            {"id": "A-0-2", "kind": "apartment", "area": "A", "sensors": ["temperature"]},
            {"id": "A-1-1", "kind": "apartment", "area": "A", "sensors": ["temperature"]},
        ],
        "monitor": {"drift_window_min": 20, "drift_delta": {"temperature": 2.0}, "drift_slope": {"temperature": 0.1}},
    })

    t0 = 10000.0
    for step in range(4):
        ts = t0 + step * 30.0
        val.process_raw("Complex/raw/A/A-0-2/temperature", {"value": 21.0, "timestamp": ts})
        val.process_raw("Complex/raw/A/A-1-1/temperature", {"value": 21.2, "timestamp": ts})
        # A-0-1 drifts rapidly upward (+1.0 C every 30s = +2.0 C/min)
        val.process_raw("Complex/raw/A/A-0-1/temperature", {"value": 21.0 + step * 1.0, "timestamp": ts})

    assert any(h[1]["status"] == "drift" for h in pub.health)
    assert pub.monitored[-1][1]["quality"] == "suspect"

    # Verify EV charger power aggregation in DerivedCalculator and peak shaving in TwoTierPlanner
    val.process_raw("Complex/raw/A/A/pv_power", {"value": 1000.0, "timestamp": t0})
    val.process_raw("Complex/raw/A/A-0-1/power", {"value": 1500.0, "timestamp": t0})
    val.process_state("Complex/state/A/EV-A/ev_charger", {"state": {"mode": "charge", "max_power_w": 7400}, "power_w": 7400.0, "timestamp": t0})
    dc = DerivedCalculator(pub, val)
    dc.period_s = 0
    dc.calculate()
    eb_msgs = [p for t, p in pub.monitored if t == "Complex/monitored/A/A/energy_balance"]
    assert eb_msgs and eb_msgs[-1]["value"] == 1000.0 - (1500.0 + 7400.0)

    adapter = DummyAdapter()
    planner = TwoTierPlanner(adapter=adapter, policies={"min_replan_interval_s": 0.0})
    planner.on_mqtt_message("Complex/monitored/A/A/energy_balance", eb_msgs[-1])
    planner.plan_park_and_microgrid()
    sent = {(area, uid, dev): cmd for area, uid, dev, cmd in adapter.commands}
    assert sent[("A", "A", "battery")] == {"mode": "discharge"}
    assert sent[("A", "EV-A", "ev_charger")]["mode"] == "pause"


if __name__ == "__main__":
    test_funcs = [v for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in test_funcs:
        print(f"Running {fn.__name__} ...", flush=True)
        fn()
        print(f"PASS  {fn.__name__}", flush=True)
    print(f"\nAll {len(test_funcs)}/{len(test_funcs)} tests in test_planner_mapek.py PASSED!")


