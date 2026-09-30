import copy
import json

import pytest

from model import ConfigError, build_model


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
