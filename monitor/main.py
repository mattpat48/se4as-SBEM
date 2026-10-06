import os
import time
import logging
import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from dotenv import load_dotenv

from publisher import Publisher
from validator import Validator
from collector import Collector
from derived import DerivedCalculator

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("monitor")

def main():
    load_dotenv()
    
    mqtt_broker = os.environ.get("MQTT_BROKER", "mosquitto")
    mqtt_port = int(os.environ.get("MQTT_PORT", 1883))
    mqtt_user = os.environ.get("MQTT_USERNAME", "admin")
    mqtt_password = os.environ.get("MQTT_PASSWORD", "adminpassword123")

    client = mqtt.Client(CallbackAPIVersion.VERSION2, client_id="iot_monitor")
    if mqtt_user and mqtt_password:
        client.username_pw_set(mqtt_user, mqtt_password)
        
    client.will_set("Complex/status/monitor", '{"status":"offline"}', retain=True)

    publisher = Publisher(client)
    validator = Validator(publisher)
    collector = Collector(validator)
    derived_calc = DerivedCalculator(publisher, validator)

    def on_connect(client, userdata, flags, rc, properties):
        logger.info(f"Connected to MQTT broker with result code {rc}")
        client.subscribe("Complex/raw/#")
        client.subscribe("Complex/state/#")
        client.subscribe("Complex/model")
        client.subscribe("Complex/status/simulator")
        client.publish("Complex/status/monitor", '{"status":"online"}', retain=True)

    def on_message(client, userdata, msg):
        collector.on_message(client, userdata, msg)

    client.on_connect = on_connect
    client.on_message = on_message

    connected = False
    while not connected:
        try:
            client.connect(mqtt_broker, mqtt_port, 60)
            connected = True
        except Exception as e:
            logger.error(f"Failed to connect to MQTT: {e}. Retrying in 5s...")
            time.sleep(5)

    client.loop_start()

    logger.info("Monitor service started.")
    try:
        while True:
            time.sleep(1)
            validator.check_offline()
            derived_calc.calculate()
            publisher.check_flush()
    except KeyboardInterrupt:
        logger.info("Shutting down monitor...")
    finally:
        client.publish("Complex/status/monitor", '{"status":"offline"}', retain=True)
        publisher.flush()
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
