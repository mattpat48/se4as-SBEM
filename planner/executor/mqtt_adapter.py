import os
import json
import uuid
import threading
import time
import paho.mqtt.client as mqtt


class MqttAdapter:
    def __init__(self, broker=None, port=1883, username=None, password=None):
        self.broker = broker or os.getenv("MQTT_BROKER", "mosquitto")
        self.port = port
        self.username = username or os.getenv("MQTT_USERNAME")
        self.password = password or os.getenv("MQTT_PASSWORD")

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)

        self._acks = {}
        self._lock = threading.Lock()

        self.client.on_message = self._on_message
        self.client.on_connect = self._on_connect
        self.client.connect(self.broker, self.port, 60)
        self.client.loop_start()

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        print(f"MqttAdapter connected, subscribing to Complex/ack/#")
        client.subscribe("Complex/ack/#", qos=1)

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            cmd_id = payload.get("cmd_id")
            if not cmd_id:
                return
            print(f"MqttAdapter received ack for {cmd_id}: {payload}")
            with self._lock:
                ev = self._acks.get(cmd_id)
                if ev is not None:
                    ev["resp"] = payload
                    ev["event"].set()
        except Exception:
            pass

    def send_command(self, area, unit_id, device, command, timeout=5):
        """Send a command to `Complex/cmd/{area}/{unit_id}/{device}` with a generated cmd_id and wait for ack."""
        cmd_id = str(uuid.uuid4())
        topic = f"Complex/cmd/{area}/{unit_id}/{device}"
        payload = {
            "cmd_id": cmd_id,
            "command": command,
            "timestamp": int(time.time())
        }

        ev = threading.Event()
        with self._lock:
            self._acks[cmd_id] = {"event": ev, "resp": None}

        self.client.publish(topic, json.dumps(payload), qos=1)

        finished = ev.wait(timeout)
        with self._lock:
            resp = self._acks.pop(cmd_id, {}).get("resp")

        if not finished:
            return None
        return resp


if __name__ == "__main__":
    adapter = MqttAdapter()
    print("Sending test command...")
    r = adapter.send_command("TestRoom", "ventilation", {"action": "increase", "step": 1}, timeout=3)
    print("Ack:", r)
