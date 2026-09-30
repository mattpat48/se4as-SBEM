import random
import re
from datetime import datetime, timedelta

import pytest

from scenarios import ScenarioError, ScenarioManager

T0 = datetime(2026, 9, 30, 21, 0)


@pytest.fixture
def mgr(model):
    return ScenarioManager(model, random.Random(0))


def test_ids_increment(mgr):
    assert mgr.start("storm", "complex", None, 0, T0).scenario_id == "sc-0001"
    assert mgr.start("pollution", "complex", None, 0, T0).scenario_id == "sc-0002"


@pytest.mark.parametrize("scenario, target, params, msg", [
    ("xyz", "complex", None, "scenario sconosciuto: xyz"),
    ("fire", "park", None, "target non valido per fire: park"),
    ("sensor_fault", "A-2-1.co2", {"mode": "melted"}, "parametro non valido: mode"),
    ("actuator_fault", "A-2-1.co2", {"mode": "no_ack"}, "target non valido per actuator_fault: A-2-1.co2"),
])
def test_invalid_start(mgr, scenario, target, params, msg):
    with pytest.raises(ScenarioError, match=re.escape(msg)):
        mgr.start(scenario, target, params, 0, T0)


def test_duplicate_scenario_rejected(mgr):
    mgr.start("fire", "A-2-1", None, 0, T0)
    with pytest.raises(ScenarioError, match="già attivo"):
        mgr.start("fire", "A-2-1", None, 0, T0)


def test_stop_unknown_raises(mgr):
    with pytest.raises(ScenarioError, match="sc-9999"):
        mgr.stop("sc-9999")


def test_earthquake_duration(mgr):
    mgr.start("earthquake", "complex", None, 0, T0)
    assert mgr.effects(T0 + timedelta(seconds=10)).env.earthquake_magnitude == 5.8
    assert mgr.effects(T0 + timedelta(seconds=31)).env.earthquake_magnitude is None


def test_heatwave_expires_after_days(mgr):
    mgr.start("heatwave", "complex", {"days": 1}, 0, T0)
    assert mgr.effects(T0 + timedelta(hours=23)).env.temp_delta == 10
    assert mgr.effects(T0 + timedelta(hours=25)).env.temp_delta == 0


def test_combined_scenarios(mgr):
    mgr.start("heatwave", "complex", None, 0, T0); mgr.start("storm", "complex", None, 0, T0)
    e = mgr.effects(T0)
    assert e.env.temp_delta == 10 and e.env.storm


def test_forced_priority(mgr):
    mgr.start("solar_surplus", "complex", None, 0, T0); mgr.start("power_peak", "complex", None, 0, T0)
    e = mgr.effects(T0); assert e.forced == "all_home" and e.appliances_max and e.env.clear_sky


def test_blackout_targets(mgr):
    mgr.start("blackout", "complex", None, 0, T0); assert mgr.effects(T0).blackout == {"A", "B", "C", "D"}


def test_cascade_timeline(mgr):
    sc = mgr.start("cascade", "complex", None, 0, T0)
    targets = sc.params["targets"]
    assert len(targets) == 2 and targets[0][0] != targets[1][0]
    assert mgr.effects(T0 + timedelta(minutes=1)).gas_leaks == {}
    assert set(mgr.effects(T0 + timedelta(minutes=6)).gas_leaks) == set(targets)
    assert mgr.effects(T0 + timedelta(minutes=11)).burning == {targets[0]}


def test_to_message(mgr):
    sc = mgr.start("fire", "A-2-1", None, 1790440000.0, T0)
    assert mgr.to_message() == {"active": [{"scenario_id": sc.scenario_id, "scenario": "fire", "target": "A-2-1",
        "params": {}, "started_at": 1790440000.0, "sim_started_at": "2026-09-30T21:00:00"}]}
    mgr.stop(sc.scenario_id); assert mgr.to_message() == {"active": []}
