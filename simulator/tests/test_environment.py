import math
import random
from dataclasses import asdict
from datetime import datetime, timedelta

import pytest

from conftest import CONFIG
from environment import EnvEffects, Environment, base_temperature, sun_factor, traffic_factor
from model import load_model

P = load_model(CONFIG).physics["outdoor"]


@pytest.fixture
def env():
    return Environment(P, random.Random(0), datetime(2026, 9, 30, 12, 0))


@pytest.fixture
def env_at_noon():
    return Environment(P, random.Random(0), datetime(2026, 6, 21, 12, 30))


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


def test_light_reduced_by_rain(env_at_noon):
    env_at_noon.step(datetime(2026, 6, 21, 12, 30), 1, EnvEffects(clear_sky=True), False)
    clear = env_at_noon.state.light
    env_at_noon.step(datetime(2026, 6, 21, 12, 30), 1, EnvEffects(storm=True), False)
    assert env_at_noon.state.light == pytest.approx(clear * (1 - 0.8 * 0.9), rel=0.01)


def test_heatwave_relaxes_with_six_hour_tau(env):
    now = datetime(2026, 7, 15, 12, 0)
    base = base_temperature(now, P)
    for _ in range(360):
        env.step(now, 60, EnvEffects(temp_delta=10), False)   # 6 h, clock frozen
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
    for _ in range(60):
        env.step(datetime(2026, 9, 30, 22, 0), 60, EnvEffects(clear_sky=True), True)
    assert env.state.soil_moisture > before + 10


def test_month_change_is_finite(env):
    t = datetime(2026, 9, 30, 12, 0)
    for i in range(2 * 24 * 60):     # 2 sim days at dt = 60, then a jump to January
        env.step(t + timedelta(minutes=i), 60, EnvEffects(), False)
    env.step(datetime(2027, 1, 15, 8, 0), 60, EnvEffects(), False)
    assert all(math.isfinite(v) for v in asdict(env.state).values() if not isinstance(v, bool))
