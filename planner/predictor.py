"""Predictive environmental transition model and utility-based planner (Tier 2).

Implements:
1. `predict_breach_probability`: Linear trend Gaussian tail breach estimator.
2. `SurrogateTransitionModel`: Learns state transitions s_{t+dt} = f(s_t, a, weather_t)
   for indoor temperature, humidity, and CO2 from historical InfluxDB records and
   real-time MQTT streams using prior-regularized Ridge/RLS regression.
3. `UtilityPlanner`: Evaluates candidate adaptation plans A using the Multi-Attribute
   Utility Function:
       U(a) = w_comfort * ComfortScore(s_hat) - w_energy * (Power(a) / Power_max) - w_wear * DeltaActuator(a)
   and selects the optimal action plan a* = argmax_{a in A} U(a).
"""
from __future__ import annotations

import copy
import logging
import math
import time
from datetime import datetime
from math import erf, sqrt
import numpy as np

logger = logging.getLogger("planner.predictor")


def predict_breach_probability(samples, horizon_seconds, threshold):
    """Estimate probability that sensor value will exceed `threshold` within `horizon_seconds`.

    samples: list of {'value': float, 'timestamp': int}
    Returns: probability in [0,1]
    """
    if not samples:
        return 0.0

    if len(samples) < 3:
        last = samples[-1]['value']
        return 1.0 if last > threshold else 0.0

    ts = np.array([s['timestamp'] for s in samples], dtype=float)
    vals = np.array([s['value'] for s in samples], dtype=float)

    t0 = ts[0]
    t_rel = ts - t0

    try:
        a, b = np.polyfit(t_rel, vals, 1)
    except Exception:
        last = vals[-1]
        return 1.0 if last > threshold else 0.0

    now = time.time()
    t_pred = now - t0 + horizon_seconds
    pred = a * t_pred + b

    fitted = a * t_rel + b
    resid = vals - fitted
    sigma = np.std(resid, ddof=1)

    if sigma <= 0:
        return 1.0 if pred > threshold else 0.0

    z = (threshold - pred) / sigma
    cdf = 0.5 * (1 + erf(z / sqrt(2)))
    prob = max(0.0, min(1.0, 1.0 - cdf))
    return float(prob)


def _psat_hpa(t_c: float) -> float:
    """Saturation vapour pressure (Magnus formula)."""
    t_c = min(max(float(t_c), -40.0), 150.0)
    return 6.112 * math.exp(17.62 * t_c / (243.12 + t_c))


def _parse_sim_time(sim_time_str):
    """Parse ISO sim_time string into epoch-like seconds, or None if unavailable."""
    if not sim_time_str or not isinstance(sim_time_str, str):
        return None
    try:
        dt = datetime.fromisoformat(sim_time_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return None


DEFAULT_ACTUATORS = {
    "hvac": {"mode": "off", "setpoint": 22},
    "ventilation": {"level": 1},
    "window": {"position": "closed"},
    "blinds": {"position": 100},
    "lights": {"level": 0},
}

DEFAULT_WEATHER = {
    "temperature": 18.0,
    "humidity": 55.0,
    "light": 20000.0,
    "noise_level": 50.0,
    "rain_level": 0.0,
    "wind_speed": 5.0,
    "pm10": 15.0,
    "pm2_5": 8.0,
    "co2_outdoor": 420.0,
}


def normalize_actuators(raw_actuators: dict | None) -> dict:
    """Normalize an actuator state dictionary into canonical structure."""
    norm = copy.deepcopy(DEFAULT_ACTUATORS)
    if not raw_actuators:
        return norm
    for dev, default_st in DEFAULT_ACTUATORS.items():
        if dev in raw_actuators and isinstance(raw_actuators[dev], dict):
            entry = raw_actuators[dev]
            state_sub = entry.get("state") if isinstance(entry.get("state"), dict) else entry
            for k, v in default_st.items():
                if k in state_sub and state_sub[k] is not None:
                    norm[dev][k] = state_sub[k]
            if dev == "window":
                if "position_str" in state_sub and state_sub["position_str"] in ("open", "closed"):
                    norm["window"]["position"] = state_sub["position_str"]
                elif isinstance(norm["window"]["position"], (int, float)):
                    norm["window"]["position"] = "open" if norm["window"]["position"] > 0 else "closed"
    return norm


class SurrogateTransitionModel:
    """Learns environmental state transition rates (dT/dt, dCO2/dt, dHum/dt) per hour.

    Uses Prior-Regularized Ridge / Recursive Least Squares (RLS):
        theta = (X^T X + lambda * I)^{-1} (X^T y + lambda * theta_0)
    so the model has physically sound predictions from the first second (cold start)
    and continuously adapts its parameters theta_T, theta_C, theta_H from both
    historical InfluxDB time-series and real-time MQTT transitions.
    """

    def __init__(self, ridge_lambda: float = 5.0, forgetting_factor: float = 0.995):
        self.ridge_lambda = float(ridge_lambda)
        self.forgetting_factor = float(forgetting_factor)

        # Prior parameters theta_0 (rates per simulated hour):
        # Temperature features (7):
        # [0] (T_out - T_in)                  -> ~ 1 / tau_env (0.167 h^-1 for medium insulation)
        # [1] I(window=open) * (T_out - T_in) -> ~ 1 / tau_win (3.0 h^-1 for 20 min window tau)
        # [2] occupancy                       -> ~ +0.15 C/h per person
        # [3] sun_factor * (blinds / 100)     -> ~ +1.0 C/h solar gain
        # [4] I(hvac=heat & T < setpoint)     -> ~ +3.5 C/h gross heating capacity (~2 C/h net)
        # [5] I(hvac=cool & T > setpoint)     -> ~ -3.5 C/h gross cooling capacity (~-2 C/h net)
        # [6] bias                            -> 0.0 C/h
        self.theta0_T = np.array([0.167, 3.0, 0.15, 1.0, 3.5, -3.5, 0.0], dtype=float)

        # CO2 features (5):
        # [0] occupancy                       -> ~ +92.6 ppm/h per person
        # [1] (CO2_out - CO2_in)              -> ~ 0.3 h^-1 base infiltration
        # [2] vmc_level * (CO2_out - CO2_in)  -> ~ 0.5 h^-1 per VMC level
        # [3] I(window=open) * (CO2_out-CO2)  -> ~ 4.0 h^-1 open window ACH
        # [4] bias                            -> 0.0 ppm/h
        self.theta0_C = np.array([92.6, 0.3, 0.5, 4.0, 0.0], dtype=float)

        # Humidity features (6):
        # [0] occupancy                       -> ~ +2.0 %/h per person
        # [1] (H_out_eq - H_in)               -> ~ 0.3 h^-1 base infiltration
        # [2] vmc_level * (H_out_eq - H_in)   -> ~ 0.5 h^-1 per VMC level
        # [3] I(window=open) * (H_out_eq-H)   -> ~ 4.0 h^-1 open window ACH
        # [4] I(hvac=cool & T > setpoint)     -> ~ -3.0 %/h cooling dehumidification
        # [5] bias                            -> 0.0 %/h
        self.theta0_H = np.array([2.0, 0.3, 0.5, 4.0, -3.0, 0.0], dtype=float)

        self.theta_T = self.theta0_T.copy()
        self.theta_C = self.theta0_C.copy()
        self.theta_H = self.theta0_H.copy()

        # Sufficient statistics A = X^T X, b = X^T y
        self.A_T = np.zeros((len(self.theta0_T), len(self.theta0_T)), dtype=float)
        self.b_T = np.zeros(len(self.theta0_T), dtype=float)

        self.A_C = np.zeros((len(self.theta0_C), len(self.theta0_C)), dtype=float)
        self.b_C = np.zeros(len(self.theta0_C), dtype=float)

        self.A_H = np.zeros((len(self.theta0_H), len(self.theta0_H)), dtype=float)
        self.b_H = np.zeros(len(self.theta0_H), dtype=float)

        self.n_updates = 0
        self.last_influx_train_ts = 0.0

    def features_temp(self, state: dict, action: dict, weather: dict) -> np.ndarray:
        t_in = float(state.get("temperature", 21.0))
        t_out = float(weather.get("temperature", 18.0))
        occ = float(state.get("occupancy", 1.0))
        out_light = float(weather.get("light", 10000.0))
        sun = min(1.0, max(0.0, out_light / 100000.0))

        act = normalize_actuators(action)
        win_open = 1.0 if act["window"]["position"] == "open" else 0.0
        blinds_frac = float(act["blinds"]["position"]) / 100.0
        hvac_mode = act["hvac"]["mode"]
        setpoint = float(act["hvac"]["setpoint"])

        heat_on = 1.0 if (hvac_mode == "heat" and t_in < setpoint - 0.5) else 0.0
        cool_on = 1.0 if (hvac_mode == "cool" and t_in > setpoint + 0.5) else 0.0

        dt_out = t_out - t_in
        return np.array([
            dt_out,
            win_open * dt_out,
            occ,
            sun * blinds_frac,
            heat_on,
            cool_on,
            1.0,
        ], dtype=float)

    def features_co2(self, state: dict, action: dict, weather: dict) -> np.ndarray:
        c_in = float(state.get("co2", 500.0))
        c_out = float(weather.get("co2_outdoor", 420.0))
        occ = float(state.get("occupancy", 1.0))

        act = normalize_actuators(action)
        vmc_level = float(act["ventilation"]["level"])
        win_open = 1.0 if act["window"]["position"] == "open" else 0.0

        dc_out = c_out - c_in
        return np.array([
            occ,
            dc_out,
            vmc_level * dc_out,
            win_open * dc_out,
            1.0,
        ], dtype=float)

    def features_humidity(self, state: dict, action: dict, weather: dict) -> np.ndarray:
        t_in = float(state.get("temperature", 21.0))
        h_in = float(state.get("humidity", 50.0))
        t_out = float(weather.get("temperature", 18.0))
        h_out = float(weather.get("humidity", 55.0))
        occ = float(state.get("occupancy", 1.0))

        act = normalize_actuators(action)
        vmc_level = float(act["ventilation"]["level"])
        win_open = 1.0 if act["window"]["position"] == "open" else 0.0
        hvac_mode = act["hvac"]["mode"]
        setpoint = float(act["hvac"]["setpoint"])
        cool_on = 1.0 if (hvac_mode == "cool" and t_in > setpoint + 0.5) else 0.0

        # Outdoor relative humidity rescaled to indoor saturation pressure (Magnus)
        h_out_eq = min(100.0, max(0.0, h_out * _psat_hpa(t_out) / max(1e-3, _psat_hpa(t_in))))
        dh_out = h_out_eq - h_in
        return np.array([
            occ,
            dh_out,
            vmc_level * dh_out,
            win_open * dh_out,
            cool_on,
            1.0,
        ], dtype=float)

    def _solve_ridge(self, A: np.ndarray, b: np.ndarray, theta0: np.ndarray) -> np.ndarray:
        reg = self.ridge_lambda * np.eye(len(theta0))
        try:
            theta = np.linalg.solve(A + reg, b + self.ridge_lambda * theta0)
        except np.linalg.LinAlgError:
            theta = theta0.copy()
        return theta

    def _clamp_parameters(self) -> None:
        """Keep learned physical parameters within physically sound sign/magnitude bounds."""
        # Temperature bounds: conduction>0, window>0, occ>=0, solar>=0, heat>0, cool<0
        self.theta_T[0] = np.clip(self.theta_T[0], 0.08, 0.45)
        self.theta_T[1] = np.clip(self.theta_T[1], 1.5, 5.0)
        self.theta_T[2] = np.clip(self.theta_T[2], 0.05, 0.35)
        self.theta_T[3] = np.clip(self.theta_T[3], 0.2, 2.0)
        self.theta_T[4] = np.clip(self.theta_T[4], 1.8, 5.5)
        self.theta_T[5] = np.clip(self.theta_T[5], -5.5, -1.8)
        self.theta_T[6] = np.clip(self.theta_T[6], -0.25, 0.25)

        # CO2 bounds: occ>=0, infil>0, vmc>0, window>0
        self.theta_C[0] = np.clip(self.theta_C[0], 40.0, 160.0)
        self.theta_C[1] = np.clip(self.theta_C[1], 0.1, 0.8)
        self.theta_C[2] = np.clip(self.theta_C[2], 0.2, 1.2)
        self.theta_C[3] = np.clip(self.theta_C[3], 2.0, 6.5)
        self.theta_C[4] = np.clip(self.theta_C[4], -15.0, 15.0)

        # Humidity bounds: occ>=0, infil>0, vmc>0, window>0, cool_dry<=0
        self.theta_H[0] = np.clip(self.theta_H[0], 0.5, 5.0)
        self.theta_H[1] = np.clip(self.theta_H[1], 0.1, 0.8)
        self.theta_H[2] = np.clip(self.theta_H[2], 0.2, 1.2)
        self.theta_H[3] = np.clip(self.theta_H[3], 2.0, 6.5)
        self.theta_H[4] = np.clip(self.theta_H[4], -6.0, -1.0)
        self.theta_H[5] = np.clip(self.theta_H[5], -2.0, 2.0)

    def observe_transition(self, prev_state: dict, action: dict, weather: dict,
                           curr_state: dict, dt_seconds: float) -> bool:
        """Online update from a single observed transition (s_t, a_t, w_t) -> s_{t+dt}.

        Weights each sample by w = min(1.0, (dt_h / 0.25)^2) (inverse-variance weighting
        for finite-difference rate observations y = ds / dt_h where sensor noise on ds
        has constant variance).
        """
        if dt_seconds is None or dt_seconds <= 0.5 or dt_seconds > 7200.0:
            return False

        dt_h = dt_seconds / 3600.0
        # Reference horizon 0.25 h (15 min): prevents finite-difference sensor noise
        # amplification on short 10s-30s intervals at clock_speed=1.
        w_sample = min(1.0, (dt_h / 0.25) ** 2)
        updated = False
        gamma = self.forgetting_factor

        if "temperature" in prev_state and "temperature" in curr_state:
            rate_t = (float(curr_state["temperature"]) - float(prev_state["temperature"])) / dt_h
            if abs(rate_t) < 30.0:  # Ignore fire/fault outliers during normal physics learning
                phi_t = self.features_temp(prev_state, action, weather)
                self.A_T = gamma * self.A_T + w_sample * np.outer(phi_t, phi_t)
                self.b_T = gamma * self.b_T + w_sample * phi_t * rate_t
                self.theta_T = self._solve_ridge(self.A_T, self.b_T, self.theta0_T)
                updated = True

        if "co2" in prev_state and "co2" in curr_state:
            rate_c = (float(curr_state["co2"]) - float(prev_state["co2"])) / dt_h
            if abs(rate_c) < 3000.0:
                phi_c = self.features_co2(prev_state, action, weather)
                self.A_C = gamma * self.A_C + w_sample * np.outer(phi_c, phi_c)
                self.b_C = gamma * self.b_C + w_sample * phi_c * rate_c
                self.theta_C = self._solve_ridge(self.A_C, self.b_C, self.theta0_C)
                updated = True

        if "humidity" in prev_state and "humidity" in curr_state:
            rate_h = (float(curr_state["humidity"]) - float(prev_state["humidity"])) / dt_h
            if abs(rate_h) < 60.0:
                phi_h = self.features_humidity(prev_state, action, weather)
                self.A_H = gamma * self.A_H + w_sample * np.outer(phi_h, phi_h)
                self.b_H = gamma * self.b_H + w_sample * phi_h * rate_h
                self.theta_H = self._solve_ridge(self.A_H, self.b_H, self.theta0_H)
                updated = True

        if updated:
            self._clamp_parameters()
            self.n_updates += 1
        return updated

    def predict_next_state(self, state: dict, action: dict, weather: dict,
                           horizon_s: float = 1800.0) -> dict:
        """Predict indoor environmental state at t + horizon_s under candidate action `action`.

        Integrates the learned surrogate model in 2-minute (120 s) substeps so that
        fast processes (like opening a window, tau=20 min) relax smoothly toward
        physical equilibrium without Euler overshoot.
        """
        cur = {
            "temperature": float(state.get("temperature", 21.0)),
            "humidity": float(state.get("humidity", 50.0)),
            "co2": float(state.get("co2", 500.0)),
            "occupancy": float(state.get("occupancy", 1.0)),
        }
        w = {**DEFAULT_WEATHER, **(weather or {})}
        act = normalize_actuators(action)

        rem_s = max(0.0, float(horizon_s))
        substep_s = 120.0  # 2-minute substeps for accurate exponential relaxation

        hvac_mode = act["hvac"]["mode"]
        setpoint = float(act["hvac"]["setpoint"])
        initial_temp = cur["temperature"]

        while rem_s > 1e-6:
            step_s = min(substep_s, rem_s)
            dt_h = step_s / 3600.0
            rem_s -= step_s

            phi_t = self.features_temp(cur, act, w)
            d_temp = float(np.dot(self.theta_T, phi_t)) * dt_h
            next_temp = cur["temperature"] + d_temp
            # HVAC thermostat deadband clamp so active heating/cooling holds at setpoint band
            if hvac_mode == "heat":
                target_heat = setpoint - 0.5
                if initial_temp < setpoint and cur["temperature"] <= target_heat and next_temp > target_heat:
                    next_temp = min(setpoint, next_temp)
                elif cur["temperature"] >= target_heat and next_temp < target_heat:
                    next_temp = target_heat
            elif hvac_mode == "cool":
                target_cool = setpoint + 0.5
                if initial_temp > setpoint and cur["temperature"] >= target_cool and next_temp < target_cool:
                    next_temp = max(setpoint, next_temp)
                elif cur["temperature"] <= target_cool and next_temp > target_cool:
                    next_temp = target_cool

            phi_c = self.features_co2(cur, act, w)
            d_co2 = float(np.dot(self.theta_C, phi_c)) * dt_h
            next_co2 = max(400.0, min(5000.0, cur["co2"] + d_co2))

            phi_h = self.features_humidity(cur, act, w)
            d_hum = float(np.dot(self.theta_H, phi_h)) * dt_h
            next_hum = max(0.0, min(100.0, cur["humidity"] + d_hum))

            cur["temperature"] = next_temp
            cur["co2"] = next_co2
            cur["humidity"] = next_hum

        # Predict secondary indoor comfort variables (light & noise)
        blinds_frac = float(act["blinds"]["position"]) / 100.0
        lights_level = float(act["lights"]["level"])
        out_light = float(w.get("light", 10000.0))
        pred_light = out_light * 0.02 * blinds_frac + lights_level * 5.0

        win_open = act["window"]["position"] == "open"
        out_noise = float(w.get("noise_level", 50.0))
        attenuation = 10.0 if win_open else 30.0
        occ_count = int(round(cur["occupancy"]))
        noise_sources = [30.0, out_noise - attenuation] + ([50.0] * max(0, occ_count))
        pred_noise = 10.0 * math.log10(sum(10.0 ** (db / 10.0) for db in noise_sources))

        return {
            "temperature": round(cur["temperature"], 3),
            "humidity": round(cur["humidity"], 3),
            "co2": round(cur["co2"], 2),
            "light": round(pred_light, 1),
            "noise_level": round(pred_noise, 2),
            "occupancy": cur["occupancy"],
        }

    def fit_from_influxdb(self, influx_client, bucket: str, org: str,
                          window: str = "-2h", clock_speed: float = 1.0) -> int:
        """Query historical sensor readings and actuator states from InfluxDB and update model weights.

        Returns the number of historical transition samples assimilated.
        """
        if influx_client is None:
            return 0

        try:
            query_api = influx_client.query_api()
            flux_readings = f'''
from(bucket: "{bucket}")
  |> range(start: {window})
  |> filter(fn: (r) => r._measurement == "readings" and r._field == "value")
  |> filter(fn: (r) => r.type == "temperature" or r.type == "humidity" or r.type == "co2" or r.type == "occupancy" or r.type == "light")
  |> aggregateWindow(every: 30s, fn: last, createEmpty: false)
'''
            tables = query_api.query(flux_readings, org=org)
        except Exception as exc:
            logger.warning(f"InfluxDB historical query failed: {exc}")
            return 0

        # Group by unit_id -> timestamp_bucket -> {type: value}
        series_by_unit: dict[str, dict[int, dict]] = {}
        for table in tables:
            for record in table.records:
                unit_id = record.values.get("unit_id")
                typ = record.values.get("type")
                val = record.get_value()
                ts = record.get_time()
                if not unit_id or not typ or val is None or ts is None:
                    continue
                epoch_bucket = int(ts.timestamp()) // 30 * 30
                series_by_unit.setdefault(unit_id, {}).setdefault(epoch_bucket, {})[typ] = float(val)

        # Also query actuator states if present
        act_by_unit: dict[str, dict[int, dict]] = {}
        try:
            flux_act = f'''
from(bucket: "{bucket}")
  |> range(start: {window})
  |> filter(fn: (r) => r._measurement == "actuator_states")
  |> aggregateWindow(every: 30s, fn: last, createEmpty: false)
'''
            act_tables = query_api.query(flux_act, org=org)
            for table in act_tables:
                for record in table.records:
                    unit_id = record.values.get("unit_id")
                    typ = record.values.get("type")
                    field_name = record.get_field()
                    val = record.get_value()
                    ts = record.get_time()
                    if not unit_id or not typ or not field_name or val is None or ts is None:
                        continue
                    epoch_bucket = int(ts.timestamp()) // 30 * 30
                    u_dict = act_by_unit.setdefault(unit_id, {}).setdefault(epoch_bucket, {})
                    u_dict.setdefault(typ, {})[field_name] = val
        except Exception as exc:
            logger.debug(f"Optional actuator_states query skipped: {exc}")

        park_series = series_by_unit.get("park", {})
        samples_used = 0
        eff_speed = max(1.0, float(clock_speed))

        for unit_id, time_map in series_by_unit.items():
            if unit_id in ("park", "complex") or unit_id.endswith("-S") or len(unit_id.split("-")) < 3:
                continue
            sorted_ts = sorted(time_map.keys())
            if len(sorted_ts) < 2:
                continue

            cur_act = copy.deepcopy(DEFAULT_ACTUATORS)
            unit_acts = act_by_unit.get(unit_id, {})
            sorted_act_ts = sorted(unit_acts.keys())
            act_idx = 0

            for i in range(len(sorted_ts) - 1):
                t0, t1 = sorted_ts[i], sorted_ts[i + 1]
                real_dt = t1 - t0
                if real_dt <= 0 or real_dt > 300:
                    continue
                while act_idx < len(sorted_act_ts) and sorted_act_ts[act_idx] <= t0:
                    cur_act = normalize_actuators({**cur_act, **unit_acts[sorted_act_ts[act_idx]]})
                    act_idx += 1

                s0 = time_map[t0]
                s1 = time_map[t1]
                w0 = {**DEFAULT_WEATHER, **park_series.get(t0, {})}
                sim_dt = real_dt * eff_speed
                if self.observe_transition(s0, cur_act, w0, s1, sim_dt):
                    samples_used += 1

        self.last_influx_train_ts = time.time()
        if samples_used > 0:
            logger.info(f"Trained SurrogateTransitionModel on {samples_used} historical transitions from InfluxDB")
        return samples_used


def build_candidate_plans(current_actuators: dict | None = None) -> list[dict]:
    """Generate the discrete candidate adaptation plan set A for an apartment."""
    cur = normalize_actuators(current_actuators)
    cur_lights = cur["lights"]["level"]

    def plan(name: str, hvac_mode: str, setpoint: int, vmc: int, window: str, blinds: int) -> dict:
        return {
            "name": name,
            "actuators": {
                "hvac": {"mode": hvac_mode, "setpoint": setpoint},
                "ventilation": {"level": vmc},
                "window": {"position": window},
                "blinds": {"position": blinds},
                "lights": {"level": cur_lights},
            },
        }

    candidates = [
        {
            "name": "keep_current",
            "actuators": copy.deepcopy(cur),
        },
        plan("eco_idle", "off", 22, 1, "closed", 100),
        plan("unoccupied_eco", "off", 22, 0, "closed", 50),
        plan("passive_cooling", "off", 22, 1, "open", 50),
        plan("natural_air_flush", "off", 22, 2, "open", 100),
        plan("solar_shading", "off", 22, 1, "closed", 20),
        plan("active_cooling", "cool", 22, 1, "closed", 30),
        plan("active_cooling_vent", "cool", 22, 3, "closed", 30),
        plan("active_heating", "heat", 23, 1, "closed", 100),
        plan("active_heating_vent", "heat", 23, 3, "closed", 100),
        plan("ventilation_boost", "off", 22, 3, "closed", 100),
        plan("weather_shield", "off", 22, 0, "closed", 10),
    ]
    return candidates


def compute_comfort_score(pred_state: dict, action: dict, weather: dict | None = None) -> tuple[float, dict]:
    """Compute normalized ComfortScore(s_hat) in [0, 1] and component details."""
    w = {**DEFAULT_WEATHER, **(weather or {})}
    act = normalize_actuators(action)

    temp = float(pred_state.get("temperature", 22.5))
    hum = float(pred_state.get("humidity", 50.0))
    co2 = float(pred_state.get("co2", 500.0))
    noise = float(pred_state.get("noise_level", 35.0))
    light = float(pred_state.get("light", 300.0))

    # 1. Thermal comfort in [0, 1]: ideal 22.5 C, quadratic penalty outside [21.5, 23.5] C
    temp_diff = abs(temp - 22.5)
    if temp_diff <= 1.0:
        temp_score = 1.0 - temp_diff * 0.04
    else:
        excess = temp_diff - 1.0
        temp_score = max(0.0, 0.96 - excess * 0.12 - (excess ** 2) * 0.012)

    hum_score = max(0.0, 1.0 - abs(hum - 50.0) * 0.015)
    thermal = 0.85 * temp_score + 0.15 * hum_score

    # 2. IAQ comfort in [0, 1]: ideal <= 750 ppm, poor >= 1500 ppm
    if co2 <= 750.0:
        iaq = 1.0
    else:
        iaq = max(0.0, 1.0 - (co2 - 750.0) / 750.0)

    # 3. Acoustic comfort in [0, 1]
    if noise <= 42.0:
        acoustic = 1.0
    else:
        acoustic = max(0.0, 1.0 - (noise - 42.0) * 0.03)

    # 4. Visual comfort in [0, 1]
    out_light = float(w.get("light", 10000.0))
    if out_light < 500.0:
        visual = 1.0  # Night time: blinds position does not hurt natural daylight
    elif light >= 250.0:
        visual = 1.0
    else:
        visual = max(0.3, light / 250.0)

    # 5. Weather & outdoor pollution infiltration penalties
    weather_penalty = 0.0
    win_open = act["window"]["position"] == "open"
    vmc_level = int(act["ventilation"]["level"])
    blinds_pos = float(act["blinds"]["position"])

    rain = float(w.get("rain_level", 0.0))
    wind = float(w.get("wind_speed", 0.0))
    pm10 = float(w.get("pm10", 15.0))
    pm2_5 = float(w.get("pm2_5", 8.0))
    t_out = float(w.get("temperature", 18.0))

    if win_open:
        if rain > 1.0:
            weather_penalty += min(0.45, 0.15 + rain * 0.01)
        if wind > 35.0:
            weather_penalty += min(0.35, (wind - 35.0) * 0.01)
        if pm10 > 50.0 or pm2_5 > 25.0:
            weather_penalty += min(0.40, max(pm10 - 50.0, (pm2_5 - 25.0) * 2.0) * 0.008)
        if t_out < 12.0:
            weather_penalty += min(0.40, (12.0 - t_out) * 0.03)

    if vmc_level > 0 and (pm10 > 50.0 or pm2_5 > 25.0):
        # High outdoor pollution: drawing unconditioned air via VMC degrades IAQ
        weather_penalty += 0.06 * vmc_level

    if wind > 55.0 and blinds_pos > 30.0:
        # Storm protection: exposed blinds risk damage in high wind
        weather_penalty += 0.12 * (blinds_pos / 100.0)

    bottleneck = min(thermal, iaq)
    raw_score = (
        0.45 * thermal
        + 0.25 * iaq
        + 0.20 * bottleneck
        + 0.06 * acoustic
        + 0.04 * visual
        - weather_penalty
    )
    final_score = max(0.0, min(1.0, raw_score))

    details = {
        "thermal": round(thermal, 4),
        "iaq": round(iaq, 4),
        "acoustic": round(acoustic, 4),
        "visual": round(visual, 4),
        "weather_penalty": round(weather_penalty, 4),
    }
    return final_score, details


def estimate_action_power(action: dict, current_state: dict | None = None) -> float:
    """Estimate power consumption Power(a) in Watts (including thermal equivalent for gas heating)."""
    act = normalize_actuators(action)
    hvac_mode = act["hvac"]["mode"]
    setpoint = float(act["hvac"]["setpoint"])
    t_in = float((current_state or {}).get("temperature", 22.0))

    power_w = 0.0
    if hvac_mode == "cool":
        # Cooling heat pump: 1500 W when actively cooling (T > setpoint + 0.5), 300 W maintenance
        power_w += 1500.0 if t_in > setpoint + 0.5 else 300.0
    elif hvac_mode == "heat":
        # Gas boiler + circulation pump: ~1100 W equivalent resource cost when actively heating (T < setpoint - 0.5)
        power_w += 1100.0 if t_in < setpoint - 0.5 else 250.0

    vmc_level = int(act["ventilation"]["level"])
    power_w += 30.0 * vmc_level

    lights_level = float(act["lights"]["level"])
    power_w += 1.0 * lights_level

    return power_w


def compute_actuator_wear(action: dict, current_actuators: dict | None = None) -> float:
    """Compute normalized actuator switching penalty DeltaActuator(a) in [0, 1]."""
    if not current_actuators:
        return 0.0
    target = normalize_actuators(action)
    curr = normalize_actuators(current_actuators)

    wear = 0.0
    if target["hvac"]["mode"] != curr["hvac"]["mode"]:
        wear += 0.45
    elif abs(float(target["hvac"]["setpoint"]) - float(curr["hvac"]["setpoint"])) >= 1.0:
        wear += 0.15

    if target["window"]["position"] != curr["window"]["position"]:
        wear += 0.25

    vmc_diff = abs(int(target["ventilation"]["level"]) - int(curr["ventilation"]["level"]))
    if vmc_diff > 0:
        wear += 0.18 * (vmc_diff / 3.0)

    blinds_diff = abs(float(target["blinds"]["position"]) - float(curr["blinds"]["position"]))
    if blinds_diff > 10.0:
        wear += 0.12 * (blinds_diff / 100.0)

    return min(1.0, wear)


class UtilityPlanner:
    """Evaluates candidate adaptation plans using Multi-Attribute Utility Theory (MAUT)."""

    def __init__(self, transition_model: SurrogateTransitionModel | None = None, config: dict | None = None):
        self.model = transition_model or SurrogateTransitionModel()
        cfg = config or {}
        self.horizon_s = float(cfg.get("horizon_seconds", 3600.0))
        self.power_max_w = float(cfg.get("power_max_w", 1600.0))
        self.min_utility_gain = float(cfg.get("min_utility_gain", 0.015))
        self.weights = cfg.get("weights", {"comfort": 0.80, "energy": 0.15, "wear": 0.05})
        self.eco_weights = cfg.get("eco_weights", {"comfort": 0.50, "energy": 0.45, "wear": 0.05})

    def select_best_plan(self, state: dict, current_actuators: dict | None = None,
                         weather: dict | None = None, faulty_actuators: set[str] | dict[str, dict] | None = None,
                         energy_balance_w: float = 0.0) -> dict:
        """Evaluate all candidate plans a in A and return the optimal plan a* = argmax U(a)."""
        cur_act = normalize_actuators(current_actuators)
        w = {**DEFAULT_WEATHER, **(weather or {})}
        faulty = faulty_actuators or set()
        initial_temp = float(state.get("temperature", 21.0))
        t_out = float(w.get("temperature", 18.0))

        occupancy = float(state.get("occupancy", 1.0))
        active_weights = self.eco_weights if occupancy <= 0.0 else self.weights
        w_comfort = float(active_weights.get("comfort", 0.78))
        w_energy = float(active_weights.get("energy", 0.17))
        w_wear = float(active_weights.get("wear", 0.05))

        # If the building has a solar surplus (energy_balance > 500 W), reduce energy penalty
        if energy_balance_w > 500.0:
            surplus_factor = max(0.35, 1.0 - min(0.65, energy_balance_w / 10000.0))
            w_energy = w_energy * surplus_factor

        candidates = build_candidate_plans(cur_act)
        evaluated = []
        keep_current_eval = None

        for cand in candidates:
            act_map = cand["actuators"]

            # If a candidate plan relies on changing a known-faulty actuator, simulate that
            # the faulty actuator remains stuck in its effective state and apply a fault penalty
            effective_act = copy.deepcopy(act_map)
            fault_penalty = 0.0
            for dev_name in faulty:
                if dev_name in effective_act and dev_name in cur_act:
                    stuck_st = (
                        faulty[dev_name]
                        if isinstance(faulty, dict) and isinstance(faulty.get(dev_name), dict)
                        else cur_act[dev_name]
                    )
                    if effective_act[dev_name] != stuck_st:
                        effective_act[dev_name] = copy.deepcopy(stuck_st)
                        if cand["name"] != "keep_current":
                            fault_penalty += 0.25

            pred_state = self.model.predict_next_state(state, effective_act, w, horizon_s=self.horizon_s)

            # When indoor is warm (>= 24.0 C) and outdoor air is mild (13.0..22.5 C),
            # closed-loop replanning will close the window once the target 22.5 C is reached.
            if (effective_act["window"]["position"] == "open"
                    and effective_act["hvac"]["mode"] == "off"
                    and initial_temp >= 24.0
                    and 13.0 <= t_out <= 22.5
                    and pred_state["temperature"] < 22.5):
                pred_state = {**pred_state, "temperature": 22.5}

            comfort_score, comfort_details = compute_comfort_score(pred_state, effective_act, w)
            power_w = estimate_action_power(effective_act, state)
            norm_power = min(1.0, max(0.0, power_w / max(1.0, self.power_max_w)))
            wear = compute_actuator_wear(act_map, cur_act)

            utility = (
                w_comfort * comfort_score
                - w_energy * norm_power
                - w_wear * wear
                - fault_penalty
            )

            entry = {
                "name": cand["name"],
                "actuators": act_map,
                "utility": round(utility, 5),
                "comfort_score": round(comfort_score, 4),
                "comfort_details": comfort_details,
                "power_w": round(power_w, 1),
                "norm_power": round(norm_power, 4),
                "wear": round(wear, 4),
                "predicted_state": pred_state,
            }
            evaluated.append(entry)
            if cand["name"] == "keep_current":
                keep_current_eval = entry

        evaluated.sort(key=lambda x: x["utility"], reverse=True)
        best = evaluated[0]

        # Hysteresis: prefer keep_current if the utility improvement is below min_utility_gain
        if (keep_current_eval is not None
                and best["name"] != "keep_current"
                and (best["utility"] - keep_current_eval["utility"]) < self.min_utility_gain):
            best = keep_current_eval

        return {
            "selected": best,
            "candidates": evaluated,
            "weights_used": {"comfort": w_comfort, "energy": round(w_energy, 4), "wear": w_wear},
        }


if __name__ == '__main__':
    now = int(time.time())
    samples = [
        {'timestamp': now - 120, 'value': 25.0},
        {'timestamp': now - 60, 'value': 26.2},
        {'timestamp': now, 'value': 27.5},
    ]
    print('prob breach in 300s vs thresh 30:', predict_breach_probability(samples, 300, 30.0))
    planner = UtilityPlanner()
    res = planner.select_best_plan(
        state={"temperature": 27.5, "humidity": 55.0, "co2": 600.0, "occupancy": 2},
        weather={"temperature": 19.0, "humidity": 50.0, "light": 40000.0},
    )
    print("Selected plan (warm inside, cool outside):", res["selected"]["name"], "U=", res["selected"]["utility"])
