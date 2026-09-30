"""Electric, water and gas consumptions; photovoltaics, building battery, EV chargers."""
from dataclasses import dataclass

from model import ActuatorType
from occupancy import Car
from physics import ApartmentInputs


def actuator_power(atype: ActuatorType, state: dict) -> float:
    model = atype.power_w
    if "const" in model:
        return float(model["const"])
    if "map" in model:
        return float(model["map"].get(str(state.get(model["by"])), 0))
    if "per_unit" in model:
        return float(state.get(model["by"], 0)) * model["per_unit"]
    return 0.0          # "dynamic": computed by the simulation (battery, ev_charger)


@dataclass
class Flows:
    power_w: float
    water_l_min: float
    gas_m3_h: float


def apartment_flows(inp: ApartmentInputs, actuator_types: dict[str, ActuatorType], heating: bool,
                    cooling: bool, appliances_max: bool, p: dict) -> Flows:
    a = p["apartment"]
    cooking = inp.cooking or appliances_max
    power = 0.0
    for t, state in inp.actuators.items():
        atype = actuator_types[t]
        if not inp.powered and not atype.essential:
            continue
        if t == "hvac" and not (heating or cooling):
            state = {**state, "mode": "off"}
        power += actuator_power(atype, state)
    if inp.powered:
        power += a["power"]["base_w"] + (a["power"]["cooking_w"] if cooking else 0)

    water = a["water"]["shower_l_min"] * inp.showering + (a["water"]["kitchen_l_min"] if inp.cooking else 0)

    gas = 0.0
    if inp.actuators["gas_valve"]["position"] == "open":
        g = a["gas"]
        gas = (g["cooking_m3_h"] if inp.cooking else 0) + (g["heating_m3_h"] if heating else 0) \
            + (g["hot_water_m3_h"] if inp.showering > 0 else 0)
    return Flows(power, water, gas)


def pv_power(peak_w: float, sun: float, cloudiness: float, p: dict) -> float:
    return peak_w * sun * (1 - p["energy"]["pv_cloud_factor"] * cloudiness)


@dataclass
class BuildingState:
    battery_soc_pct: float = 50.0
    battery_power_w: float = 0.0     # positive while charging, negative while discharging
    pv_power_w: float = 0.0
    grid_ok: bool = True


def step_battery(b: BuildingState, mode: str, capacity_kwh: float, max_w: float,
                 essential_load_w: float, dt: float) -> bool:
    """Advance the battery; returns False when the grid is down and the battery is empty."""
    had_charge = b.battery_soc_pct > 0
    if b.grid_ok:
        power = {"charge": max_w, "discharge": -max_w}.get(mode, 0.0)
    else:
        # Blackout: the battery feeds the essential loads whatever the command says.
        power = -min(max_w, max(essential_load_w, max_w if mode == "discharge" else 0.0))
    soc = b.battery_soc_pct + power * dt / 3.6e6 / capacity_kwh * 100
    if soc >= 100 or soc <= 0:
        soc, power = min(100.0, max(0.0, soc)), 0.0
    b.battery_soc_pct, b.battery_power_w = soc, power
    return b.grid_ok or had_charge


def charger_power(mode: str, max_power_w: float, car: Car, grid_ok: bool) -> float:
    if mode == "charge" and grid_ok and car.connected and car.energy_needed_kwh > 0:
        return float(max_power_w)
    return 0.0
