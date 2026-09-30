"""Outdoor environment: sun, weather, temperature, traffic noise, PM, seismic, park soil."""
import math
import random
from dataclasses import dataclass
from datetime import datetime


@dataclass
class Outdoor:
    temperature: float
    humidity: float
    rain_level: float
    wind_speed: float
    light: float
    noise_level: float
    seismic: float
    pm10: float
    pm2_5: float
    soil_moisture: float
    cloudiness: float
    sun: float
    raining: bool


@dataclass
class EnvEffects:
    temp_delta: float = 0.0
    pm_factor: float = 1.0
    storm: bool = False
    clear_sky: bool = False
    earthquake_magnitude: float | None = None


INITIAL_SOIL_MOISTURE = 40.0


def _hour(now: datetime) -> float:
    return now.hour + now.minute / 60 + now.second / 3600


def sun_factor(now: datetime, p: dict) -> float:
    lo, hi = p["day_length_h"]["min"], p["day_length_h"]["max"]
    doy = now.timetuple().tm_yday
    length = (lo + hi) / 2 + (hi - lo) / 2 * math.cos(2 * math.pi * (doy - 172) / 365)
    sunrise = p["solar_noon_h"] - length / 2
    h = _hour(now)
    if sunrise < h < sunrise + length:
        return max(0.0, math.sin(math.pi * (h - sunrise) / length))
    return 0.0


def base_temperature(now: datetime, p: dict) -> float:
    mean = p["monthly_mean_temp"][now.month - 1]
    t_min, t_max, amp = p["t_min_hour"], p["t_max_hour"], p["daily_amplitude"]
    h = _hour(now)
    if t_min <= h < t_max:
        curve = -math.cos(math.pi * (h - t_min) / (t_max - t_min))
    else:
        falling = 24 - (t_max - t_min)
        curve = math.cos(math.pi * ((h - t_max) % 24) / falling)
    return mean + amp * curve


def traffic_factor(hour: float, p: dict) -> float:
    return max(max(0.0, 1 - abs(hour - peak) / 3) for peak in p["traffic_peaks_h"])


def _per_step_prob(p_h: float, dt: float) -> float:
    return 1 - (1 - p_h) ** (dt / 3600)


class Environment:
    def __init__(self, p: dict, rng: random.Random, start: datetime):
        self.p = p
        self.rng = rng
        self._delta = 0.0
        self._hour_key = None
        self._rain_mm = 0.0
        self._wind = 0.0
        self._storm_rain = 0.0
        self._storm_wind = 0.0
        self._was_storm = False
        self.state = Outdoor(temperature=base_temperature(start, p), humidity=60.0, rain_level=0.0,
                             wind_speed=0.0, light=0.0, noise_level=p["traffic_noise_db"]["night"],
                             seismic=0.0, pm10=p["pm10_base"], pm2_5=p["pm2_5_base"],
                             soil_moisture=INITIAL_SOIL_MOISTURE, cloudiness=0.0, sun=0.0, raining=False)
        self.step(start, 0.0, EnvEffects(), False)

    def step(self, now: datetime, dt: float, effects: EnvEffects, irrigation_on: bool) -> None:
        p, s, rng = self.p, self.state, self.rng
        mean = p["monthly_mean_temp"][now.month - 1]
        amp = p["daily_amplitude"]

        # Hourly redraws (wind, rain intensity, storm levels).
        key = (now.date(), now.hour)
        new_hour = key != self._hour_key
        self._hour_key = key
        if new_hour:
            self._wind = rng.uniform(*p["wind_base_kmh"])
            self._rain_mm = rng.uniform(*p["rain_mm_h"])
        if effects.storm and (new_hour or not self._was_storm):
            self._storm_rain = rng.uniform(*p["storm"]["rain_mm_h"])
            self._storm_wind = rng.uniform(*p["storm"]["wind_kmh"])
        self._was_storm = effects.storm

        # Weather: Markov chain dry <-> rain, overridden by scenarios.
        if effects.clear_sky:
            s.raining = False
        elif effects.storm:
            s.raining = True
        elif s.raining:
            if rng.random() < _per_step_prob(p["rain_stop_prob_h"], dt):
                s.raining = False
        elif rng.random() < _per_step_prob(p["rain_start_prob_h"], dt):
            s.raining = True
            self._rain_mm = rng.uniform(*p["rain_mm_h"])
        if effects.storm:
            s.rain_level, s.wind_speed = self._storm_rain, self._storm_wind
        else:
            s.rain_level = self._rain_mm if s.raining else 0.0
            s.wind_speed = self._wind
        s.cloudiness = p["rain_cloudiness"] if s.raining else 0.0

        # Sun and light.
        s.sun = sun_factor(now, p)
        s.light = p["max_lux"] * s.sun * (1 - p["cloud_light_factor"] * s.cloudiness)

        # Temperature: base curve + scenario delta relaxing with tau (start and stop alike).
        tau = p["scenario_relax_tau_h"] * 3600
        self._delta = effects.temp_delta + (self._delta - effects.temp_delta) * math.exp(-dt / tau)
        s.temperature = base_temperature(now, p) + self._delta

        # Humidity: interpolated between the daily extremes, bonus with rain.
        frac = (s.temperature - (mean - amp)) / (2 * amp)
        hum = p["humidity_at_tmin"] + (p["humidity_at_tmax"] - p["humidity_at_tmin"]) * frac
        if s.raining:
            hum += p["rain_humidity_bonus"]
        s.humidity = min(100.0, max(0.0, hum))

        # Traffic noise and particulate.
        tf = traffic_factor(_hour(now), p)
        noise = p["traffic_noise_db"]
        s.noise_level = noise["night"] + (noise["peak"] - noise["night"]) * tf
        rain_pm = p["rain_pm_factor"] if s.raining else 1.0
        s.pm10 = (p["pm10_base"] + p["pm10_traffic"] * tf) * effects.pm_factor * rain_pm
        s.pm2_5 = (p["pm2_5_base"] + p["pm2_5_traffic"] * tf) * effects.pm_factor * rain_pm

        # Seismic: background micro-tremor, earthquakes only from scenarios.
        if effects.earthquake_magnitude is not None:
            s.seismic = max(0.0, effects.earthquake_magnitude + rng.gauss(0, p["earthquake_noise"]))
        else:
            s.seismic = rng.uniform(*p["seismic_background"])

        # Park soil moisture.
        soil = p["soil"]
        rate_h = -soil["dry_rate_h"] * s.sun * max(0.0, s.temperature / 20)
        rate_h += soil["rain_gain_per_mm"] * s.rain_level
        if irrigation_on and s.temperature > 0:
            rate_h += soil["irrigation_gain_h"]
        s.soil_moisture = min(100.0, max(0.0, s.soil_moisture + rate_h * dt / 3600))
