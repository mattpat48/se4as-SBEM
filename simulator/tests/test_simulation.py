import math
from datetime import datetime

import pytest

from simulation import Simulation

START = datetime(2026, 9, 30, 21, 15)


@pytest.fixture
def sim(model):
    return Simulation(model, START)


def run(sim, real_seconds):
    for _ in range(int(real_seconds)):
        sim.step(1.0)


def test_readings_shape_and_count(sim):
    r = sim.sample_readings(100.0)
    assert len(r) == 414
    assert set(r[0]) == {"device_id", "value", "unit", "timestamp", "sim_time"}


def test_actuator_states_full_then_changed(sim):
    assert len(sim.actuator_states(0, only_changed=False)) == 283
    assert sim.actuator_states(0, only_changed=True) == []
    sim.handle_command("A-2-1.window", {"cmd_id": "c", "command": {"position": "open"}}, 1)
    assert [s["device_id"] for s in sim.actuator_states(1, only_changed=True)] == ["A-2-1.window"]


def test_closed_loop_window_lowers_co2(model):
    a, b = (Simulation(model, START) for _ in range(2))
    for s in (a, b):
        s.apartments["A-2-1"].co2 = 1500
    a.handle_command("A-2-1.window", {"cmd_id": "c", "command": {"position": "open"}}, 0)
    run(a, 600); run(b, 600)
    assert a.true_value("A-2-1.co2") < b.true_value("A-2-1.co2") - 200


def test_heating_reaches_setpoint(sim):
    sim.handle_clock_control({"speed": 60})
    sim.handle_command("A-2-1.hvac", {"cmd_id": "c", "command": {"mode": "heat", "setpoint": 22}}, 0)
    run(sim, 360)                                           # 6 simulated hours of a September night
    assert sim.true_value("A-2-1.temperature") >= 21


def test_unknown_device_rejected(sim):
    ack = sim.handle_command("Z-9-9.hvac", {"cmd_id": "c", "command": {"mode": "cool"}}, 0)
    assert ack["status"] == "rejected" and ack["reason"] == "dispositivo sconosciuto"


@pytest.mark.parametrize("payload", [b"\xff", "text", [1], {"cmd_id": "c"}, None])
def test_invalid_payload_rejected(sim, payload):
    assert sim.handle_command("A-2-1.hvac", payload, 0)["status"] == "rejected"


def test_actuator_fault_no_ack(sim):
    sim.handle_scenario_control({"action": "start", "scenario": "actuator_fault",
                                 "target": "A-2-1.lights", "params": {"mode": "no_ack"}}, 0)
    assert sim.handle_command("A-2-1.lights", {"cmd_id": "c", "command": {"level": 80}}, 1) is None


def test_sensor_fault_offline_and_stop(sim):
    sc = sim.handle_scenario_control({"action": "start", "scenario": "sensor_fault",
                                      "target": "A-2-1.co2", "params": {"mode": "offline"}}, 0)
    assert "A-2-1.co2" not in {r["device_id"] for r in sim.sample_readings(1)}
    sim.handle_scenario_control({"action": "stop", "scenario_id": sc.scenario_id}, 2)
    assert "A-2-1.co2" in {r["device_id"] for r in sim.sample_readings(3)}


def test_fire_smoke_spreads_to_stairwell_and_alarm_evacuates(sim):
    sim.handle_clock_control({"speed": 60})
    sim.handle_scenario_control({"action": "start", "scenario": "fire", "target": "A-2-1"}, 0)
    run(sim, 15)
    assert sim.true_value("A-2-1.smoke") > 10 and sim.true_value("A-S.smoke") > 0
    sim.handle_command("A-2-1.alarm", {"cmd_id": "c", "command": {"siren": "on"}}, 15)
    run(sim, 6)
    assert sim.true_value("A-2-1.occupancy") == 0


def test_blackout_leaves_only_essentials(sim):
    sim.handle_scenario_control({"action": "start", "scenario": "blackout", "target": "A"}, 0)
    run(sim, 2)
    assert sim.true_value("A-2-1.power") == pytest.approx(5)      # resident_display only
    assert sim.true_value("B-2-1.power") > 100


def test_clock_control_errors(sim):
    with pytest.raises(ValueError): sim.handle_clock_control({"speed": 0})
    with pytest.raises(ValueError): sim.handle_clock_control({"warp": 9})


def test_determinism(model):
    a, b = Simulation(model, START, seed=7), Simulation(model, START, seed=7)
    run(a, 100); run(b, 100)
    assert [r["value"] for r in a.sample_readings(0)] == [r["value"] for r in b.sample_readings(0)]


def test_long_run_readings_finite_and_in_range(model):
    s = Simulation(model, START); s.handle_clock_control({"speed": 60})
    plan = {0: ("heatwave", "complex"), 600: ("storm", "complex"), 1200: ("pollution", "complex"),
            1800: ("blackout", "A"), 2400: ("cold_wave", "complex")}
    for i in range(2880):                                   # 2 simulated days
        if i in plan:
            s.handle_scenario_control({"action": "start", "scenario": plan[i][0], "target": plan[i][1]}, i)
        s.step(1.0)
        if i % 10 == 0:
            for r in s.sample_readings(i):
                lo, hi = model.sensor_types[r["device_id"].split(".")[1]].valid_range
                assert math.isfinite(r["value"]) and lo <= r["value"] <= hi, r
