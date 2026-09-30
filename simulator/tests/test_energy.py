import pytest

from conftest import P, inputs
from energy import BuildingState, actuator_power, apartment_flows, charger_power, pv_power, step_battery
from occupancy import Car


@pytest.fixture
def types(model):
    return model.actuator_types


def test_actuator_power_models(types):
    assert actuator_power(types["hvac"], {"mode": "cool", "setpoint": 24}) == 1500
    assert actuator_power(types["hvac"], {"mode": "heat", "setpoint": 21}) == 100
    assert actuator_power(types["ventilation"], {"level": 2}) == 60
    assert actuator_power(types["lights"], {"level": 50}) == 50
    assert actuator_power(types["resident_display"], {"message": "", "level": "info"}) == 5
    assert actuator_power(types["stair_lights"], {"mode": "evacuation"}) == 80
    assert actuator_power(types["battery"], {"mode": "charge"}) == 0


def test_flows_dinner_with_showers(types):
    f = apartment_flows(inputs(people=2, awake=2, cooking=True, showering=1, ventilation=1), types, False, False, False, P)
    assert f.power_w == pytest.approx(150 + 2000 + 30 + 5)
    assert f.water_l_min == pytest.approx(15)
    assert f.gas_m3_h == pytest.approx(0.3 + 0.8)


def test_gas_flow_zero_with_valve_closed(types):
    f = apartment_flows(inputs(cooking=True, gas_valve="closed"), types, True, False, False, P)
    assert f.gas_m3_h == 0


def test_blackout_only_essential(types):
    f = apartment_flows(inputs(powered=False, cooking=True, ventilation=2, alarm="on"), types, False, False, False, P)
    assert f.power_w == pytest.approx(10 + 5)


def test_pv_power():
    assert pv_power(20000, 1.0, 0.0, P) == 20000
    assert pv_power(20000, 1.0, 0.9, P) == pytest.approx(7400)


def test_battery_charge_and_clamp():
    b = BuildingState(battery_soc_pct=50)
    step_battery(b, "charge", 40, 10000, 0, 3600); assert b.battery_soc_pct == pytest.approx(75)
    step_battery(b, "charge", 40, 10000, 0, 3 * 3600); assert b.battery_soc_pct == 100 and b.battery_power_w == 0


def test_battery_blackout_serves_essentials_until_empty():
    b = BuildingState(battery_soc_pct=5, grid_ok=False)
    assert step_battery(b, "idle", 40, 10000, 2000, 3600) is True
    assert b.battery_soc_pct == pytest.approx(0)
    assert step_battery(b, "idle", 40, 10000, 2000, 60) is False


def test_charger_power():
    car = Car(connected=True, energy_needed_kwh=5)
    assert charger_power("charge", 7400, car, True) == 7400
    assert charger_power("pause", 7400, car, True) == 0
    assert charger_power("charge", 7400, Car(False, 5), True) == 0
    assert charger_power("charge", 7400, car, False) == 0
