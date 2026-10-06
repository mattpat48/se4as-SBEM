import time
import math
import logging

logger = logging.getLogger(__name__)

class DeviceState:
    def __init__(self, device_id, area, unit_id, typ, kind, config):
        self.device_id = device_id
        self.area = area
        self.unit_id = unit_id
        self.type = typ
        self.kind = kind  # sensor or actuator
        self.config = config
        
        self.last_value = None
        self.last_time = 0
        
        # Validation state
        self.status = "ok"
        self.consecutive_stuck = 0
        self.history = []  # For drift check: list of (timestamp, value, median_neighbor)
        self.consecutive_valid = 0
        
        # Derived config
        self.valid_range = config.get("valid_range")
        self.rest_value = config.get("rest_value")
        self.stuck_check = config.get("stuck_check", False)
        self.drift_check = config.get("drift_check", False)

class Validator:
    def __init__(self, publisher):
        self.publisher = publisher
        self.device_catalog = {} # type -> config
        self.devices = {} # device_id -> DeviceState
        self.monitor_config = {}
        
        # Structure for drift check: unit_id -> type -> list of device_ids
        # Wait, neighbors are in the same building (area) but different unit.
        self.building_sensors = {} # area -> type -> list of (device_id, unit_id)
        
        self.simulator_online = True

    def update_model(self, model):
        self.device_catalog = model.get("device_types", {})
        
        # Extract all devices to know the structure for drift check
        self.building_sensors = {}
        for b_id, b_data in model.get("buildings", {}).items():
            self.building_sensors[b_id] = {}
            for ap_id, ap_data in b_data.get("apartments", {}).items():
                for dev_id, dev_type in ap_data.get("devices", {}).items():
                    if dev_type not in self.building_sensors[b_id]:
                        self.building_sensors[b_id][dev_type] = []
                    self.building_sensors[b_id][dev_type].append(dev_id)
                    
        # Update monitor config
        self.monitor_config = model.get("monitor", {})
        self.publisher.update_config(self.monitor_config)

    def get_or_create_device(self, device_id, area, unit_id, typ, kind):
        if device_id not in self.devices:
            config = self.device_catalog.get(typ, {})
            self.devices[device_id] = DeviceState(device_id, area, unit_id, typ, kind, config)
        return self.devices[device_id]

    def set_simulator_status(self, status):
        self.simulator_online = (status == "online")

    def process_raw(self, topic, payload):
        parts = topic.split('/')
        if len(parts) < 5:
            return
            
        area = parts[2]
        unit_id = parts[3]
        device_id = parts[4]
        
        # Determine kind and type from payload or catalog
        # Usually raw payload has type or we can infer it
        typ = payload.get("type", "unknown")
        # Ensure device config exists
        config = self.device_catalog.get(typ, {})
        if not config:
            # If not in catalog, fallback to determine from ID or payload
            pass
            
        kind = config.get("kind", "sensor")
        dev = self.get_or_create_device(device_id, area, unit_id, typ, kind)
        
        # Update time
        current_time = payload.get("timestamp", time.time())
        dev.last_time = current_time
        
        value = payload.get("value")
        
        # Rule 1: Format already mostly checked
        
        # Rule 2: Out of range
        if dev.valid_range and value is not None:
            if value < dev.valid_range[0] or value > dev.valid_range[1]:
                self._update_status(dev, "out_of_range", "Value outside valid_range")
                return # Discard
                
        # Rule 3: Stuck
        if dev.stuck_check and value is not None:
            if dev.last_value is not None and math.isclose(value, dev.last_value, rel_tol=1e-5):
                if dev.rest_value is None or not math.isclose(value, dev.rest_value, rel_tol=1e-5):
                    dev.consecutive_stuck += 1
                else:
                    dev.consecutive_stuck = 0
            else:
                dev.consecutive_stuck = 0
                
            stuck_limit = self.monitor_config.get("stuck_readings", 6)
            if dev.consecutive_stuck >= stuck_limit:
                self._update_status(dev, "stuck", "Value stuck for too long")
                payload["quality"] = "suspect"
            else:
                self._recover_status(dev, "stuck")
                
        # Rule 4: Drift (simplified for now, full implementation requires history and neighbors)
        # Sospensione deriva se smoke, gas o co sono alti
        suspension = False
        if dev.drift_check:
            # Check for emergencies in the same unit
            for e_typ in ["smoke", "gas", "co"]:
                e_id = f"{unit_id}.{e_typ}"
                if e_id in self.devices:
                    e_dev = self.devices[e_id]
                    if e_dev.last_value is not None and e_dev.rest_value is not None:
                        # Se è sopra il riposo + rumore
                        e_noise = self.device_catalog.get(e_typ, {}).get("noise", 0)
                        if e_dev.last_value > e_dev.rest_value + e_noise:
                            suspension = True
                            break
                            
            if not suspension:
                # Add to history and evaluate
                # [A complete drift logic would calculate median of neighbors, linear regression over drift_window_min]
                pass

        dev.last_value = value
        
        # Publish monitored
        if "quality" not in payload:
            payload["quality"] = "ok"
            
        monitored_topic = topic.replace("Complex/raw", "Complex/monitored")
        self.publisher.publish_monitored(monitored_topic, payload)

    def process_state(self, topic, payload):
        parts = topic.split('/')
        if len(parts) < 5:
            return
            
        area = parts[2]
        unit_id = parts[3]
        device_id = parts[4]
        
        typ = payload.get("type", "unknown")
        dev = self.get_or_create_device(device_id, area, unit_id, typ, "actuator")
        
        dev.last_time = payload.get("timestamp", time.time())
        self._recover_status(dev, "offline")
        
        monitored_topic = topic.replace("Complex/state", "Complex/monitored")
        self.publisher.publish_monitored(monitored_topic, payload)

    def check_offline(self):
        if not self.simulator_online:
            return
            
        current_time = time.time()
        offline_periods = self.monitor_config.get("offline_periods", 3)
        sampling_s = 10 # Default, should come from config
        
        offline_threshold = offline_periods * sampling_s
        actuator_threshold = 2 * 60 # 2 * actuator_state_period_s (default 60)
        
        for dev in self.devices.values():
            thresh = actuator_threshold if dev.kind == "actuator" else offline_threshold
            if current_time - dev.last_time > thresh:
                self._update_status(dev, "offline", "Device offline")

    def _update_status(self, dev, status, details=""):
        if dev.status != status:
            dev.status = status
            dev.consecutive_valid = 0
            self.publisher.publish_health(f"Complex/health/{dev.area}/{dev.unit_id}/{dev.type}", {
                "device_id": dev.device_id,
                "status": status,
                "details": details,
                "timestamp": time.time()
            })

    def _recover_status(self, dev, bad_status):
        if dev.status == bad_status:
            dev.consecutive_valid += 1
            rec_limit = self.monitor_config.get("recovery_readings", 3)
            if dev.consecutive_valid >= rec_limit:
                dev.status = "ok"
                self.publisher.publish_health(f"Complex/health/{dev.area}/{dev.unit_id}/{dev.type}", {
                    "device_id": dev.device_id,
                    "status": "ok",
                    "details": "Recovered",
                    "timestamp": time.time()
                })
