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
        if isinstance(model.get("buildings"), dict):
            for b_id, b_data in model.get("buildings", {}).items():
                self.building_sensors[b_id] = {}
                for ap_id, ap_data in b_data.get("apartments", {}).items():
                    for dev_id, dev_type in ap_data.get("devices", {}).items():
                        if dev_type not in self.building_sensors[b_id]:
                            self.building_sensors[b_id][dev_type] = []
                        self.building_sensors[b_id][dev_type].append(dev_id)
        elif isinstance(model.get("units"), list):
            for unit in model.get("units", []):
                u_id = unit.get("id")
                u_kind = unit.get("kind")
                u_area = unit.get("area")
                if u_kind == "building" and u_id:
                    self.building_sensors.setdefault(u_id, {})
                elif u_kind == "apartment" and u_area and u_id:
                    b_map = self.building_sensors.setdefault(u_area, {})
                    for s_type in unit.get("sensors", []):
                        b_map.setdefault(s_type, []).append(f"{u_id}.{s_type}")
                    
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
        topic_type = parts[4]
        
        typ = payload.get("type") or topic_type
        device_id = payload.get("device_id") or f"{unit_id}.{typ}"
        config = self.device_catalog.get(typ, {})
            
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
                
        # Rule 4: Drift (compare against building neighbor median and divergence slope over drift_window_min)
        suspension = False
        if dev.drift_check and value is not None:
            # Check for emergencies in the same unit
            for e_typ in ["smoke", "gas", "co"]:
                e_id = f"{unit_id}.{e_typ}"
                if e_id in self.devices:
                    e_dev = self.devices[e_id]
                    if e_dev.last_value is not None and e_dev.rest_value is not None:
                        e_noise = self.device_catalog.get(e_typ, {}).get("noise", 0)
                        if e_dev.last_value > e_dev.rest_value + e_noise:
                            suspension = True
                            break

            if not suspension:
                neighbor_vals = sorted(
                    float(other.last_value)
                    for other in self.devices.values()
                    if other.area == area
                    and other.type == typ
                    and other.unit_id != unit_id
                    and not other.unit_id.endswith("-S")
                    and other.last_value is not None
                    and other.status == "ok"
                )
                median_neighbor = (
                    neighbor_vals[len(neighbor_vals) // 2] if neighbor_vals else None
                )
                window_s = float(self.monitor_config.get("drift_window_min", 20)) * 60.0
                dev.history.append((current_time, float(value), median_neighbor))
                dev.history = [entry for entry in dev.history if current_time - entry[0] <= window_s]

                if median_neighbor is not None and len(dev.history) >= 3:
                    delta_map = self.monitor_config.get("drift_delta", {"temperature": 2.0, "humidity": 8.0, "co2": 300.0})
                    slope_map = self.monitor_config.get("drift_slope", {"temperature": 0.1, "humidity": 0.5, "co2": 20.0})
                    delta_thresh = float(delta_map.get(typ, 2.0))
                    slope_thresh = float(slope_map.get(typ, 0.1))

                    curr_diff = float(value) - median_neighbor
                    t0, v0, m0 = dev.history[0]
                    dt_min = (current_time - t0) / 60.0
                    if dt_min >= 0.25:
                        init_diff = v0 - (m0 if m0 is not None else median_neighbor)
                        div_slope = (abs(curr_diff) - abs(init_diff)) / dt_min
                        if abs(curr_diff) >= delta_thresh and div_slope >= slope_thresh:
                            self._update_status(
                                dev,
                                "drift",
                                f"Sensor drift detected (delta={curr_diff:.2f}, slope={div_slope:.2f}/min)",
                            )
                            payload["quality"] = "suspect"
                        elif abs(curr_diff) < delta_thresh * 0.7:
                            self._recover_status(dev, "drift")
                        elif dev.status == "drift":
                            payload["quality"] = "suspect"

        dev.last_value = value
        
        # Publish monitored
        payload["device_id"] = device_id
        payload["type"] = typ
        payload["kind"] = kind
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
        topic_type = parts[4]
        
        typ = payload.get("type") or topic_type
        device_id = payload.get("device_id") or f"{unit_id}.{typ}"
        dev = self.get_or_create_device(device_id, area, unit_id, typ, "actuator")
        
        dev.last_time = payload.get("timestamp", time.time())
        dev.last_value = payload.get("state")
        dev.power_w = payload.get("power_w", 0.0)
        self._recover_status(dev, "offline")
        
        payload["device_id"] = device_id
        payload["type"] = typ
        payload["kind"] = "actuator"
        if "quality" not in payload:
            payload["quality"] = "ok"
        
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
