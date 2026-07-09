import time
import os
import json
import paho.mqtt.client as mqtt
from datastructure import SensorData, THRESHOLDS
from datetime import datetime
from influxdb_client import InfluxDBClient, Point, WritePrecision
from analyzer.engine import AnalyzerEngine

# Load environment variables
mqtt_broker = os.getenv("MQTT_BROKER", "mosquitto")
mqtt_user = os.getenv("MQTT_USERNAME")
mqtt_password = os.getenv("MQTT_PASSWORD")
influx_url = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
influx_token = os.getenv("INFLUXDB_TOKEN", "my-super-secret-auth-token")
influx_org = os.getenv("INFLUXDB_ORG", "iot_org")
influx_bucket = os.getenv("INFLUXDB_BUCKET", "iot_bucket")

print(f"Analyzer container started. Connecting to {mqtt_broker}...", flush=True)

# Dictionary to track the alert state of each sensor: {sensor_id: bool}
active_alerts = {}

# Initialize InfluxDB client for persisting thresholds and emergencies
try:
    influx_client = InfluxDBClient(url=influx_url, token=influx_token, org=influx_org)
    influx_write_api = influx_client.write_api()
    print("InfluxDB client initialized", flush=True)
except Exception as e:
    influx_client = None
    influx_write_api = None
    print(f"Warning: could not initialize InfluxDB client: {e}", flush=True)

# Initialize AnalyzerEngine with Influx write API
engine = AnalyzerEngine(influx_write_api=influx_write_api, influx_bucket=influx_bucket, influx_org=influx_org)

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}", flush=True)
    client.subscribe([("City/#", 0), ("City/update/thresholds", 1)])

def on_message(client, userdata, msg):
    try:
        # Handle Configuration Updates
        if msg.topic.startswith("City/update/thresholds"):
            payload = json.loads(msg.payload.decode())
            if "thresholds" in payload:
                print(f"Updating thresholds: {payload['thresholds']}", flush=True)
                THRESHOLDS.update(payload["thresholds"])
                # Persist thresholds to InfluxDB (measurement: thresholds)
                try:
                    if influx_write_api is not None:
                        for tname, tval in payload["thresholds"].items():
                            p = Point("thresholds").tag("type", str(tname)).field("value", float(tval)).time(datetime.utcnow(), WritePrecision.NS)
                            influx_write_api.write(bucket=influx_bucket, org=influx_org, record=p)
                        # publish a confirmation message
                        client.publish("City/alerts/config", json.dumps({"status": "thresholds_updated", "thresholds": payload["thresholds"]}), qos=1)
                except Exception as e:
                    print(f"Error writing thresholds to InfluxDB: {e}", flush=True)
            return

        # Extract location from topic (City/Location/Type)
        topic_parts = msg.topic.split("/")
        location = topic_parts[2] if len(topic_parts) > 1 else "Unknown"

        # Decoding using pre-defined structure
        payload_str = msg.payload.decode()
        data = SensorData.from_json(payload_str)

        print(f"Analyzing: {data.sensorid} ({data.type}) -> {data.value:.2f}", flush=True)

        # Delegate processing to AnalyzerEngine (thresholds, composite rules, persistence)
        try:
            engine.process(client, location, data)
        except Exception as e:
            print(f"Engine processing error: {e}", flush=True)
            
    except Exception as e:
        print(f"Error processing message: {e}", flush=True)

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

if mqtt_user and mqtt_password:
    client.username_pw_set(mqtt_user, mqtt_password)

while True:
    try:
        client.connect(mqtt_broker, 1883, 60)
        break
    except Exception as e:
        print(f"Connection failed: {e}. Retrying in 5s...", flush=True)
        time.sleep(5)

client.loop_forever()