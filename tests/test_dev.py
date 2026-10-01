"""Tests for the pure helpers of dev.py (the cross-platform stack launcher)."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import dev  # noqa: E402


def test_parse_env_skips_comments_blanks_and_strips_quotes():
    text = "# comment\n\nMQTT_USERNAME=admin\nMQTT_PASSWORD=\"s3cr=t\"\nEMPTY=\n  SPACED = x  \n"
    assert dev.parse_env(text) == {"MQTT_USERNAME": "admin", "MQTT_PASSWORD": "s3cr=t", "EMPTY": "", "SPACED": "x"}


def test_presets_never_include_nodered_except_full_stack():
    assert dev.PRESETS["view"]["services"] == ["mosquitto", "simulator", "view"]
    assert "nodered" not in dev.PRESETS["mapek"]["services"]
    assert "nodered" in dev.PRESETS["full"]["services"]


def test_parse_selection_accepts_spaces_and_commas_and_dedups():
    assert dev.parse_selection("3, 1 3", 5) == [1, 3]


@pytest.mark.parametrize("raw", ["", "0", "6", "a", "1 x"])
def test_parse_selection_rejects_invalid(raw):
    with pytest.raises(ValueError):
        dev.parse_selection(raw, 5)


def test_compose_env_silences_telegram_by_default():
    env = dev.compose_env({"PATH": "/bin", "TELEGRAM_CHAT_ID": "-100123"}, telegram_live=False)
    assert env["TELEGRAM_CHAT_ID"] == "0"
    assert env["PATH"] == "/bin"


def test_compose_env_keeps_real_chat_when_live():
    env = dev.compose_env({"PATH": "/bin"}, telegram_live=True)
    assert "TELEGRAM_CHAT_ID" not in env


def test_up_command_builds_by_default():
    assert dev.up_command(["mosquitto", "view"]) == ["docker", "compose", "up", "-d", "--build", "mosquitto", "view"]
    assert dev.up_command(["view"], build=False) == ["docker", "compose", "up", "-d", "view"]


def test_mqtt_pub_command_uses_admin_credentials_and_json_payload():
    cmd = dev.mqtt_pub_command({"MQTT_USERNAME": "admin", "MQTT_PASSWORD": "pw"},
                               "Complex/control/clock", {"speed": 1})
    assert cmd == ["docker", "exec", "iot_mosquitto", "mosquitto_pub", "-u", "admin", "-P", "pw",
                   "-q", "1", "-t", "Complex/control/clock", "-m", '{"speed": 1}']


def test_load_scenarios_reads_the_simulator_catalog():
    catalog = dev.load_scenarios(ROOT / "simulator" / "scenarios.py")
    assert catalog["fire"] == "apartment"
    assert catalog["earthquake"] == "complex"
    assert catalog["blackout"] == "complex_or_building"
    assert catalog["sensor_fault"] == "sensor"
    assert len(catalog) == 14


def test_scenario_start_payload_omits_empty_params():
    assert dev.scenario_start_payload("fire", "A-2-1", None) == {"action": "start", "scenario": "fire", "target": "A-2-1"}
    assert dev.scenario_start_payload("gas_leak", "A-2-1", {"rate": 5}) == {
        "action": "start", "scenario": "gas_leak", "target": "A-2-1", "params": {"rate": 5}}


def test_default_target_only_for_complex_scenarios():
    assert dev.default_target("complex") == "complex"
    assert dev.default_target("complex_or_building") == "complex"
    assert dev.default_target("apartment") is None


def test_parse_active_scenarios():
    raw = json.dumps({"active": [{"scenario_id": "sc-0001", "scenario": "fire", "target": "A-2-1"}]})
    assert dev.parse_active_scenarios(raw) == [{"scenario_id": "sc-0001", "scenario": "fire", "target": "A-2-1"}]
    assert dev.parse_active_scenarios("") == []
    assert dev.parse_active_scenarios("not json") == []
