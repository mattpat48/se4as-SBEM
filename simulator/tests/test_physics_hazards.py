import copy
import math
import random

import pytest

from conftest import P, inputs, outdoor
from physics import (ApartmentState, StairwellState, ignite, spread_fire, step_apartment_hazards,
                     step_stairwell)

OUTDOOR = outdoor()


def with_fire(p, **kw):
    q = copy.deepcopy(p)
    q["fire"].update(kw)
    return q


def run_fire(ventilation, minutes=10):
    s = ApartmentState(); ignite(s, P)
    for _ in range(minutes):
        step_apartment_hazards(s, inputs(ventilation=ventilation), 60, P)
    return s


def test_fire_logistic_growth():
    assert run_fire(0).fire == pytest.approx(1 / (1 + 19 * math.exp(-2)), abs=0.03)   # ≈ 0.28


def test_ventilation_feeds_fire():
    assert run_fire(2).fire > run_fire(0).fire + 0.1


def test_fire_produces_smoke_heat_co():
    s = run_fire(2, minutes=20)
    assert s.smoke > 20 and s.co > 0 and s.temperature > 25


def test_extinguishing_decays():
    s = run_fire(2, minutes=20); s.extinguishing = True; before = s.fire
    for _ in range(30):
        step_apartment_hazards(s, inputs(ventilation=0), 60, P)
    assert s.fire == pytest.approx(before * math.exp(-3), rel=0.05)


def test_spread_only_above_threshold():
    rng = random.Random(1); p = with_fire(P, spread_prob_per_min=1.0)
    states = {"A-1-1": ApartmentState(fire=0.5), "A-1-2": ApartmentState()}
    assert spread_fire(states, {"A-1-1": ["A-1-2"], "A-1-2": ["A-1-1"]}, 60, rng, p) == []
    states["A-1-1"].fire = 0.8
    assert spread_fire(states, {"A-1-1": ["A-1-2"], "A-1-2": ["A-1-1"]}, 60, rng, p) == ["A-1-2"]


def test_stairwell_smoke_and_vent():
    burning = ApartmentState(smoke=80)
    closed, opened = StairwellState(), StairwellState()
    for _ in range(10):
        step_stairwell(closed, [burning], False, "off", OUTDOOR, 60, P)
        step_stairwell(opened, [burning], True, "off", OUTDOOR, 60, P)
    assert 0 < opened.smoke < closed.smoke <= 0.3 * 80 + 1e-6


def test_gas_leak_stops_when_valve_closed():
    leak, closed = ApartmentState(), ApartmentState()
    for _ in range(10):
        step_apartment_hazards(leak, inputs(ventilation=0, gas_leak_rate=2), 60, P)
        step_apartment_hazards(closed, inputs(ventilation=0, gas_leak_rate=2, gas_valve="closed"), 60, P)
    assert leak.gas > 15 and closed.gas == 0


def test_co_needs_boiler_running():
    s = ApartmentState(temperature=15)
    step_apartment_hazards(s, inputs(outdoor_t=0, hvac={"mode": "heat", "setpoint": 22}, co_rate=30), 3600, P)
    assert s.co > 20
    t = ApartmentState(temperature=15)
    step_apartment_hazards(t, inputs(outdoor_t=0, hvac={"mode": "off", "setpoint": 22}, co_rate=30), 3600, P)
    assert t.co == 0


def test_extinguished_fire_cools_the_apartment():
    s = run_fire(2, minutes=60)
    assert s.temperature > 150
    s.extinguishing = True
    for _ in range(60):
        step_apartment_hazards(s, inputs(ventilation=0), 60, P)
    assert s.temperature < 40
