import dataclasses
import random

import pytest

from devices import SensorDevice
from model import Device

RNG = random.Random(0)


@pytest.fixture
def sensor(model):
    def make(stype_name, **overrides):
        stype = dataclasses.replace(model.sensor_types[stype_name], **overrides)
        device = Device(f"A-2-1.{stype_name}", "A-2-1", "A", stype_name, "sensor")
        return SensorDevice(device, stype, model.physics["drift_rate_per_min"])
    return make


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
    with pytest.raises(ValueError):
        sensor("co2").set_fault("melted", {}, 0)
