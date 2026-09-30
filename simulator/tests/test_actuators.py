import pytest

from devices import ActuatorDevice
from model import Device


def _actuator(model, unit_id, atype):
    return ActuatorDevice(Device(f"{unit_id}.{atype}", unit_id, "A", atype, "actuator"), model.actuator_types[atype])


@pytest.fixture
def hvac(model):
    return _actuator(model, "A-2-1", "hvac")


@pytest.fixture
def ventilation(model):
    return _actuator(model, "A-2-1", "ventilation")


@pytest.fixture
def display(model):
    return _actuator(model, "A-2-1", "resident_display")


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
