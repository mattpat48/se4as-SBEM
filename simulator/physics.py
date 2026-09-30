"""Physical state of apartments and stairwells: air, comfort, hazards (fire, gas, CO).

Every quantity is a first-order system updated with the exact solution
x <- x_eq + (x - x_eq) * exp(-dt / tau), stable for any dt.
"""
import math
from dataclasses import dataclass

from environment import Outdoor


def relax(x: float, x_eq: float, tau_s: float, dt: float) -> float:
    return x_eq + (x - x_eq) * math.exp(-dt / tau_s)


@dataclass
class ApartmentState:
    temperature: float = 20.0
    humidity: float = 50.0
    co2: float = 450.0
    smoke: float = 0.0
    gas: float = 0.0
    co: float = 0.0
    fire: float = 0.0
    extinguishing: bool = False
    light: float = 0.0
    noise: float = 30.0


@dataclass
class ApartmentInputs:
    outdoor: Outdoor
    people: int
    awake: int
    actuators: dict[str, dict]      # effective state by actuator type
    volume_m3: float
    orientation: str
    insulation: str
    powered: bool
    showering: int = 0
    cooking: bool = False
    siren_on: bool = False
    gas_leak_rate: float = 0.0
    co_rate: float = 0.0


def _ventilation_level(inp: ApartmentInputs) -> float:
    return inp.actuators["ventilation"]["level"] if inp.powered else 0


def _window_open(inp: ApartmentInputs) -> bool:
    return inp.actuators["window"]["position"] == "open"


def _gas_open(inp: ApartmentInputs) -> bool:
    return inp.actuators["gas_valve"]["position"] == "open"


def air_changes(inp: ApartmentInputs, p: dict) -> float:
    ach = p["apartment"]["ach"]
    total = ach["infiltration"] + ach["per_ventilation_level"] * _ventilation_level(inp)
    if _window_open(inp):
        total += ach["window_open"]
    return total


def heating_active(s: ApartmentState, inp: ApartmentInputs, p: dict) -> bool:
    hvac = inp.actuators["hvac"]
    return (inp.powered and hvac["mode"] == "heat" and _gas_open(inp)
            and s.temperature < hvac["setpoint"] - p["apartment"]["hvac_deadband_c"])


def cooling_active(s: ApartmentState, inp: ApartmentInputs, p: dict) -> bool:
    hvac = inp.actuators["hvac"]
    return (inp.powered and hvac["mode"] == "cool"
            and s.temperature > hvac["setpoint"] + p["apartment"]["hvac_deadband_c"])


def _first_order(x: float, source_h: float, rate_h: float, x_out: float, dt: float) -> float:
    """Exact step of dx/dt = source - rate * (x - x_out), rates per hour."""
    x_eq = x_out + source_h / rate_h
    return relax(x, x_eq, 3600 / rate_h, dt)


def _psat_hpa(t_c: float) -> float:
    """Saturation vapour pressure (Magnus formula)."""
    t_c = min(t_c, 150.0)
    return 6.112 * math.exp(17.62 * t_c / (243.12 + t_c))


def _db_sum(levels: list[float]) -> float:
    return 10 * math.log10(sum(10 ** (db / 10) for db in levels))


def step_apartment_air(s: ApartmentState, inp: ApartmentInputs, dt: float, p: dict) -> None:
    a = p["apartment"]
    out = inp.outdoor
    heating, cooling = heating_active(s, inp, p), cooling_active(s, inp, p)
    ach = air_changes(inp, p)
    blinds = inp.actuators["blinds"]["position"] / 100

    # Temperature: exchange with outdoor, then internal gains and HVAC (never past the set-point).
    t = relax(s.temperature, out.temperature, a["tau_env_h"][inp.insulation] * 3600, dt)
    if _window_open(inp):
        t = relax(t, out.temperature, a["window_tau_min"] * 60, dt)
    gains_h = a["person_heat_c_h"] * inp.people + a["solar_gain_c_h"][inp.orientation] * out.sun * blinds
    t += gains_h * dt / 3600
    # HVAC is sized to beat the losses: the room moves toward the set-point at hvac_rate (net).
    setpoint = inp.actuators["hvac"]["setpoint"]
    hvac_step = a["hvac_rate_c_h"] * dt / 3600
    if heating:
        t = max(t, min(setpoint, s.temperature + hvac_step))
    elif cooling:
        t = min(t, max(setpoint, s.temperature - hvac_step))
    s.temperature = t

    # CO2 mass balance.
    g_h = inp.people * a["co2_per_person_ppm_h"] * (a["co2_reference_volume_m3"] / inp.volume_m3)
    s.co2 = _first_order(s.co2, g_h, ach, a["co2_outdoor_ppm"], dt)

    # Humidity: people, showers and cooking as sources, air changes toward outdoor, cooling dries.
    h = a["humidity"]
    shower_h = a["water"]["shower_min"] / 60
    meal_h = _meal_duration_h(a["meals"])
    src_h = h["per_person_h"] * inp.people + h["shower_points"] / shower_h * inp.showering
    if inp.cooking:
        src_h += h["cooking_points"] / meal_h
    outdoor_rh_inside = out.humidity * _psat_hpa(out.temperature) / _psat_hpa(s.temperature)
    hum = _first_order(s.humidity, src_h, ach, min(100.0, outdoor_rh_inside), dt)
    if cooling:
        hum -= h["cooling_removal_h"] * dt / 3600
    s.humidity = min(100.0, max(0.0, hum))

    # Light and noise.
    lights = inp.actuators["lights"]["level"] if inp.powered else 0
    s.light = out.light * a["light"]["window_factor"] * blinds + lights * a["light"]["lux_per_light_level"]
    n = a["noise"]
    attenuation = n["window_open_attenuation"] if _window_open(inp) else n["window_closed_attenuation"]
    levels = [n["base_db"], out.noise_level - attenuation] + [n["person_db"]] * inp.awake
    if inp.siren_on:
        levels.append(n["siren_db"])
    s.noise = _db_sum(levels)


def _meal_duration_h(meals: list[list[str]]) -> float:
    start, end = meals[0]
    sh, sm = (int(x) for x in start.split(":"))
    eh, em = (int(x) for x in end.split(":"))
    return max(0.25, (eh * 60 + em - sh * 60 - sm) / 60)


SMOKE_TAU_S = 60.0          # smoke follows the fire intensity with a one-minute lag
FIRE_OUT_BELOW = 1e-3       # an extinguishing fire below this intensity is out


def ignite(s: ApartmentState, p: dict) -> None:
    s.fire = max(s.fire, p["fire"]["ignition_intensity"])
    s.extinguishing = False


def _oxygenated(inp: ApartmentInputs) -> bool:
    return _ventilation_level(inp) > 0 or _window_open(inp)


def step_apartment_hazards(s: ApartmentState, inp: ApartmentInputs, dt: float, p: dict) -> None:
    f = p["fire"]
    ach = air_changes(inp, p)
    boiler_on = heating_active(s, inp, p) or inp.showering > 0

    # Fire intensity: exact logistic growth, or exponential decay while being extinguished.
    if s.extinguishing:
        s.fire = relax(s.fire, 0.0, f["extinguish_tau_min"] * 60, dt)
        if s.fire < FIRE_OUT_BELOW:
            s.fire, s.extinguishing = 0.0, False
    elif s.fire > 0:
        r = f["growth_per_min"] / 60 * (f["oxygen_factor"] if _oxygenated(inp) else 1.0)
        i = min(s.fire, 1.0)
        s.fire = 1.0 if i >= 1 else 1 / (1 + (1 - i) / i * math.exp(-r * dt))
    fire = s.fire

    s.smoke = relax(s.smoke, f["smoke_max"] * fire, SMOKE_TAU_S, dt) * math.exp(-ach * dt / 3600)
    s.co2 += f["co2_ppm_h"] * fire * dt / 3600
    s.temperature += f["heat_c_h"] * fire * dt / 3600
    if s.extinguishing:
        s.temperature = relax(s.temperature, inp.outdoor.temperature, f["extinguish_tau_min"] * 60, dt)

    co_src = f["co_ppm_h"] * fire
    if boiler_on and _gas_open(inp):
        co_src += inp.co_rate
    s.co = max(0.0, _first_order(s.co, co_src, ach, 0.0, dt))

    gas_src = inp.gas_leak_rate * 60 if _gas_open(inp) else 0.0
    s.gas = min(100.0, max(0.0, _first_order(s.gas, gas_src, ach, 0.0, dt)))


def spread_fire(states: dict[str, ApartmentState], adjacency: dict[str, list[str]],
                dt: float, rng, p: dict) -> list[str]:
    f = p["fire"]
    prob = 1 - (1 - f["spread_prob_per_min"]) ** (dt / 60)
    ignited: list[str] = []
    for uid in sorted(states):
        s = states[uid]
        if s.fire <= f["spread_threshold"] or s.extinguishing:
            continue
        for other in sorted(adjacency.get(uid, [])):
            target = states.get(other)
            if target is None or target.fire > 0 or other in ignited:
                continue
            if rng.random() < prob:
                ignite(target, p)
                ignited.append(other)
    return ignited


@dataclass
class StairwellState:
    temperature: float = 18.0
    smoke: float = 0.0
    light: float = 0.0


def step_stairwell(s: StairwellState, apartments: list[ApartmentState], smoke_vent_open: bool,
                   lights_mode: str, outdoor: Outdoor, dt: float, p: dict) -> None:
    st = p["stairwell"]
    if apartments:
        s.temperature = sum(a.temperature for a in apartments) / len(apartments)
    inflow = p["fire"]["stairwell_smoke_share"] * max((a.smoke for a in apartments), default=0.0)
    s.smoke = relax(s.smoke, inflow, SMOKE_TAU_S, dt)
    if smoke_vent_open:
        s.smoke *= math.exp(-dt / (st["smoke_vent_tau_min"] * 60))
    s.light = outdoor.light * st["light_factor"] + st["lux_per_mode"][lights_mode]
