import os
import json
import threading
import time
from pathlib import Path
import paho.mqtt.client as mqtt

# Simple runtime configuration service.
# Subscribes to MQTT topics to receive dynamic policy updates.

BASE_DIR = Path(__file__).resolve().parent
POLICY_FILE = BASE_DIR / "policies.json"

MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")

# in-memory config store
CONFIG = {
    'rules': {},
    'planner': {
        'horizon_seconds': 300,
        'proactive_prob': 0.6,
    }
}

_client = None
_lock = threading.Lock()


def _deep_update(target, source):
    for key, value in source.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_update(target[key], value)
        else:
            target[key] = value


def _load_from_disk():
    if not POLICY_FILE.exists():
        return
    try:
        with POLICY_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            _deep_update(CONFIG, data)
    except Exception:
        return


def _save_to_disk():
    try:
        POLICY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = POLICY_FILE.with_suffix(".json.tmp")
        with tmp_file.open("w", encoding="utf-8") as handle:
            json.dump(CONFIG, handle, indent=2, sort_keys=True)
        os.replace(tmp_file, POLICY_FILE)
    except Exception:
        return


def _on_connect(client, userdata, flags, rc):
    # subscribe to policies and rule updates
    client.subscribe([("City/update/policies", 1), ("City/update/rules/#", 1)])


def _on_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = msg.payload.decode()
        data = json.loads(payload) if payload else None
        if topic == 'City/update/policies':
            if isinstance(data, dict):
                with _lock:
                    _deep_update(CONFIG, data)
                    _save_to_disk()
        elif topic.startswith('City/update/rules/'):
            # topic format: City/update/rules/<rulename>
            parts = topic.split('/')
            if len(parts) >= 4:
                rulename = parts[3]
                if isinstance(data, dict):
                    with _lock:
                        CONFIG.setdefault('rules', {})[rulename] = data
                        _save_to_disk()
    except Exception:
        return


def start():
    global _client
    if _client is not None:
        return
    _client = mqtt.Client()
    if MQTT_USERNAME and MQTT_PASSWORD:
        _client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    _client.on_connect = _on_connect
    _client.on_message = _on_message
    try:
        _client.connect(MQTT_BROKER, MQTT_PORT, 60)
        _client.loop_start()
        _publish_snapshot(_client)
    except Exception:
        _client = None


def get_rule_param(rule, name, default=None):
    return CONFIG.get('rules', {}).get(rule, {}).get(name, default)


def get_policy(section, name, default=None):
    return CONFIG.get(section, {}).get(name, default)


def _publish_snapshot(client):
    snapshot_data = snapshot()
    try:
        client.publish("City/update/policies", json.dumps(snapshot_data), retain=True, qos=1)
        for rule_name, rule_values in snapshot_data.get('rules', {}).items():
            client.publish(f"City/update/rules/{rule_name}", json.dumps(rule_values), retain=True, qos=1)
    except Exception:
        return


def snapshot():
    with _lock:
        return json.loads(json.dumps(CONFIG))


def persist_now():
    with _lock:
        _save_to_disk()


def load_persisted():
    with _lock:
        _load_from_disk()


# start background listener on import
try:
    load_persisted()
    start()
except Exception:
    pass
