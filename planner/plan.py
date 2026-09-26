import os
import json
import time
import paho.mqtt.client as mqtt
from executor.mqtt_adapter import MqttAdapter
from influxdb_client import InfluxDBClient, Point, WritePrecision
from predictor import predict_breach_probability
from config import service as config_service
import os

# Simple mapping from sensor type to actuator device
TYPE_TO_DEVICE = {
    "temperature": "hvac",
    "co2": "ventilation",
    "noise_level": "alert_system",
    "smoke": "alarm",
}

mqtt_broker = os.getenv("MQTT_BROKER", "mosquitto")
mqtt_user = os.getenv("MQTT_USERNAME")
mqtt_password = os.getenv("MQTT_PASSWORD")
influx_url = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
influx_token = os.getenv("INFLUXDB_TOKEN")
influx_org = os.getenv("INFLUXDB_ORG", "iot_org")
influx_bucket = os.getenv("INFLUXDB_BUCKET", "iot_bucket")

# Initialize InfluxDB client
try:
    influx_client = InfluxDBClient(url=influx_url, token=influx_token, org=influx_org)
    influx_query_api = influx_client.query_api()
    influx_write_api = influx_client.write_api()
    print("Planner: InfluxDB client initialized")
except Exception as e:
    influx_client = None
    influx_query_api = None
    influx_write_api = None
    print(f"Planner: could not init InfluxDB client: {e}")

adapter = MqttAdapter(broker=mqtt_broker, username=mqtt_user, password=mqtt_password)

client = mqtt.Client()

def on_connect(c, userdata, flags, rc):
    print("Planner connected, subscribing to City/alerts/#")
    c.subscribe("City/alerts/#", qos=1)

def on_message(c, userdata, msg):
    try:
        topic_parts = msg.topic.split("/")
        # topic: City/alerts/{location}/{type}
        if len(topic_parts) < 4:
            return
        location = topic_parts[2]
        stype = topic_parts[3]
        payload = msg.payload.decode()
        print(f"Planner received alert for {location} {stype}: {payload}")

        device = TYPE_TO_DEVICE.get(stype, "generic")
        # Fetch recent history from InfluxDB to support prediction
        samples = []
        try:
            if influx_query_api is not None:
                minutes = 10
                flux = f'from(bucket: "{influx_bucket}") |> range(start: -{minutes}m) |> filter(fn: (r) => r._measurement == "sensors" and r._field == "value" and r["type"] == "{stype}" and r["location"] == "{location}") |> keep(columns:["_time","_value"]) |> sort(columns:["_time"])'
                tables = influx_query_api.query(flux)
                for table in tables:
                    for record in table.records:
                        ts = int(record.get_time().timestamp())
                        val = float(record.get_value())
                        samples.append({'timestamp': ts, 'value': val})
        except Exception as e:
            print(f"Planner: error querying Influx history: {e}")

        # fetch latest threshold for this type
        threshold = None
        try:
            if influx_query_api is not None:
                flux_t = f'from(bucket: "{influx_bucket}") |> range(start: -30d) |> filter(fn: (r) => r._measurement == "thresholds" and r["type"] == "{stype}") |> last()'
                tables = influx_query_api.query(flux_t)
                for table in tables:
                    for record in table.records:
                        threshold = float(record.get_value())
        except Exception as e:
            print(f"Planner: error querying threshold: {e}")

        # Predict probability of breach in next horizon (seconds)
        proactive = False
        prob = 0.0
        horizon = config_service.get_policy('planner', 'horizon_seconds', 300)
        try:
            if threshold is not None and samples:
                prob = predict_breach_probability(samples, horizon, threshold)
                print(f"Planner: predicted breach prob={prob:.3f} for {stype} at {location}")
                threshold_prob = config_service.get_policy('planner', 'proactive_prob', 0.6)
                if prob >= threshold_prob:
                    proactive = True
        except Exception as e:
            print(f"Planner: predictor error: {e}")

        # simple action mapping (reactive)
        if proactive:
            # choose a proactive command
            if stype == "co2":
                cmd = {"action": "increase_ventilation", "level": 2, "reason": "predicted_breach", "prob": prob}
            elif stype == "temperature":
                cmd = {"action": "adjust_setpoint", "delta": -2, "reason": "predicted_breach", "prob": prob}
            else:
                cmd = {"action": "notify", "message": f"predicted_{stype}_breach", "prob": prob}
        else:
            if stype == "co2":
                cmd = {"action": "increase_ventilation", "level": 1, "reason": "co2_alert"}
            elif stype == "temperature":
                cmd = {"action": "adjust_setpoint", "delta": -1, "reason": "temp_alert"}
            elif stype == "smoke":
                cmd = {"action": "activate_alarm", "reason": "smoke_alert"}
            else:
                cmd = {"action": "notify", "message": payload}

        # persist planner decision to InfluxDB
        try:
            if influx_write_api is not None:
                p = Point("planner_actions").tag("location", location).tag("type", stype).field("proactive", int(proactive)).field("prob", float(prob)).time(int(time.time() * 1e9), WritePrecision.NS)
                influx_write_api.write(bucket=influx_bucket, org=influx_org, record=p)
        except Exception as e:
            print(f"Planner: error writing planner action: {e}")

        # send command via adapter and log ack
        resp = adapter.send_command(location, device, cmd, timeout=5)
        print(f"Sent command to {device} at {location}, ack={resp}")
    except Exception as e:
        print(f"Planner error processing alert: {e}")


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
