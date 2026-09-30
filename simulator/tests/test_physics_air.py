import math

import pytest

from conftest import P, inputs
from physics import ApartmentState, heating_active, relax, step_apartment_air


def test_relax_exact():
    assert relax(10, 0, 3600, 3600) == pytest.approx(10 * math.exp(-1))


def test_window_open_lowers_co2_faster():
    closed, opened = ApartmentState(co2=1500), ApartmentState(co2=1500)
    for _ in range(10):
        step_apartment_air(closed, inputs(ventilation=0), 60, P)
        step_apartment_air(opened, inputs(ventilation=0, window="open"), 60, P)
    assert opened.co2 < closed.co2 - 200


def test_co2_steady_state_three_people():
    s = ApartmentState()
    for _ in range(48 * 60):
        step_apartment_air(s, inputs(people=3, awake=3, ventilation=0), 60, P)
    assert s.co2 == pytest.approx(1346, abs=5)


def test_cooling_holds_setpoint():
    s = ApartmentState(temperature=28)
    for _ in range(6 * 60):
        step_apartment_air(s, inputs(outdoor_t=30, hvac={"mode": "cool", "setpoint": 24}), 60, P)
    assert 23.4 <= s.temperature <= 24.6


def test_heating_needs_gas_valve_open():
    on, off = ApartmentState(temperature=15), ApartmentState(temperature=15)
    for _ in range(120):
        step_apartment_air(on, inputs(outdoor_t=0, hvac={"mode": "heat", "setpoint": 22}), 60, P)
        step_apartment_air(off, inputs(outdoor_t=0, hvac={"mode": "heat", "setpoint": 22}, gas_valve="closed"), 60, P)
    assert on.temperature > off.temperature + 2


def test_no_heating_without_power():
    s = ApartmentState(temperature=15)
    assert not heating_active(s, inputs(hvac={"mode": "heat", "setpoint": 22}, powered=False), P)


def test_insulation_matters():
    low, high = ApartmentState(), ApartmentState()
    for _ in range(180):
        step_apartment_air(low, inputs(outdoor_t=0, insulation="bassa"), 60, P)
        step_apartment_air(high, inputs(outdoor_t=0, insulation="alta"), 60, P)
    assert low.temperature < high.temperature - 2


def test_south_gets_more_sun_than_north():
    s, n = ApartmentState(), ApartmentState()
    for _ in range(60):
        step_apartment_air(s, inputs(sun=1.0, orientation="S"), 60, P)
        step_apartment_air(n, inputs(sun=1.0, orientation="N"), 60, P)
    assert s.temperature > n.temperature


def test_light_and_noise():
    s = ApartmentState()
    step_apartment_air(s, inputs(outdoor_lux=100000, blinds=100, lights=50), 60, P)
    assert s.light == pytest.approx(2000 + 250)
    step_apartment_air(s, inputs(siren_on=True), 60, P)
    assert s.noise >= 85


def test_stable_with_large_dt():
    s = ApartmentState(co2=5000, temperature=40)
    for _ in range(1000):
        step_apartment_air(s, inputs(people=4, awake=4, window="open"), 60, P)
    assert math.isfinite(s.temperature) and s.co2 >= 420 - 1e-6


@pytest.mark.parametrize("outdoor_t", [-2.5, -12.5])     # January night, January night with cold_wave
def test_heating_reaches_setpoint_in_winter(outdoor_t):
    s = ApartmentState(temperature=18)
    for _ in range(4 * 60):
        step_apartment_air(s, inputs(outdoor_t=outdoor_t, hvac={"mode": "heat", "setpoint": 21}), 60, P)
    assert 20.4 <= s.temperature <= 21


def test_indoor_humidity_follows_outdoor_vapour_not_relative_humidity():
    s = ApartmentState(temperature=21, humidity=50)
    for _ in range(24 * 60):
        step_apartment_air(s, inputs(outdoor_t=5, outdoor_rh=85, people=2, awake=2,
                                     hvac={"mode": "heat", "setpoint": 21}), 60, P)
    assert 25 < s.humidity < 60
