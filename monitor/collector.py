import json
import logging

logger = logging.getLogger(__name__)

class Collector:
    def __init__(self, validator):
        self.validator = validator

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            payload = json.loads(msg.payload.decode())
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON on {topic}")
            return
            
        if topic.startswith("Complex/raw/"):
            self.validator.process_raw(topic, payload)
        elif topic.startswith("Complex/state/"):
            self.validator.process_state(topic, payload)
        elif topic == "Complex/model":
            logger.info("Received Complex/model update")
            self.validator.update_model(payload)
        elif topic == "Complex/status/simulator":
            status = payload.get("status", "offline")
            self.validator.set_simulator_status(status)
