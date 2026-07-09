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

        self.client = mqtt.Client()
        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)

        self._acks = {}
        self._lock = threading.Lock()

        self.client.on_message = self._on_message
        self.client.connect(self.broker, self.port, 60)
        # subscribe to all ack topics
        self.client.subscribe("City/actuator/+/+/ack", qos=1)
        self.client.loop_start()

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            cmd_id = payload.get("cmd_id")
            if not cmd_id:
                return
            with self._lock:
                ev = self._acks.get(cmd_id)
                if ev is not None:
                    ev["resp"] = payload
                    ev["event"].set()
        except Exception:
            pass

    def send_command(self, location, device, command, timeout=5):
        """Send a command to `City/actuator/{location}/{device}/cmd` with a generated cmd_id and wait for ack."""
        cmd_id = str(uuid.uuid4())
        topic = f"City/actuator/{location}/{device}/cmd"
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
