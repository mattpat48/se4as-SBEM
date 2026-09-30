import copy
import json
from pathlib import Path

import pytest

CONFIG = Path(__file__).resolve().parents[2] / "config" / "complex.json"
_RAW = json.loads(CONFIG.read_text(encoding="utf-8"))


def load_raw() -> dict:
    return copy.deepcopy(_RAW)


@pytest.fixture
def raw_config():
    return load_raw()


@pytest.fixture
def model(raw_config):
    from model import build_model
    return build_model(raw_config)


def _physics() -> dict:
    from model import build_model
    return build_model(load_raw()).physics


P = _physics()

_ACTUATOR_SHORTCUTS = {"ventilation": "level", "window": "position", "gas_valve": "position",
                       "blinds": "position", "lights": "level", "alarm": "siren"}


def outdoor(**kw):
    from environment import Outdoor
    base = dict(temperature=10.0, humidity=60.0, rain_level=0.0, wind_speed=0.0, light=0.0, noise_level=45.0,
                seismic=0.0, pm10=15.0, pm2_5=8.0, soil_moisture=40.0, cloudiness=0.0, sun=0.0, raining=False)
    base.update(kw)
    return Outdoor(**base)


def inputs(**kw):
    """ApartmentInputs with test defaults; see the plan's Task 5 for the shortcut kwargs."""
    from physics import ApartmentInputs
    catalogue = _RAW["device_types"]
    actuators = {t: dict(catalogue[t]["default"]) for t in _RAW["apartment_template"]["actuators"]}
    out = {}
    for key, field_name in (("outdoor_t", "temperature"), ("outdoor_lux", "light"), ("sun", "sun"),
                           ("outdoor_rh", "humidity")):
        if key in kw:
            out[field_name] = kw.pop(key)
    if "hvac" in kw:
        actuators["hvac"].update(kw.pop("hvac"))
    for t, state_key in _ACTUATOR_SHORTCUTS.items():
        if t in kw:
            actuators[t][state_key] = kw.pop(t)
    args = dict(outdoor=outdoor(**out), people=0, awake=0, actuators=actuators, volume_m3=216.0,
                orientation="S", insulation="media", powered=True)
    args.update(kw)
    return ApartmentInputs(**args)
