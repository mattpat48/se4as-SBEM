import time
import os
import json
import logging
import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from datetime import datetime
from influxdb_client import InfluxDBClient, Point, WritePrecision
from engine import AnalyzerEngine

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("analyzer")

def main():
    mqtt_broker = os.getenv("MQTT_BROKER", "mosquitto")
    mqtt_user = os.getenv("MQTT_USERNAME")
    mqtt_password = os.getenv("MQTT_PASSWORD")
    mqtt_port = int(os.getenv("MQTT_PORT", 1883))
    
    influx_url = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
    influx_token = os.getenv("INFLUXDB_TOKEN", "admin_token")
    influx_org = os.getenv("INFLUXDB_ORG", "iot_org")
    influx_bucket = os.getenv("INFLUXDB_BUCKET", "iot_bucket")

    logger.info(f"Analyzer starting. Connecting to {mqtt_broker}...")

    engine = AnalyzerEngine()

    def on_connect(client, userdata, flags, rc, properties):
        logger.info(f"Connected to MQTT broker with result code {rc}")
        client.subscribe("Complex/monitored/#")
        client.subscribe("Complex/health/#")
        client.subscribe("Complex/model")
        
        # We don't subscribe to City/data anymore

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            topic = msg.topic
            
            if topic == "Complex/model":
                engine.update_model(payload)
                return

            if topic.startswith("Complex/monitored/"):
                engine.process_monitored(client, topic, payload)
                
            elif topic.startswith("Complex/health/"):
                engine.process_health(client, topic, payload)

        except Exception as e:
            logger.error(f"Error processing message on {msg.topic}: {e}")

    client = mqtt.Client(CallbackAPIVersion.VERSION2, client_id="iot_analyzer")
    if mqtt_user and mqtt_password:
        client.username_pw_set(mqtt_user, mqtt_password)
        
    client.on_connect = on_connect
    client.on_message = on_message

    connected = False
    while not connected:
        try:
            client.connect(mqtt_broker, mqtt_port, 60)
            connected = True
        except Exception as e:
            logger.error(f"Connection failed: {e}. Retrying in 5s...")
            time.sleep(5)

    client.loop_start()

    try:
        while True:
            time.sleep(5)
            # Run periodic analysis (Comfort, Risks, Aggregation)
            engine.run_periodic_analysis(client)
    except KeyboardInterrupt:
        logger.info("Shutting down analyzer...")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()