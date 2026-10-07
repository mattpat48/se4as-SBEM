import os
import json
import time
import paho.mqtt.client as mqtt
from executor.mqtt_adapter import MqttAdapter

mqtt_broker = os.getenv("MQTT_BROKER", "mosquitto")
mqtt_user = os.getenv("MQTT_USERNAME")
mqtt_password = os.getenv("MQTT_PASSWORD")

adapter = MqttAdapter(broker=mqtt_broker, username=mqtt_user, password=mqtt_password)
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def on_connect(c, userdata, flags, reason_code, properties):
    print("Planner connected, subscribing to Complex/analysis/#")
    c.subscribe("Complex/analysis/#", qos=1)

def on_message(c, userdata, msg):
    try:
        topic_parts = msg.topic.split("/")
        # Complex/analysis/{area}/{unit_id}/risk/{risk_name}
        if len(topic_parts) < 6 or topic_parts[4] != "risk":
            return
            
        area = topic_parts[2]
        unit_id = topic_parts[3]
        risk_name = topic_parts[5]
        
        payload = json.loads(msg.payload.decode())
        severity = payload.get("severity", 0)
        
        if severity > 0:
            print(f"Planner: Detected {risk_name} with severity {severity} at {unit_id}")
            
            if risk_name == "fire":
                # Fire reaction: siren on, gas closed, VMC off, smoke vent open, residents notified
                # Note: sending commands one by one
                print(f"Executing fire mitigation for {unit_id}...")
                adapter.send_command(area, unit_id, "alarm", {"siren": "on"}, timeout=0.1)
                adapter.send_command(area, unit_id, "gas_valve", {"position": "closed"}, timeout=0.1)
                adapter.send_command(area, unit_id, "ventilation", {"level": 0}, timeout=0.1)
                adapter.send_command(area, unit_id, "resident_display", {"message": "EVACUATE FIRE", "level": "danger"}, timeout=0.1)
                
                # If there's a stairwell smoke vent, it's in the stairwell unit (area-S)
                adapter.send_command(area, f"{area}-S", "smoke_vent", {"position": "open"}, timeout=0.1)
                adapter.send_command(area, f"{area}-S", "evacuation_siren", {"siren": "on"}, timeout=0.1)
                adapter.send_command(area, area, "elevator", {"mode": "recall"}, timeout=0.1)
                adapter.send_command("park", "park", "evacuation_signs", {"state": "on"}, timeout=0.1)
                
            elif risk_name == "gas_co_leak":
                # Gas/CO reaction: close gas, open windows, full VMC
                adapter.send_command(area, unit_id, "gas_valve", {"position": "closed"}, timeout=0.1)
                adapter.send_command(area, unit_id, "window", {"position": "open"}, timeout=0.1)
                adapter.send_command(area, unit_id, "ventilation", {"level": 3}, timeout=0.1)
                adapter.send_command(area, unit_id, "alarm", {"siren": "on"}, timeout=0.1)
                adapter.send_command(area, unit_id, "resident_display", {"message": "GAS/CO LEAK. WINDOWS OPEN.", "level": "danger"}, timeout=0.1)

    except Exception as e:
        print(f"Planner error processing message: {e}")

if mqtt_user and mqtt_password:
    client.username_pw_set(mqtt_user, mqtt_password)

client.on_connect = on_connect
client.on_message = on_message

while True:
    try:
        client.connect(mqtt_broker, 1883, 60)
        break
    except Exception as e:
        print(f"Planner connection failed: {e}. Retrying in 5s...")
        time.sleep(5)

client.loop_forever()
