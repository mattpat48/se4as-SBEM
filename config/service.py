import os
import json
import threading
import time
import paho.mqtt.client as mqtt

# Simple runtime configuration service.
# Subscribes to MQTT topics to receive dynamic policy updates.

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
                CONFIG.update(data)
        elif topic.startswith('City/update/rules/'):
            # topic format: City/update/rules/<rulename>
            parts = topic.split('/')
            if len(parts) >= 4:
                rulename = parts[3]
                if isinstance(data, dict):
                    CONFIG.setdefault('rules', {})[rulename] = data
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
    except Exception:
        _client = None


def get_rule_param(rule, name, default=None):
    return CONFIG.get('rules', {}).get(rule, {}).get(name, default)


def get_policy(section, name, default=None):
    return CONFIG.get(section, {}).get(name, default)


# start background listener on import
try:
    start()
except Exception:
    pass
