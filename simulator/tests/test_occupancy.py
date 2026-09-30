import copy
import random
from datetime import date, datetime, time, timedelta

import pytest

from conftest import load_raw
from model import build_model
from occupancy import EVFleet, Occupancy, in_window

WED, SAT = date(2026, 9, 30), date(2026, 10, 3)


def one_apartment_model(profile, residents):
    raw = load_raw()
    b = copy.deepcopy(raw["buildings"][0])
    b.update({"id": "X", "floors": 1, "apartments_per_floor": 1, "orientation": {"1": "S"},
              "overrides": {"X-0-1": {"profile": profile, "residents": residents}}})
    raw["buildings"] = [b]
    raw["parking"]["chargers"] = [{"id": "EV-A", "building": "X", "max_power_w": 7400}]
    return build_model(raw)


@pytest.fixture
def occ():
    def make(profile, residents, **params):
        model = one_apartment_model(profile, residents)
        p = copy.deepcopy(model.physics)
        p["occupancy"].update({"jitter_min": 0, **params})
        return Occupancy(model, p, random.Random(0))
    return make


@pytest.fixture
def ev():
    model = one_apartment_model("famiglia", 4)
    return EVFleet(["EV-A"], model.physics["ev"], random.Random(0))


_clock: dict[int, datetime] = {}


def _advance(obj, target, step):
    t = _clock.get(id(obj), datetime.combine(target.date(), time(0)))
    while t < target:
        dt = min(60.0, (target - t).total_seconds())
        t += timedelta(seconds=dt)
        step(t, dt)
    _clock[id(obj)] = t


def step_until(o, target, evacuate=frozenset(), forced=None):
    _advance(o, target, lambda t, dt: o.step(t, dt, set(evacuate), forced))


def step_ev(ev, target):
    _advance(ev, target, lambda t, dt: ev.step(t, dt, {}))


@pytest.mark.parametrize("h, expected", [(10, 0), (15, 2), (21, 4)])
def test_family_weekday(occ, h, expected):
    o = occ("famiglia", 4); step_until(o, datetime.combine(WED, time(h)))
    assert o.home["X-0-1"] == expected


def test_family_weekend_all_home(occ):
    o = occ("famiglia", 4, weekend_home_prob=1.0); step_until(o, datetime.combine(SAT, time(10)))
    assert o.home["X-0-1"] == 4


def test_elderly_walk(occ):
    o = occ("anziano", 1)
    step_until(o, datetime.combine(WED, time(10, 30))); assert o.home["X-0-1"] == 0
    step_until(o, datetime.combine(WED, time(12))); assert o.home["X-0-1"] == 1


def test_awake_window_crosses_midnight(occ):
    o = occ("studenti", 2)
    assert o.awake("X-0-1", datetime(2026, 10, 1, 0, 30)) == 2
    assert o.awake("X-0-1", datetime(2026, 10, 1, 3, 0)) == 0


def test_in_window():
    assert in_window(0.5, "23:00", "01:00") and not in_window(2, "23:00", "01:00")
    assert in_window(23.5, "06:30", "24:00")


def test_transit_lasts_sixty_seconds(occ):
    o = occ("lavoratori", 2); step_until(o, datetime.combine(WED, time(8, 0, 30)))
    assert o.transit["X-S"] > 0
    step_until(o, datetime.combine(WED, time(8, 2)))
    assert o.transit["X-S"] == 0


def test_evacuation_and_return(occ):
    o = occ("anziano", 2); t = datetime.combine(WED, time(21))
    step_until(o, t)
    step_until(o, t + timedelta(minutes=6), evacuate={"X-0-1"})
    assert o.home["X-0-1"] == 0 and o.in_park == 2
    step_until(o, t + timedelta(minutes=10))
    assert o.home["X-0-1"] == 2 and o.in_park == 0


def test_forced_modes(occ):
    o = occ("lavoratori", 2); t = datetime.combine(WED, time(11))
    o.step(t, 60, set(), "all_home"); assert o.home["X-0-1"] == 2
    o.step(t, 60, set(), "all_away"); assert o.home["X-0-1"] == 0


def test_cooking_at_dinner(occ):
    o = occ("anziano", 1); step_until(o, datetime.combine(WED, time(20)))
    assert o.activity("X-0-1", datetime.combine(WED, time(20))).cooking


def test_ev_cycle(ev):
    step_ev(ev, datetime.combine(WED, time(21)))
    car = ev.cars["EV-A"]; assert car.connected and 10 <= car.energy_needed_kwh <= 30
    before = car.energy_needed_kwh
    ev.step(datetime.combine(WED, time(22)), 3600, {"EV-A": 7400})
    assert car.energy_needed_kwh == pytest.approx(max(0, before - 7.4))
    step_ev(ev, datetime(2026, 10, 1, 10, 0)); assert not ev.cars["EV-A"].connected
