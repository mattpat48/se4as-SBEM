# Simulator (Monitor v2, tappe 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `simulator` service — the managed resource of the MAPE-K loop: a residential complex in L'Aquila (4 buildings × 4 floors × 2 apartments, stairwells, park, parking) with a simulated clock, physics, people, 414 sensors and 283 actuators that obey commands, plus 14 scenarios and fault injection, all over MQTT (`Complex/…`).

**Architecture:** Pure-Python domain modules (model, clock, environment, occupancy, physics, energy, devices, scenarios) are orchestrated by a `Simulation` class that has no MQTT dependency and is fully unit-testable. A thin `SimulatorService` adapter maps `Simulation` to MQTT topics; `main.py` wires the paho client and the real-time loop. The v1 stack (`sensors/`, `City/…`) is left untouched and keeps running in parallel.

**Tech Stack:** Python 3.11, `paho-mqtt` 2.x, `pytest` (run through `uv`), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-30-monitor-v2-design.md` (sections 3–9, 12–14). Status tracker: `docs/MONITOR.md`.

**Plan 1 of 3.** Plan 2 = `monitor` service (tappa 3). Plan 3 = adaptation of Analyzer, Planner, Node-RED, UI, Grafana (tappe 4–5). They will be written after this plan is approved.

## Global Constraints

- Python 3.11 (`python:3.11-slim` image). Runtime dependency of `simulator/`: only `paho-mqtt>=2.0,<3`. Tests: `pytest` via `uv`.
- Test command (from `simulator/`): `uv run --no-project --python 3.11 --with-requirements requirements.txt --with pytest pytest -q <path>`
- paho client created as `mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="simulator")`.
- Topic root `Complex`; layout `Complex/<layer>/<area>/<unit_id>/<device_type>`; QoS/retain exactly as spec §7.2.
- IDs exactly as spec §4: apartments `A-2-1` (floor 0–3, number 1–2), stairwell `A-S`, building `A`, park `park`, charger `EV-A` (area `parking`), device `<unit_id>.<type>`.
- `timestamp` = `time.time()` (float epoch, UTC). `sim_time` = `datetime.isoformat(timespec="seconds")`, naive local time, no timezone.
- All randomness comes from `random.Random` instances derived from `complex.seed` (`random.Random(f"{seed}-{name}")`); no module-level `random` calls.
- Ack rejection reasons are Italian strings, format pinned in Task 9.
- `config/complex.json` is read-only for the simulator; path from env `CONFIG_PATH`, default `/app/config/complex.json`.
- Do not modify v1 code or topics (`sensors/`, `analyzer/`, `planner/`, `nodered/`, `grafana/`, `ui/`, `City/…`).
- Identifiers and code comments in English (like the existing code); documentation in Italian.
- Work on branch `feature/monitor-v2-simulator`. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Malformed MQTT payloads on `Complex/cmd/#` and `Complex/control/#` (non-JSON bytes, JSON arrays, missing `cmd_id`) must never stop the simulation loop — Task 11 `test_invalid_payload_rejected`, Task 12 `test_on_message_garbage_does_not_raise`.
2. Starting the same scenario twice on the same target, or stopping an unknown `scenario_id`, must give a clear error, not a double fire — Task 10 `test_duplicate_scenario_rejected`, `test_stop_unknown_raises`.
3. Clock jumps backwards or into another month (e.g. to January to show winter) must keep the outdoor model finite and consistent — Task 2 `test_jump_to_earlier_datetime`, Task 3 `test_month_change_is_finite`.
4. Schedules that cross midnight (students awake 08:00–01:00) and ×60 runs crossing day boundaries — Task 4 `test_awake_window_crosses_midnight`, Task 11 `test_long_run_readings_finite_and_in_range`.
5. After a broker restart the simulator must republish its retained topics (model, clock, states, scenarios, status) — Task 12 `test_on_connect_republishes_after_reconnect`.

---

## File Structure

```
config/complex.json                 Knowledge statica (spec §5, §6, §8, §10.5)
simulator/
  Dockerfile, requirements.txt, pytest.ini
  model.py        load + validate + expand complex.json → ComplexModel
  clock.py        SimClock (speed, jump, message)
  environment.py  Outdoor state: sun, weather, temperature, traffic, PM, seismic, soil
  occupancy.py    People per apartment, stair transit, evacuation, EV cars
  physics.py      Apartment air & hazards (fire, gas, CO), fire spread, stairwell
  energy.py       Actuator power, apartment flows (power/water/gas), PV, battery, chargers
  devices.py      SensorDevice (noise, saturation, faults), ActuatorDevice (commands, ack, faults)
  scenarios.py    ScenarioManager: 14 scenarios, targets, Effects
  simulation.py   Simulation: orchestrates one step, readings, states, commands, controls
  mqtt_io.py      Topic helpers + SimulatorService (MQTT adapter, no business logic)
  main.py         paho client, Last Will, real-time loop
  tests/          one test file per module + conftest.py
scripts/e2e_simulator.py            end-to-end check against the running stack
docker-compose.yml                  + service `simulator`
docs/MONITOR.md                     tappe 1–2 marked done
```

`energy.py` is split out of `physics.py` (spec §3.2 lists energy under physics) to keep files focused; `simulation.py` and `mqtt_io.py` split the spec's `main.py` responsibilities so the loop logic is testable without a broker.

---

### Task 1: Scaffolding, `config/complex.json`, model expansion

**Files:**
- Create: `simulator/requirements.txt`, `simulator/pytest.ini`, `simulator/Dockerfile`, `config/complex.json`, `simulator/model.py`, `simulator/tests/conftest.py`, `simulator/tests/test_model.py`
- Modify: `.gitignore` (add `.pytest_cache/`)

**Interfaces:**
- Produces:
  ```python
  class ConfigError(Exception): ...
  @dataclass(frozen=True)
  class SensorType:  name: str; unit: str; valid_range: tuple[float, float]; noise: float
                     rest_value: float | None; stuck_check: bool; drift_check: bool
  @dataclass(frozen=True)
  class ActuatorType: name: str; commands: dict[str, dict]; default: dict; power_w: dict; essential: bool
  @dataclass(frozen=True)
  class Device: device_id: str; unit_id: str; area: str; type: str; kind: str   # "sensor" | "actuator"
  @dataclass
  class Unit: id: str; kind: str   # "apartment" | "stairwell" | "building" | "park" | "charger"
              area: str; sensors: list[str]; actuators: list[str]; attrs: dict; adjacent: list[str]
  @dataclass
  class ComplexModel:
      settings: dict; sensor_types: dict[str, SensorType]; actuator_types: dict[str, ActuatorType]
      profiles: dict; units: dict[str, Unit]; physics: dict; monitor: dict; layouts: dict
      def apartments(self) -> list[Unit]           # sorted by id
      def units_of(self, kind: str) -> list[Unit]  # sorted by id
      def devices(self) -> list[Device]            # sorted by device_id
      def to_json(self) -> dict                    # payload of Complex/model
  def build_model(raw: dict) -> ComplexModel
  def load_model(path: str | Path) -> ComplexModel
  ```
- `Unit.attrs` keys — apartment: `building, floor, number, profile, residents, orientation, area_m2, height_m, volume_m3, insulation`; stairwell: `building`; building: `floors, pv_peak_w, battery_kwh, battery_max_w, layout`; park: `area_m2`; charger: `building, max_power_w`.
- `layouts` = `{"park": <park.layout>, "parking": <parking.layout>}`.
- `to_json()` = `{"complex": settings, "device_types": <raw catalogue>, "profiles": profiles, "units": [asdict(u) for u in sorted units], "layouts": layouts, "monitor": monitor}`.

- [ ] **Step 1: Create branch and scaffolding**

```bash
git checkout -b feature/monitor-v2-simulator
```
`requirements.txt`: `paho-mqtt>=2.0,<3`. `pytest.ini`: `[pytest]` / `pythonpath = .` / `testpaths = tests`. `Dockerfile`: same pattern as `sensors/Dockerfile` with `FROM python:3.11-slim`, `CMD ["python", "-u", "main.py"]`. `tests/conftest.py` provides fixtures `raw_config` (dict loaded from `../config/complex.json` relative to the tests dir, deep-copied per test) and `model` (`build_model(raw_config)`).

- [ ] **Step 2: Write `config/complex.json`**

Top-level sections and values from spec §5.1–5.2, §6, §10.5. Exact contents to transcribe:

- `complex`: `{"name": "Residenza Parco", "lat": null, "lon": null, "seed": 42, "sampling_period_s": 10, "actuator_state_period_s": 60, "physics_step_s": 1, "clock": {"speed": 1, "max_speed": 60}}`
- `device_types`: all 19 sensor types of spec §6.1 as `{"kind": "sensor", "unit", "valid_range": [min, max], "noise", "rest_value", "stuck_check", "drift_check"}` with the table's values; all 17 actuator types of spec §6.2 as `{"kind": "actuator", "commands", "default", "power_w", "essential"}` where:
  - `commands` entries use one of: `{"enum": [...]}`, `{"min": a, "max": b}` (+ `"integer": true` for `ventilation.level`), `{"string": true}`, `{"bool": true}`.
  - `power_w` uses one of: `{"const": W}`, `{"by": "<key>", "map": {value: W}}`, `{"by": "<key>", "per_unit": W}`, `{"dynamic": true}` (battery, ev_charger). Values: hvac `by mode {off:0, heat:100, cool:1500}`; ventilation `by level per_unit 30`; window, blinds, gas_valve, smoke_vent `const 0`; lights `by level per_unit 1`; alarm `by siren {on:10, off:0}`; resident_display `const 5`; stair_lights `by mode {off:0, normal:50, evacuation:80}`; evacuation_siren `by siren {on:20, off:0}`; elevator `by mode {normal:500, recall:100}`; irrigation `by state {on:500, off:0}`; park_lights `by state {on:2000, off:0}`; evacuation_signs `by state {on:200, off:0}`.
  - `resident_display.commands` = `{"message": {"string": true}, "level": {"enum": ["info","warning","danger"]}, "clear": {"bool": true}}`, default `{"message": "", "level": "info"}`.
  - `ev_charger.default` = `{"mode": "charge", "max_power_w": 7400}`.
- `profiles`, `apartment_template`, `stairwell_template`, `park`, `parking`, `adjacency_overrides: []`: as spec §5.1.
- `buildings`: A, B, C, D with spec §5.2 layout and orientation (`A {"1":"S","2":"N"}`, `B {"1":"O","2":"E"}`, `C {"1":"N","2":"S"}`, `D {"1":"E","2":"O"}`), each `floors 4, apartments_per_floor 2, pv_peak_w 20000, battery_kwh 40, battery_max_w 10000, sensors ["pv_power"], actuators ["elevator","battery"], width_m 24, depth_m 12, floor_height_m 3`; `overrides` only on A: `{"A-0-1": {"profile": "anziano", "residents": 1}}`.
- `monitor`: exactly spec §10.5.
- `physics`:

```json
{
  "outdoor": {
    "monthly_mean_temp": [2.5, 3.5, 7, 10, 14.5, 19, 22, 22, 17.5, 12.5, 7, 3.5],
    "daily_amplitude": 5, "t_min_hour": 6, "t_max_hour": 15,
    "day_length_h": {"min": 9.2, "max": 15.2}, "solar_noon_h": 12.5,
    "max_lux": 100000, "cloud_light_factor": 0.8,
    "humidity_at_tmin": 85, "humidity_at_tmax": 50, "rain_humidity_bonus": 20,
    "rain_start_prob_h": 0.08, "rain_stop_prob_h": 0.5, "rain_mm_h": [1, 10], "rain_cloudiness": 0.9,
    "wind_base_kmh": [0, 20], "traffic_noise_db": {"night": 45, "peak": 65}, "traffic_peaks_h": [8, 18],
    "pm10_base": 15, "pm2_5_base": 8, "pm10_traffic": 20, "pm2_5_traffic": 10, "rain_pm_factor": 0.5,
    "seismic_background": [0, 0.5], "earthquake_noise": 0.1,
    "soil": {"dry_rate_h": 0.5, "rain_gain_per_mm": 3, "irrigation_gain_h": 15},
    "scenario_relax_tau_h": 6,
    "storm": {"rain_mm_h": [30, 60], "wind_kmh": [60, 90]}
  },
  "apartment": {
    "tau_env_h": {"bassa": 3, "media": 6, "alta": 12}, "window_tau_min": 20,
    "person_heat_c_h": 0.15, "solar_gain_c_h": {"S": 1.5, "E": 1.0, "O": 1.0, "N": 0.3},
    "hvac_rate_c_h": 2, "hvac_deadband_c": 0.5,
    "co2_outdoor_ppm": 420, "co2_per_person_ppm_h": 92.6, "co2_reference_volume_m3": 216,
    "ach": {"infiltration": 0.3, "per_ventilation_level": 0.5, "window_open": 4},
    "humidity": {"per_person_h": 2, "shower_points": 15, "cooking_points": 5, "cooling_removal_h": 3},
    "light": {"window_factor": 0.02, "lux_per_light_level": 5},
    "noise": {"base_db": 30, "person_db": 50, "window_closed_attenuation": 30, "window_open_attenuation": 10, "siren_db": 85},
    "power": {"base_w": 150, "cooking_w": 2000},
    "water": {"shower_l_min": 10, "shower_min": 8, "kitchen_l_min": 5},
    "gas": {"cooking_m3_h": 0.3, "heating_m3_h": 1.2, "hot_water_m3_h": 0.8},
    "meals": [["12:30", "13:30"], ["19:30", "20:30"]],
    "shower_windows": [["06:30", "08:00"], ["19:00", "22:00"]]
  },
  "fire": {
    "ignition_intensity": 0.05, "growth_per_min": 0.2, "oxygen_factor": 1.5, "heat_c_h": 300,
    "smoke_max": 100, "co_ppm_h": 500, "co2_ppm_h": 5000,
    "spread_threshold": 0.7, "spread_prob_per_min": 0.1, "stairwell_smoke_share": 0.3, "extinguish_tau_min": 10
  },
  "stairwell": {"smoke_vent_tau_min": 3, "light_factor": 0.05, "lux_per_mode": {"off": 0, "normal": 150, "evacuation": 300}, "transit_s": 60},
  "energy": {"pv_cloud_factor": 0.7},
  "occupancy": {
    "jitter_min": 30, "weekend_home_prob": 0.5, "evacuation_delay_min": [2, 5],
    "schedules": {
      "famiglia":   {"groups": [{"share": 0.5, "away": [["08:00", "18:00"]]}, {"share": 0.5, "away": [["08:00", "14:00"]]}], "awake": ["06:30", "23:00"]},
      "lavoratori": {"groups": [{"share": 1.0, "away": [["08:00", "19:00"]]}], "awake": ["06:30", "24:00"]},
      "anziano":    {"groups": [{"share": 1.0, "away": [["10:00", "11:00"]]}], "awake": ["07:00", "22:00"]},
      "studenti":   {"groups": [{"share": 1.0, "away": [["09:00", "13:00"], ["15:00", "18:00"]]}], "awake": ["08:00", "01:00"]}
    }
  },
  "ev": {"arrive_h": [18, 20], "leave_h": [7, 9], "need_kwh": [10, 30]},
  "drift_rate_per_min": {"temperature": 0.3, "humidity": 1.0, "co2": 30, "default_span_fraction": 0.005}
}
```

(Values not literally in the spec — rain stop probability, stair light lux, schedule groups, drift defaults for other types — are the plan's fill-ins, kept in config so they can be tuned without code.)

- [ ] **Step 3: Write the failing tests** (`tests/test_model.py`)

```python
def test_unit_counts(model):
    assert len(model.units_of("apartment")) == 32
    assert len(model.units_of("stairwell")) == 4
    assert len(model.units_of("building")) == 4
    assert len(model.units_of("park")) == 1
    assert len(model.units_of("charger")) == 4

def test_device_counts(model):
    kinds = [d.kind for d in model.devices()]
    assert kinds.count("sensor") == 414
    assert kinds.count("actuator") == 283

def test_apartment_ids(model):
    ids = {u.id for u in model.apartments()}
    assert ids == {f"{b}-{f}-{n}" for b in "ABCD" for f in range(4) for n in (1, 2)}

def test_adjacency(model):
    assert set(model.units["A-1-1"].adjacent) == {"A-1-2", "A-0-1", "A-2-1", "A-S"}
    assert set(model.units["A-0-1"].adjacent) == {"A-0-2", "A-1-1", "A-S"}
    assert len(model.units["A-S"].adjacent) == 8

def test_adjacency_overrides(raw_config):
    raw_config["adjacency_overrides"] = [{"op": "add", "units": ["A-0-1", "B-0-1"]},
                                         {"op": "remove", "units": ["A-1-1", "A-1-2"]}]
    m = build_model(raw_config)
    assert "B-0-1" in m.units["A-0-1"].adjacent and "A-0-1" in m.units["B-0-1"].adjacent
    assert "A-1-2" not in m.units["A-1-1"].adjacent

def test_override_and_orientation(model):
    a = model.units["A-0-1"].attrs
    assert (a["profile"], a["residents"]) == ("anziano", 1)
    assert model.units["A-2-1"].attrs["orientation"] == "S"
    assert model.units["A-2-2"].attrs["orientation"] == "N"
    assert model.units["B-3-1"].attrs["orientation"] == "O"
    assert model.units["A-2-1"].attrs["volume_m3"] == pytest.approx(216)

def test_profiles_deterministic_and_in_range(raw_config):
    m1, m2 = build_model(copy.deepcopy(raw_config)), build_model(copy.deepcopy(raw_config))
    for u in m1.apartments():
        p, r = u.attrs["profile"], u.attrs["residents"]
        assert p == m2.units[u.id].attrs["profile"] and r == m2.units[u.id].attrs["residents"]
        lo, hi = m1.profiles[p]["residents"]
        assert lo <= r <= hi or u.id == "A-0-1"

def test_device_ids_and_areas(model):
    by_id = {d.device_id: d for d in model.devices()}
    for did in ["A-2-1.co2", "park.pm10", "EV-A.ev_charger", "A.pv_power", "A.battery", "A-S.smoke_vent"]:
        assert did in by_id
    assert by_id["EV-A.ev_charger"].area == "parking"
    assert by_id["park.pm10"].area == "park"
    assert by_id["A-2-1.co2"].area == "A"

@pytest.mark.parametrize("mutate, fragment", [
    (lambda c: c["apartment_template"]["sensors"].append("laser"), "laser"),
    (lambda c: c["buildings"][0]["overrides"].update({"Z-9-9": {"residents": 2}}), "Z-9-9"),
    (lambda c: c["buildings"].append(copy.deepcopy(c["buildings"][0])), "A"),
    (lambda c: c["apartment_template"]["actuators"].append("co2"), "co2"),
])
def test_invalid_config_raises(raw_config, mutate, fragment):
    mutate(raw_config)
    with pytest.raises(ConfigError, match=fragment):
        build_model(raw_config)

def test_to_json_is_serializable(model):
    payload = json.loads(json.dumps(model.to_json()))
    assert len(payload["units"]) == 45
    assert payload["complex"]["seed"] == 42
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd simulator && uv run --no-project --python 3.11 --with-requirements requirements.txt --with pytest pytest -q tests/test_model.py`
Expected: FAIL (`ModuleNotFoundError: No module named 'model'`)

- [ ] **Step 5: Implement `simulator/model.py`**

Expansion rules exactly as spec §5.3. Profile assignment: one `random.Random(f"{seed}-profiles")`, apartments iterated in sorted id order, `rng.choices(names, weights)` then `rng.randint(lo, hi)`; overrides applied afterwards. Building units get the building's `sensors`/`actuators`; charger units get `["ev_charger"]`; park unit id and area `park`. `adjacency_overrides` entries `{"op": "add"|"remove", "units": [a, b]}` apply symmetrically. `ConfigError` messages must contain the offending name/id.

- [ ] **Step 6: Run tests to verify they pass**

Run: same command as Step 4. Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore config/complex.json simulator/
git commit -m "feat(simulator): complex model config and expansion" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Simulated clock

**Files:**
- Create: `simulator/clock.py`, `simulator/tests/test_clock.py`

**Interfaces:**
- Produces:
  ```python
  class SimClock:
      def __init__(self, start: datetime, speed: float = 1, max_speed: float = 60)
      now: datetime            # property
      speed: float             # property
      def advance(self, real_dt: float) -> float      # returns simulated seconds elapsed
      def set_speed(self, speed: float) -> None       # ValueError outside [1, max_speed]
      def jump_to(self, target: str) -> None          # "HH:MM" = next occurrence (strictly after now); ISO datetime = exact; ValueError otherwise
      def to_message(self, real_ts: float) -> dict    # {"sim_time", "speed", "timestamp"}
  ```

- [ ] **Step 1: Write the failing tests**

```python
START = datetime(2026, 9, 30, 21, 15)

def test_advance_scales_with_speed():
    c = SimClock(START, speed=60)
    assert c.advance(1.0) == 60
    assert c.now == START + timedelta(seconds=60)

@pytest.mark.parametrize("bad", [0, 0.5, 61, -1])
def test_set_speed_out_of_range(bad):
    with pytest.raises(ValueError):
        SimClock(START).set_speed(bad)

def test_jump_to_later_same_day():
    c = SimClock(START); c.jump_to("22:00")
    assert c.now == datetime(2026, 9, 30, 22, 0)

def test_jump_to_hour_already_passed_goes_next_day():
    c = SimClock(START); c.jump_to("08:00")
    assert c.now == datetime(2026, 10, 1, 8, 0)

def test_jump_to_earlier_datetime():
    c = SimClock(START); c.jump_to("2026-01-15T08:00:00")
    assert c.now == datetime(2026, 1, 15, 8, 0)

@pytest.mark.parametrize("bad", ["25:00", "garbage", "", "12:61"])
def test_jump_to_invalid(bad):
    with pytest.raises(ValueError):
        SimClock(START).jump_to(bad)

def test_to_message():
    c = SimClock(START, speed=60)
    assert c.to_message(1790440000.0) == {"sim_time": "2026-09-30T21:15:00", "speed": 60, "timestamp": 1790440000.0}
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_clock.py` → FAIL (module missing)
- [ ] **Step 3: Implement `simulator/clock.py`** per the interface.
- [ ] **Step 4: Run to verify pass** — same command → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(simulator): simulated clock" -m "Co-Authored-By: …"` (files: `simulator/clock.py`, `simulator/tests/test_clock.py`)

---

### Task 3: Outdoor environment

**Files:**
- Create: `simulator/environment.py`, `simulator/tests/test_environment.py`

**Interfaces:**
- Consumes: `physics["outdoor"]` from Task 1.
- Produces:
  ```python
  @dataclass
  class Outdoor: temperature: float; humidity: float; rain_level: float; wind_speed: float; light: float
                 noise_level: float; seismic: float; pm10: float; pm2_5: float; soil_moisture: float
                 cloudiness: float; sun: float; raining: bool
  @dataclass
  class EnvEffects: temp_delta: float = 0.0; pm_factor: float = 1.0; storm: bool = False
                    clear_sky: bool = False; earthquake_magnitude: float | None = None
  def sun_factor(now: datetime, p: dict) -> float           # 0..1
  def base_temperature(now: datetime, p: dict) -> float     # monthly mean + daily curve, no scenario
  def traffic_factor(hour: float, p: dict) -> float         # 0..1, 1 at traffic peaks
  class Environment:
      def __init__(self, p: dict, rng: random.Random, start: datetime)
      state: Outdoor
      def step(self, now: datetime, dt: float, effects: EnvEffects, irrigation_on: bool) -> None
  ```
- Model rules (spec §8.2): day length `L = mid + amp·cos(2π(doy−172)/365)` with `mid = (min+max)/2`, `amp = (max−min)/2`; sunrise `solar_noon − L/2`; `sun = sin(π·(h − sunrise)/L)` inside daylight, else 0. Daily temperature curve: rising `−cos(π·(h−6)/9)` from 6 to 15, falling `cos(π·(h−15)/15)` from 15 to 6 (wrapping midnight), times `daily_amplitude`. Humidity interpolated linearly between `humidity_at_tmin` (at mean−amp) and `humidity_at_tmax` (at mean+amp), clamped 0–100, `+rain_humidity_bonus` when raining. Traffic factor: `max(0, 1 − |h − peak|/3)` over the two peaks, noise = `night + (peak − night)·factor`. Scenario temperature delta relaxes toward `effects.temp_delta` with `tau = scenario_relax_tau_h` (both on start and stop). Rain: Markov with per-step probabilities `1 − (1 − p_h)^(dt/3600)`; storm forces rain/wind in the storm ranges; `clear_sky` forces no rain and cloudiness 0. PM = `(base + traffic·factor) · pm_factor · (rain_pm_factor if raining)`. Soil moisture: `−dry_rate_h·sun·(T/20)` per hour, `+rain_gain_per_mm·rain` per hour, `+irrigation_gain_h` per hour when irrigating and T > 0 °C; clamp 0–100.

- [ ] **Step 1: Write the failing tests**

```python
P = load_model(CONFIG).physics["outdoor"]   # CONFIG from conftest

def test_sun_zero_at_night():
    assert sun_factor(datetime(2026, 6, 21, 2, 0), P) == 0

def test_sun_peaks_at_solar_noon_in_june():
    assert sun_factor(datetime(2026, 6, 21, 12, 30), P) == pytest.approx(1.0, abs=1e-3)

def test_day_length_by_season():
    assert sun_factor(datetime(2026, 6, 21, 5, 0), P) > 0      # sunrise ≈ 4:54
    assert sun_factor(datetime(2026, 12, 21, 7, 30), P) == 0   # sunrise ≈ 7:54

def test_base_temperature_extremes():
    assert base_temperature(datetime(2026, 1, 15, 15, 0), P) == pytest.approx(7.5)
    assert base_temperature(datetime(2026, 7, 15, 6, 0), P) == pytest.approx(17.0)

def test_traffic_factor():
    assert traffic_factor(8, P) == 1 and traffic_factor(3, P) == 0

def test_light_reduced_by_rain(env_at_noon):   # fixture: Environment at 2026-06-21 12:30
    env_at_noon.step(datetime(2026, 6, 21, 12, 30), 1, EnvEffects(clear_sky=True), False)
    clear = env_at_noon.state.light
    env_at_noon.step(datetime(2026, 6, 21, 12, 30), 1, EnvEffects(storm=True), False)
    assert env_at_noon.state.light == pytest.approx(clear * (1 - 0.8 * 0.9), rel=0.01)

def test_heatwave_relaxes_with_six_hour_tau(env):
    now = datetime(2026, 7, 15, 12, 0)
    base = base_temperature(now, P)
    for _ in range(360): env.step(now, 60, EnvEffects(temp_delta=10), False)   # 6 h, clock frozen
    assert env.state.temperature - base == pytest.approx(10 * (1 - math.exp(-1)), abs=0.1)

def test_storm_ranges(env):
    env.step(datetime(2026, 9, 30, 15, 0), 60, EnvEffects(storm=True), False)
    assert 30 <= env.state.rain_level <= 60 and 60 <= env.state.wind_speed <= 90

def test_seismic_background_and_earthquake(env):
    env.step(datetime(2026, 9, 30, 15, 0), 1, EnvEffects(), False)
    assert 0 <= env.state.seismic <= 0.5
    env.step(datetime(2026, 9, 30, 15, 0), 1, EnvEffects(earthquake_magnitude=5.8), False)
    assert env.state.seismic == pytest.approx(5.8, abs=0.5)

def test_irrigation_raises_soil_moisture(env):
    before = env.state.soil_moisture
    for _ in range(60): env.step(datetime(2026, 9, 30, 22, 0), 60, EnvEffects(clear_sky=True), True)
    assert env.state.soil_moisture > before + 10

def test_month_change_is_finite(env):
    t = datetime(2026, 9, 30, 12, 0)
    for i in range(2 * 24 * 60):     # 2 sim days at dt = 60, then a jump to January
        env.step(t + timedelta(minutes=i), 60, EnvEffects(), False)
    env.step(datetime(2027, 1, 15, 8, 0), 60, EnvEffects(), False)
    assert all(math.isfinite(v) for v in asdict(env.state).values() if not isinstance(v, bool))
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_environment.py` → FAIL
- [ ] **Step 3: Implement `simulator/environment.py`** per the interface and model rules above.
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): outdoor environment model`

---

### Task 4: Occupancy, evacuation, electric cars

**Files:**
- Create: `simulator/occupancy.py`, `simulator/tests/test_occupancy.py`

**Interfaces:**
- Consumes: `ComplexModel` (Task 1), `physics["occupancy"]`, `physics["ev"]`, `physics["apartment"]["meals"|"shower_windows"|"water"]`, `physics["stairwell"]["transit_s"]`.
- Produces:
  ```python
  def in_window(hour: float, start: str, end: str) -> bool     # "HH:MM"; end may be <= start (crosses midnight); "24:00" allowed
  @dataclass
  class Activity: cooking: bool; showering: int                  # showers in progress
  class Occupancy:
      def __init__(self, model: ComplexModel, p: dict, rng: random.Random)
      home: dict[str, int]         # apartment_id -> people inside
      transit: dict[str, int]      # stairwell_id -> people passing now
      in_park: int                 # evacuated people gathered in the park
      def step(self, now: datetime, dt: float, evacuate: set[str], forced: str | None) -> None
          # forced ∈ {None, "all_home", "all_away"}; evacuate = apartments whose residents must leave
      def awake(self, apartment_id: str, now: datetime) -> int
      def activity(self, apartment_id: str, now: datetime) -> Activity
  @dataclass
  class Car: connected: bool; energy_needed_kwh: float
  class EVFleet:
      def __init__(self, charger_ids: list[str], p: dict, rng: random.Random)
      cars: dict[str, Car]
      def step(self, now: datetime, dt: float, charging_w: dict[str, float]) -> None
  ```
- Rules (spec §8.5): residents assigned to schedule groups round-robin by `share`; per apartment and per day a jitter in `±jitter_min` (seeded by apartment id and date); on Saturday/Sunday each resident skips its away windows with probability `weekend_home_prob` (seeded per resident and date). Each change of `home` adds the moved people to the building stairwell `transit` for `transit_s` simulated seconds. Evacuation: each person in an evacuated apartment leaves after a delay uniform in `evacuation_delay_min`, passes the stairwell and is added to `in_park`; when an apartment is no longer in `evacuate`, its residents return (leave `in_park`) and the schedule resumes. Cooking = someone awake at home inside a `meals` window. Showers: each resident gets one shower start per day (seeded) inside one of the `shower_windows`, lasting `water.shower_min`, only if home. Cars: per day arrival hour uniform in `arrive_h`, departure in `leave_h`, need uniform in `need_kwh` at arrival; `energy_needed_kwh` decreases by `charging_w · dt / 3.6e6`, floor 0.

- [ ] **Step 1: Write the failing tests** (fixture `occ(profile, residents, **params)` builds a one-apartment model with `build_model` — a single building `X` with `floors: 1`, `apartments_per_floor: 1`, override `X-0-1` = the given profile/residents, so the units are `X-0-1` and `X-S` — and returns `Occupancy(model, params, random.Random(0))` with `jitter_min = 0` plus any `params` overrides; fixture `ev` = `EVFleet(["EV-A"], model.physics["ev"], random.Random(0))`)

```python
WED, SAT = date(2026, 9, 30), date(2026, 10, 3)

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
```
(`step_until`/`step_ev` helpers in the test file advance minute by minute with `dt = 60` from 00:00 of the first day.)

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_occupancy.py` → FAIL
- [ ] **Step 3: Implement `simulator/occupancy.py`**
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): occupancy schedules, evacuation, EV fleet`

---

### Task 5: Apartment air physics

**Files:**
- Create: `simulator/physics.py`, `simulator/tests/test_physics_air.py`

**Interfaces:**
- Consumes: `Outdoor` (Task 3). Every function in `physics.py` and `energy.py` takes `p` = the **full** `model.physics` dict (sections `apartment`, `fire`, `stairwell`, `energy`).
- Produces:
  ```python
  def relax(x: float, x_eq: float, tau_s: float, dt: float) -> float    # x_eq + (x - x_eq)·exp(-dt/tau)
  @dataclass
  class ApartmentState: temperature: float = 20.0; humidity: float = 50.0; co2: float = 450.0
                        smoke: float = 0.0; gas: float = 0.0; co: float = 0.0; fire: float = 0.0
                        extinguishing: bool = False; light: float = 0.0; noise: float = 30.0
  @dataclass
  class ApartmentInputs: outdoor: Outdoor; people: int; awake: int; actuators: dict[str, dict]  # effective state by type
                         volume_m3: float; orientation: str; insulation: str; powered: bool
                         showering: int = 0; cooking: bool = False; siren_on: bool = False
                         gas_leak_rate: float = 0.0; co_rate: float = 0.0
  def air_changes(inp: ApartmentInputs, p: dict) -> float      # ACH per hour
  def heating_active(s: ApartmentState, inp: ApartmentInputs, p: dict) -> bool
  def cooling_active(s: ApartmentState, inp: ApartmentInputs, p: dict) -> bool
  def step_apartment_air(s: ApartmentState, inp: ApartmentInputs, dt: float, p: dict) -> None
      # updates temperature, humidity, co2, light, noise
  ```
- Rules (spec §8.3): when `powered` is False, `hvac`, `ventilation` and `lights` behave as off. `heating_active` = hvac `mode == "heat"` and `T < setpoint − deadband`, powered, and `gas_valve.position == "open"` (the boiler needs gas). `cooling_active` = `mode == "cool"` and `T > setpoint + deadband`, powered. ACH = infiltration + `per_ventilation_level·level` + `window_open` if open. Temperature: relax toward outdoor with `tau_env_h[insulation]` (and additionally with `window_tau_min` when the window is open), then add `person_heat·people + solar_gain[orientation]·sun·blinds/100 ± hvac_rate` (°C/h × dt/3600). CO₂: exact solution of `dC/dt = G − ACH·(C − C_out)` over dt, with `G = people·co2_per_person·(ref_volume/volume)`. Humidity: same pattern, sources from `humidity` params (shower and cooking points spread over their duration), relax toward outdoor humidity with ACH, `−cooling_removal_h` when cooling. Light = `outdoor.light·window_factor·blinds/100 + lights.level·lux_per_light_level`. Noise = `10·log10(Σ 10^(dB/10))` over base, `person_db` per awake person, outdoor noise minus the window attenuation, `siren_db` when `siren_on`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/conftest.py` (reused by Tasks 6–7): fixture `P` = `model.physics`, and helper `inputs(**kw) -> ApartmentInputs` with defaults outdoor 10 °C / 60 % / 0 lux / 45 dB / sun 0, 0 people, catalogue default actuator states, volume 216, orientation "S", insulation "media", powered True. Shortcut kwargs: `hvac` (dict), `ventilation` (level), `window`, `gas_valve` (position), `blinds` (position), `lights` (level), `alarm` (siren) set that actuator's state; `outdoor_t`, `outdoor_lux`, `sun` set the `Outdoor` fields; any other kwarg sets the `ApartmentInputs` field of the same name.

```python
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
    for _ in range(48 * 60): step_apartment_air(s, inputs(people=3, awake=3, ventilation=0), 60, P)
    assert s.co2 == pytest.approx(1346, abs=5)

def test_cooling_holds_setpoint():
    s = ApartmentState(temperature=28)
    for _ in range(6 * 60): step_apartment_air(s, inputs(outdoor_t=30, hvac={"mode": "cool", "setpoint": 24}), 60, P)
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
    for _ in range(1000): step_apartment_air(s, inputs(people=4, awake=4, window="open"), 60, P)
    assert math.isfinite(s.temperature) and s.co2 >= 420 - 1e-6
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_physics_air.py` → FAIL
- [ ] **Step 3: Implement the air part of `simulator/physics.py`**
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): apartment air physics`

---

### Task 6: Hazards (fire, gas, CO) and stairwell

**Files:**
- Modify: `simulator/physics.py`
- Create: `simulator/tests/test_physics_hazards.py`

**Interfaces:**
- Consumes: Task 5 types, `physics["fire"]`, `physics["stairwell"]`.
- Produces:
  ```python
  def step_apartment_hazards(s: ApartmentState, inp: ApartmentInputs, dt: float, p: dict) -> None
      # p = full physics dict; updates fire, smoke, co, co2 (fire share), temperature (fire heat), gas
  def ignite(s: ApartmentState, p: dict) -> None           # fire = max(fire, ignition_intensity), extinguishing False
  def spread_fire(states: dict[str, ApartmentState], adjacency: dict[str, list[str]],
                  dt: float, rng: random.Random, p: dict) -> list[str]   # newly ignited apartment ids
  @dataclass
  class StairwellState: temperature: float = 18.0; smoke: float = 0.0; light: float = 0.0
  def step_stairwell(s: StairwellState, apartments: list[ApartmentState], smoke_vent_open: bool,
                     lights_mode: str, outdoor: Outdoor, dt: float, p: dict) -> None
  ```
- Rules (spec §8.3–8.4): logistic growth `dI/dt = r·I·(1−I)` with `r = growth_per_min/60`, ×`oxygen_factor` if ventilation level > 0 (and powered) or window open; when `extinguishing`, `I` relaxes to 0 with `extinguish_tau_min`. Smoke: `smoke ← relax(smoke, smoke_max·I, 60 s)` then `smoke ← smoke·exp(−ACH·dt/3600)`; CO `+co_ppm_h·I`, CO₂ `+co2_ppm_h·I`, temperature `+heat_c_h·I` (per hour × dt/3600). Gas: `+gas_leak_rate` %LEL/min only while `gas_valve` open, removal by ACH. CO boiler: `+co_rate` ppm/h while `heating_active` or `showering > 0`, and gas valve open. Spread: for each apartment with `I > spread_threshold`, each adjacent non-burning apartment ignites with probability `1 − (1 − spread_prob_per_min)^(dt/60)`. Stairwell: temperature = mean of its apartments; smoke relaxes toward `stairwell_smoke_share·max(apartment smoke)` and additionally decays with `smoke_vent_tau_min` when the vent is open; light = `outdoor.light·light_factor + lux_per_mode[lights_mode]`.

- [ ] **Step 1: Write the failing tests**

```python
def run_fire(ventilation, minutes=10):
    s = ApartmentState(); ignite(s, P)
    for _ in range(minutes): step_apartment_hazards(s, inputs(ventilation=ventilation), 60, P)
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
    for _ in range(30): step_apartment_hazards(s, inputs(ventilation=0), 60, P)
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
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_physics_hazards.py` → FAIL
- [ ] **Step 3: Implement the hazard and stairwell functions in `simulator/physics.py`**
- [ ] **Step 4: Run to verify pass** (also re-run `tests/test_physics_air.py`) → PASS
- [ ] **Step 5: Commit** — `feat(simulator): fire, gas, CO hazards and stairwell`

---

### Task 7: Energy and consumptions

**Files:**
- Create: `simulator/energy.py`, `simulator/tests/test_energy.py`

**Interfaces:**
- Consumes: `ActuatorType` (Task 1), `ApartmentInputs`, `heating_active` (Task 5), `Car` (Task 4), `physics["apartment"]`, `physics["energy"]`.
- Produces:
  ```python
  def actuator_power(atype: ActuatorType, state: dict) -> float      # static power_w models; "dynamic" → 0
  @dataclass
  class Flows: power_w: float; water_l_min: float; gas_m3_h: float
  def apartment_flows(inp: ApartmentInputs, actuator_types: dict[str, ActuatorType], heating: bool,
                      cooling: bool, appliances_max: bool, p: dict) -> Flows
  def pv_power(peak_w: float, sun: float, cloudiness: float, p: dict) -> float
  @dataclass
  class BuildingState: battery_soc_pct: float = 50.0; battery_power_w: float = 0.0
                       pv_power_w: float = 0.0; grid_ok: bool = True
  def step_battery(b: BuildingState, mode: str, capacity_kwh: float, max_w: float,
                   essential_load_w: float, dt: float) -> bool    # returns True if essential loads are served
  def charger_power(mode: str, max_power_w: float, car: Car, grid_ok: bool) -> float
  ```
- Rules (spec §6.2, §8.3–8.4): `apartment_flows` — when `powered`, power = `base_w` + `cooking_w` if cooking (always if `appliances_max`) + Σ `actuator_power` of all apartment actuators (hvac counted with its current mode only while `heating` or `cooling` is True, otherwise with its `off` value); when not powered, only actuators with `essential: true`. Water = `shower_l_min·showering` + `kitchen_l_min` if cooking. Gas (0 if `gas_valve` closed) = `cooking_m3_h` if cooking + `heating_m3_h` if heating + `hot_water_m3_h` if showering > 0. PV = `peak·sun·(1 − pv_cloud_factor·cloudiness)`. Battery: `charge` → +max_w (only if `grid_ok`), `discharge` → −max_w, `idle` → 0; when `grid_ok` is False the battery always discharges at least `essential_load_w`; SoC clamped 0–100 and power set to 0 at the bounds; returns False when the grid is down and SoC is 0. Charger: `max_power_w` when `mode == "charge"`, grid ok, car connected and need > 0; otherwise 0 (the remaining need is decreased and floored at 0 by `EVFleet.step`).

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_energy.py` → FAIL
- [ ] **Step 3: Implement `simulator/energy.py`**
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): energy, battery and chargers`

---

### Task 8: Sensor devices and sensor faults

**Files:**
- Create: `simulator/devices.py`, `simulator/tests/test_sensors.py`

**Interfaces:**
- Consumes: `Device`, `SensorType` (Task 1), `physics["drift_rate_per_min"]`.
- Produces:
  ```python
  SENSOR_FAULTS = ("stuck", "drift", "offline")
  class SensorDevice:
      def __init__(self, device: Device, stype: SensorType, drift_rates: dict)
      device: Device; stype: SensorType
      fault: tuple[str, dict, float] | None           # (mode, params, started_real_ts)
      def set_fault(self, mode: str, params: dict, real_ts: float) -> None   # ValueError on unknown mode
      def clear_fault(self) -> None
      def read(self, true_value: float, rng: random.Random, real_ts: float) -> float | None
  ```
- Rules (spec §6.1, §8.6): pipeline true value → gaussian noise `noise` only if `rest_value is None` or `true_value > rest_value` → clamp to `valid_range` → fault. `stuck` returns the last value produced before the fault started; `drift` adds `rate·minutes_since_start` where rate = `params["drift_rate"]` or `drift_rate_per_min[type]` or `default_span_fraction·(max − min)` (drift is applied after clamping, so it can exceed the range); `offline` returns `None`.

- [ ] **Step 1: Write the failing tests**

```python
def test_rest_value_is_exact(sensor):
    assert sensor("smoke").read(0.0, RNG, 0) == 0.0

def test_noise_above_rest(sensor):
    vals = {sensor("co2").read(800, random.Random(i), 0) for i in range(5)}
    assert len(vals) > 1 and all(abs(v - 800) < 60 for v in vals)

def test_saturation(sensor):
    assert sensor("temperature").read(300, RNG, 0) == 150

def test_stuck_repeats_last_value(sensor):
    s = sensor("co2"); last = s.read(800, RNG, 0)
    s.set_fault("stuck", {}, 10)
    assert s.read(1200, RNG, 20) == last and s.read(400, RNG, 30) == last

def test_drift_grows_with_real_time(sensor):
    s = sensor("temperature", noise=0); s.set_fault("drift", {}, 0)
    assert s.read(20, RNG, 600) == pytest.approx(20 + 0.3 * 10)

def test_drift_can_exceed_range(sensor):
    s = sensor("humidity", noise=0); s.set_fault("drift", {"drift_rate": 10}, 0)
    assert s.read(95, RNG, 60) > 100

def test_offline_and_recovery(sensor):
    s = sensor("co2"); s.set_fault("offline", {}, 0)
    assert s.read(800, RNG, 10) is None
    s.clear_fault(); assert s.read(800, RNG, 20) is not None

def test_unknown_fault_mode(sensor):
    with pytest.raises(ValueError): sensor("co2").set_fault("melted", {}, 0)
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_sensors.py` → FAIL
- [ ] **Step 3: Implement `SensorDevice` in `simulator/devices.py`**
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): sensor devices with noise, saturation, faults`

---

### Task 9: Actuator devices, commands, acks, actuator faults

**Files:**
- Modify: `simulator/devices.py`
- Create: `simulator/tests/test_actuators.py`

**Interfaces:**
- Consumes: `Device`, `ActuatorType` (Task 1).
- Produces:
  ```python
  ACTUATOR_FAULTS = ("no_ack", "no_effect")
  def validate_command(atype: ActuatorType, command: object) -> str | None   # Italian reason or None
  class ActuatorDevice:
      def __init__(self, device: Device, atype: ActuatorType, default_override: dict | None = None)
      device: Device; atype: ActuatorType
      declared: dict            # state published on Complex/state
      effective: dict           # state used by physics
      fault: str | None
      def set_fault(self, mode: str) -> None     # ValueError on unknown mode
      def clear_fault(self) -> None              # effective := declared
      def apply_command(self, cmd_id: str | None, command: object, real_ts: float) -> dict | None
      def state_message(self, real_ts: float, sim_time: str, power_w: float) -> dict
  ```
- Rejection reasons (exact strings): `"comando non valido: atteso un oggetto JSON"`, `"comando vuoto"`, `"chiave sconosciuta: {key}"`, `"{key} {value:g} fuori da {min:g}–{max:g}"` (e.g. `setpoint 40 fuori da 16–30`), `"{key} deve essere intero"`, `"{key} '{value}' non ammesso (valori: {a, b, …})"`, `"{key} deve essere un testo"`, `"{key} deve essere true/false"`.
- Rules (spec §7.3–7.4, §8.6): a valid command merges its keys into `declared` (partial commands keep other keys); `resident_display` `{"clear": true}` sets `{"message": "", "level": "info"}`. Ack ok = `{"cmd_id", "status": "ok", "state": declared, "timestamp"}`; rejected = `{"cmd_id", "status": "rejected", "reason", "timestamp"}` and state unchanged. `no_ack` → return `None`, nothing changes. `no_effect` → ack ok and `declared` updated, `effective` unchanged. Without fault `effective` mirrors `declared`. `state_message` = `{"device_id", "state": declared, "power_w", "timestamp", "sim_time"}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_valid_command_updates_state(hvac):
    ack = hvac.apply_command("c1", {"mode": "cool", "setpoint": 24}, 100.0)
    assert ack == {"cmd_id": "c1", "status": "ok", "state": {"mode": "cool", "setpoint": 24}, "timestamp": 100.0}
    assert hvac.effective == {"mode": "cool", "setpoint": 24}

def test_partial_command_keeps_other_keys(hvac):
    hvac.apply_command("c1", {"setpoint": 23}, 0)
    assert hvac.declared == {"mode": "off", "setpoint": 23}

@pytest.mark.parametrize("command, reason", [
    ({"setpoint": 40}, "setpoint 40 fuori da 16–30"),
    ({"mode": "turbo"}, "mode 'turbo' non ammesso (valori: off, heat, cool)"),
    ({"speed": 3}, "chiave sconosciuta: speed"),
    ({}, "comando vuoto"),
    ([1, 2], "comando non valido: atteso un oggetto JSON"),
])
def test_rejections(hvac, command, reason):
    ack = hvac.apply_command("c2", command, 0)
    assert ack["status"] == "rejected" and ack["reason"] == reason
    assert hvac.declared == {"mode": "off", "setpoint": 21}

def test_integer_level(ventilation):
    assert ventilation.apply_command("c", {"level": 1.5}, 0)["reason"] == "level deve essere intero"

def test_display_clear(display):
    display.apply_command("c", {"message": "Evacuare", "level": "danger"}, 0)
    display.apply_command("c", {"clear": True}, 0)
    assert display.declared == {"message": "", "level": "info"}

def test_no_ack_fault(hvac):
    hvac.set_fault("no_ack")
    assert hvac.apply_command("c", {"mode": "cool"}, 0) is None
    assert hvac.declared["mode"] == "off"

def test_no_effect_fault(hvac):
    hvac.set_fault("no_effect")
    assert hvac.apply_command("c", {"mode": "cool"}, 0)["status"] == "ok"
    assert hvac.declared["mode"] == "cool" and hvac.effective["mode"] == "off"
    hvac.clear_fault(); assert hvac.effective["mode"] == "cool"

def test_state_message(hvac):
    assert hvac.state_message(5.0, "2026-09-30T21:15:00", 0.0) == {
        "device_id": "A-2-1.hvac", "state": {"mode": "off", "setpoint": 21},
        "power_w": 0.0, "timestamp": 5.0, "sim_time": "2026-09-30T21:15:00"}
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_actuators.py` → FAIL
- [ ] **Step 3: Implement `validate_command` and `ActuatorDevice` in `simulator/devices.py`**
- [ ] **Step 4: Run to verify pass** (also `tests/test_sensors.py`) → PASS
- [ ] **Step 5: Commit** — `feat(simulator): actuator commands, acks and faults`

---

### Task 10: Scenarios

**Files:**
- Create: `simulator/scenarios.py`, `simulator/tests/test_scenarios.py`

**Interfaces:**
- Consumes: `ComplexModel` (Task 1), `EnvEffects` (Task 3), `SENSOR_FAULTS`, `ACTUATOR_FAULTS` (Tasks 8–9).
- Produces:
  ```python
  class ScenarioError(Exception): ...
  SCENARIOS: dict[str, dict]   # name -> {"target": kind, "params": defaults}; kinds: "apartment", "complex",
                               # "complex_or_building", "sensor", "actuator"
  @dataclass
  class ActiveScenario: scenario_id: str; scenario: str; target: str; params: dict
                        started_at: float; sim_started_at: datetime
  @dataclass
  class Effects: env: EnvEffects; blackout: set[str]; forced: str | None; appliances_max: bool
                 gas_leaks: dict[str, float]; co_sources: dict[str, float]; burning: set[str]
  class ScenarioManager:
      def __init__(self, model: ComplexModel, rng: random.Random)
      active: list[ActiveScenario]
      def start(self, scenario: str, target: str, params: dict | None,
                real_ts: float, sim_now: datetime) -> ActiveScenario
      def stop(self, scenario_id: str) -> ActiveScenario
      def effects(self, sim_now: datetime) -> Effects
      def to_message(self) -> dict      # {"active": [...]} exactly as spec §7.3
  ```
- Rules (spec §9): 14 scenarios with the defaults of the spec table (`gas_leak.rate 2`, `co_poisoning.rate 30`, `earthquake.magnitude 5.8, duration_s 30`, `heatwave.delta 10, days 3`, `cold_wave.delta -10, days 3`, `pollution.factor 4`, `sensor_fault.mode` required ∈ `SENSOR_FAULTS`, `actuator_fault.mode` required ∈ `ACTUATOR_FAULTS`, `cascade.magnitude 5.8, gas_after_min 5, fire_after_min 10, targets` default = 2 apartments drawn with `rng` from different buildings and written back into `params`). IDs `sc-0001`, `sc-0002`, … Errors (Italian): `"scenario sconosciuto: {name}"`, `"target non valido per {scenario}: {target}"`, `"parametro non valido: {key}"`, `"scenario già attivo su questo target"`, `"scenario_id sconosciuto: {id}"`. Effects: earthquake magnitude while elapsed sim time < `duration_s`; heat/cold wave `temp_delta` summed while elapsed < `days`; `pollution` multiplies `pm_factor`; `storm`; `solar_surplus` → `clear_sky` and forced `"all_away"`; `power_peak` → forced `"all_home"` and `appliances_max` (`all_home` wins over `all_away`); `blackout` `complex` → `{"A","B","C","D"}` else `{building}`; `fire` → `burning`; `gas_leak`/`co_poisoning` → dicts; `cascade` → earthquake phase, then `gas_leaks` for its targets after `gas_after_min`, then `burning` `{targets[0]}` after `fire_after_min`. Sensor/actuator faults produce no `Effects`; the Simulation applies them on start/stop (Task 11).

- [ ] **Step 1: Write the failing tests**

```python
T0 = datetime(2026, 9, 30, 21, 0)

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
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_scenarios.py` → FAIL
- [ ] **Step 3: Implement `simulator/scenarios.py`**
- [ ] **Step 4: Run to verify pass** → PASS
- [ ] **Step 5: Commit** — `feat(simulator): scenario manager with 14 scenarios`

---

### Task 11: Simulation orchestrator (closed loop, without MQTT)

**Files:**
- Create: `simulator/simulation.py`, `simulator/tests/test_simulation.py`

**Interfaces:**
- Consumes: everything from Tasks 1–10 as declared in their Interfaces blocks.
- Produces:
  ```python
  class Simulation:
      def __init__(self, model: ComplexModel, start: datetime, seed: int | None = None)  # seed default: model.settings["seed"]
      model; clock: SimClock; env: Environment; occupancy: Occupancy; ev: EVFleet
      apartments: dict[str, ApartmentState]; stairwells: dict[str, StairwellState]
      buildings: dict[str, BuildingState]; sensors: dict[str, SensorDevice]
      actuators: dict[str, ActuatorDevice]; scenarios: ScenarioManager
      scenarios_changed: bool      # set on start/stop, cleared by the caller after publishing
      def step(self, real_dt: float) -> None
      def true_value(self, device_id: str) -> float
      def sample_readings(self, real_ts: float) -> list[dict]          # raw payloads, offline sensors omitted
      def actuator_states(self, real_ts: float, only_changed: bool) -> list[dict]
      def handle_command(self, device_id: str, payload: object, real_ts: float) -> dict | None
      def handle_scenario_control(self, payload: object, real_ts: float) -> ActiveScenario | None  # ScenarioError
      def handle_clock_control(self, payload: object) -> None           # ValueError
  ```
- Step order (one call of `step`): `dt = clock.advance(real_dt)` → `effects = scenarios.effects(now)` → ignite apartments in `effects.burning` not yet burning → `env.step(now, dt, effects.env, irrigation effective state on)` → evacuation set = apartments whose `alarm` effective `siren == "on"` ∪ all apartments of buildings whose `evacuation_siren` is on → `occupancy.step(now, dt, evacuate, effects.forced)` → `ev.step(now, dt, charger powers of previous step)` → per building: `grid_ok = building not in effects.blackout`, PV → per apartment: build `ApartmentInputs` (`powered = grid_ok`: without grid only `essential` actuators work, powered by the battery; `siren_on` = own alarm or building siren; leak/CO rates from effects) → `step_apartment_air`, `step_apartment_hazards`, `apartment_flows(…, heating_active(…), cooling_active(…), effects.appliances_max, p)` → `spread_fire` → stairwells → battery with essential load (sum of essential actuator power of the building) → charger powers. Latest flows/powers are cached for `true_value`.
- `true_value` mapping: apartment types from `ApartmentState` fields and cached `Flows` (`power`, `water_flow`, `gas_flow`), `occupancy` from `occupancy.home`; stairwell `temperature/smoke/light` from `StairwellState`, `occupancy` from `occupancy.transit`; `A.pv_power` from `BuildingState`; park types from `env.state`. Unknown id → `KeyError`.
- Reading payload = `{"device_id", "value", "unit", "timestamp", "sim_time"}` (spec §7.3). Actuator `power_w` in states: `actuator_power` for static types, `battery_power_w` for battery, charger power for ev_charger.
- `handle_command`: unknown `device_id` → `{"cmd_id": <payload cmd_id or None>, "status": "rejected", "reason": "dispositivo sconosciuto", "timestamp"}`; payload not a dict or without `command` → rejected with `"comando non valido: atteso un oggetto JSON"`; otherwise `ActuatorDevice.apply_command(payload.get("cmd_id"), payload["command"], real_ts)`.
- `handle_scenario_control`: payload `{"action": "start", "scenario", "target", "params"}` or `{"action": "stop", "scenario_id"}`; anything else → `ScenarioError("comando di controllo non valido")`. Start of `sensor_fault`/`actuator_fault` sets the device fault; stop clears it; stop of `fire`/`cascade` sets `extinguishing = True` on the fires it caused. Sets `scenarios_changed`.
- `handle_clock_control`: `{"speed": n}` → `set_speed`; `{"jump_to": s}` → `jump_to`; otherwise `ValueError`.

- [ ] **Step 1: Write the failing tests** (fixture `sim` = `Simulation(model, datetime(2026, 9, 30, 21, 15))`; helper `run(sim, real_seconds)` calls `step(1.0)` repeatedly)

```python
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
    for s in (a, b): s.apartments["A-2-1"].co2 = 1500
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
        if i in plan: s.handle_scenario_control({"action": "start", "scenario": plan[i][0], "target": plan[i][1]}, i)
        s.step(1.0)
        if i % 10 == 0:
            for r in s.sample_readings(i):
                lo, hi = model.sensor_types[r["device_id"].split(".")[1]].valid_range
                assert math.isfinite(r["value"]) and lo <= r["value"] <= hi, r
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_simulation.py` → FAIL
- [ ] **Step 3: Implement `simulator/simulation.py`**
- [ ] **Step 4: Run the whole suite** — `… pytest -q` → all PASS (the long-run test must finish in under 60 s; if not, profile before relaxing it)
- [ ] **Step 5: Commit** — `feat(simulator): simulation orchestrator with closed loop`

---

### Task 12: MQTT adapter, entry point, Docker, end-to-end check, docs

**Files:**
- Create: `simulator/mqtt_io.py`, `simulator/main.py`, `simulator/tests/test_mqtt_io.py`, `scripts/e2e_simulator.py`
- Modify: `docker-compose.yml` (add service), `docs/MONITOR.md`

**Interfaces:**
- Consumes: `Simulation` (Task 11), `ScenarioError` (Task 10).
- Produces:
  ```python
  ROOT = "Complex"
  def device_topic(layer: str, area: str, unit_id: str, device_type: str) -> str
  def parse_device_topic(topic: str) -> tuple[str, str, str, str]   # (layer, area, unit_id, type); ValueError
  class SimulatorService:
      def __init__(self, sim: Simulation, client, settings: dict)   # settings = model.settings
      def on_connect(self, client, userdata, flags, reason_code, properties) -> None
      def on_message(self, client, userdata, msg) -> None           # never raises
      def tick(self, real_ts: float) -> None                        # called every physics_step_s
      def publish_scenarios(self) -> None
  ```
- Behaviour (spec §7.2, §12): `on_connect` subscribes `Complex/cmd/#` (qos 1) and `Complex/control/#` (qos 1), then publishes retained qos 1: `Complex/status/simulator` = `online`, `Complex/model`, `Complex/clock`, every actuator state, `Complex/scenarios`. `on_message`: `Complex/cmd/<area>/<unit>/<type>` → `sim.handle_command(f"{unit}.{type}", json, ts)`; publish the ack (if not `None`) on `Complex/ack/<area>/<unit>/<type>` qos 1, then any changed states; `Complex/control/scenario` → `handle_scenario_control` then `publish_scenarios`; `Complex/control/clock` → `handle_clock_control` then publish clock; JSON decode errors, `ScenarioError`, `ValueError` are logged and swallowed. `tick`: `sim.step(physics_step_s)`; clock every second; readings (qos 0, not retained) whenever `real_ts` crosses a multiple of `sampling_period_s`; changed actuator states every tick; all actuator states every `actuator_state_period_s`; scenarios when `sim.scenarios_changed`.
- `main.py`: load model from `CONFIG_PATH`; `Simulation(model, datetime.now().replace(microsecond=0))`; client `mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="simulator")`, `username_pw_set` from `MQTT_USERNAME`/`MQTT_PASSWORD`, `will_set("Complex/status/simulator", "offline", qos=1, retain=True)`, `reconnect_delay_set(1, 30)`, `connect_async(MQTT_BROKER, MQTT_PORT)`, `loop_start()`; publish `{"active": []}` retained on `Complex/scenarios` at startup (spec §12: clean restart); loop with `time.monotonic()` calling `service.tick(time.time())` every `physics_step_s`. Invalid config → print the `ConfigError` and `sys.exit(1)`.

- [ ] **Step 1: Write the failing tests** (`FakeClient` records `publish(topic, payload, qos, retain)` and `subscribe` calls; `FakeMsg(topic, payload)`)

```python
def test_device_topic_roundtrip():
    t = device_topic("raw", "A", "A-2-1", "co2")
    assert t == "Complex/raw/A/A-2-1/co2"
    assert parse_device_topic(t) == ("raw", "A", "A-2-1", "co2")
    with pytest.raises(ValueError): parse_device_topic("City/data/x")

def test_on_connect_subscribes_and_publishes_retained(service, client):
    service.on_connect(client, None, None, 0, None)
    assert {s[0] for s in client.subscriptions} == {"Complex/cmd/#", "Complex/control/#"}
    retained = {p.topic for p in client.published if p.retain}
    assert {"Complex/status/simulator", "Complex/model", "Complex/clock", "Complex/scenarios"} <= retained
    assert len([t for t in retained if t.startswith("Complex/state/")]) == 283

def test_on_connect_republishes_after_reconnect(service, client):
    service.on_connect(client, None, None, 0, None); n = len(client.published)
    service.on_connect(client, None, None, 0, None)
    assert len(client.published) == 2 * n

def test_command_publishes_ack_and_state(service, client):
    service.on_message(client, None, FakeMsg("Complex/cmd/A/A-2-1/window",
                       json.dumps({"cmd_id": "c1", "command": {"position": "open"}})))
    topics = [p.topic for p in client.published]
    assert "Complex/ack/A/A-2-1/window" in topics and "Complex/state/A/A-2-1/window" in topics

@pytest.mark.parametrize("topic, payload", [
    ("Complex/cmd/A/A-2-1/hvac", b"\xff\xfe"), ("Complex/cmd/bad", b"{}"),
    ("Complex/control/scenario", b"[1,2]"), ("Complex/control/clock", b'{"speed": 0}'),
    ("Complex/control/unknown", b"{}"),
])
def test_on_message_garbage_does_not_raise(service, client, topic, payload):
    service.on_message(client, None, FakeMsg(topic, payload))   # must not raise

def test_tick_publishes_readings_on_sampling_boundary(service, client):
    for ts in range(100, 111): service.tick(float(ts))
    raw = [p for p in client.published if p.topic.startswith("Complex/raw/")]
    assert len(raw) in (414, 828) and all(p.qos == 0 and not p.retain for p in raw)

def test_scenario_control_publishes_scenarios(service, client):
    service.on_message(client, None, FakeMsg("Complex/control/scenario",
                       json.dumps({"action": "start", "scenario": "storm", "target": "complex"})))
    last = [p for p in client.published if p.topic == "Complex/scenarios"][-1]
    assert last.retain and json.loads(last.payload)["active"][0]["scenario"] == "storm"
```

- [ ] **Step 2: Run to verify failure** — `… pytest -q tests/test_mqtt_io.py` → FAIL
- [ ] **Step 3: Implement `simulator/mqtt_io.py` and `simulator/main.py`**
- [ ] **Step 4: Run the whole suite** — `… pytest -q` → all PASS
- [ ] **Step 5: Add the service to `docker-compose.yml`**

```yaml
  simulator:
    build: ./simulator
    container_name: iot_simulator
    depends_on:
      - mosquitto
    environment:
      - MQTT_BROKER=${MQTT_BROKER}
      - MQTT_PORT=${MQTT_PORT}
      - MQTT_USERNAME=${MQTT_USERNAME}
      - MQTT_PASSWORD=${MQTT_PASSWORD}
      - CONFIG_PATH=/app/config/complex.json
    volumes:
      - ./config/complex.json:/app/config/complex.json:ro
    restart: unless-stopped
    networks:
      - iot_net
```

- [ ] **Step 6: Write `scripts/e2e_simulator.py`**

Standalone paho script (host side, `localhost:1883`, credentials from env `MQTT_USERNAME`/`MQTT_PASSWORD`, default `admin`/`adminpassword123`). Checks, each printed as `PASS`/`FAIL`, exit code 1 on any failure:
1. `Complex/status/simulator` == `online` within 10 s;
2. at least 414 distinct `device_id`s on `Complex/raw/#` within 12 s;
3. `Complex/control/clock` `{"speed": 60}` → `Complex/clock` shows speed 60;
4. `Complex/cmd/A/A-2-1/window` `{"position": "open"}` → ack `ok` within 3 s;
5. `Complex/cmd/A/A-2-1/hvac` `{"setpoint": 40}` → ack `rejected` with reason `setpoint 40 fuori da 16–30`;
6. start `actuator_fault` `no_ack` on `A-2-1.lights` → a lights command gets no ack within 3 s;
7. start `fire` on `A-2-1` → a `Complex/raw/A/A-2-1/smoke` value > 1 within 60 s;
8. cleanup: stop all started scenarios, clock back to `{"speed": 1}`.

- [ ] **Step 7: Run end-to-end against the stack**

```bash
docker compose up -d --build mosquitto simulator
uv run --no-project --python 3.11 --with 'paho-mqtt>=2,<3' python scripts/e2e_simulator.py
```
Expected: 8 × `PASS`, exit code 0. (Node-RED is not involved: the simulator publishes only on `Complex/…`, so no Telegram messages are sent.)

- [ ] **Step 8: Update `docs/MONITOR.md`**

Section 4.4: tappe 1 and 2 → ✅. Requirements R1–R7 → ✅. Section 0: mark `config/complex.json`, `Complex/model`, device catalogue, topics `raw/state/cmd/ack/clock/control/scenarios` and `simulator/` as available now. Add a short "Come avviare e provare il simulatore" block with the two commands of Step 7 and an example `mosquitto_pub` command:
```bash
docker exec iot_mosquitto mosquitto_pub -u admin -P adminpassword123 -t Complex/control/scenario -m '{"action":"start","scenario":"fire","target":"A-2-1"}'
```
Storico: `2026-MM-DD | Tappe 1–2 completate: simulatore del complesso con ciclo chiuso (comandi, ack, scenari, guasti)`.

- [ ] **Step 9: Commit**

```bash
git add simulator/ scripts/e2e_simulator.py docker-compose.yml docs/MONITOR.md
git commit -m "feat(simulator): MQTT service, docker and end-to-end check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
