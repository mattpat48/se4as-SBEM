import os
import json
import logging
import time
from threading import Lock
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

logger = logging.getLogger(__name__)

class Publisher:
    def __init__(self, mqtt_client, config=None):
        self.mqtt_client = mqtt_client
        self.config = config or {}
        
        self.influx_url = os.environ.get("INFLUXDB_URL", "http://influxdb:8086")
        self.influx_token = os.environ.get("INFLUXDB_TOKEN", "admin_token")
        self.influx_org = os.environ.get("INFLUXDB_ORG", "iot_org")
        self.influx_bucket = os.environ.get("INFLUXDB_BUCKET", "iot_bucket")
        
        self.influx_batch_size = self.config.get("influx_batch_size", 500)
        self.influx_flush_s = self.config.get("influx_flush_s", 1)
        self.influx_buffer_max = self.config.get("influx_buffer_max", 50000)

        self.influx_client = None
        self.write_api = None
        self._init_influx()
        
        self.buffer = []
        self.buffer_lock = Lock()
        self.last_flush = time.time()

    def _init_influx(self):
        try:
            self.influx_client = InfluxDBClient(url=self.influx_url, token=self.influx_token, org=self.influx_org)
            # Use synchronous write API and manage batching manually to handle network issues gracefully
            self.write_api = self.influx_client.write_api(write_options=SYNCHRONOUS)
            logger.info(f"Connected to InfluxDB at {self.influx_url}")
        except Exception as e:
            logger.error(f"Failed to connect to InfluxDB: {e}")

    def update_config(self, monitor_config):
        self.config = monitor_config
        self.influx_batch_size = self.config.get("influx_batch_size", 500)
        self.influx_flush_s = self.config.get("influx_flush_s", 1)
        self.influx_buffer_max = self.config.get("influx_buffer_max", 50000)

    def publish_monitored(self, topic, payload):
        # Publish to MQTT
        self.mqtt_client.publish(topic, json.dumps(payload))
        
        # Save to Influx
        kind = payload.get("kind", "sensor")
        measurement = "readings" if kind in ["sensor", "derived"] else "actuator_states"
        
        device_id = payload.get("device_id")
        # Ensure area and unit_id are extracted from topic if not present in payload
        # Topic format: Complex/monitored/<area>/<unit_id>/<type>
        parts = topic.split('/')
        if len(parts) >= 5:
            area = parts[2]
            unit_id = parts[3]
            typ = parts[4]
        else:
            return

        if kind in ["sensor", "derived"]:
            p = Point("readings") \
                .tag("device_id", device_id) \
                .tag("area", area) \
                .tag("unit_id", unit_id) \
                .tag("type", typ) \
                .tag("kind", kind) \
                .tag("unit", payload.get("unit", "")) \
                .tag("quality", payload.get("quality", "ok")) \
                .field("value", float(payload.get("value", 0)))
            
            if "sim_time" in payload:
                p = p.field("sim_time", str(payload.get("sim_time")))
                
            p = p.time(int(payload.get("timestamp", time.time()) * 1e9), WritePrecision.NS)
            self._add_to_buffer(p)
            
        elif kind == "actuator":
            p = Point("actuator_states") \
                .tag("device_id", device_id) \
                .tag("area", area) \
                .tag("unit_id", unit_id) \
                .tag("type", typ)
                
            # Add all state fields
            has_fields = False
            for k, v in payload.items():
                if k not in ["device_id", "timestamp", "sim_time", "kind"]:
                    if isinstance(v, (int, float, str, bool)):
                        p = p.field(k, v)
                        has_fields = True
            
            p = p.time(int(payload.get("timestamp", time.time()) * 1e9), WritePrecision.NS)
            if has_fields:
                self._add_to_buffer(p)

    def publish_health(self, topic, payload):
        self.mqtt_client.publish(topic, json.dumps(payload), retain=True)
        
        parts = topic.split('/')
        if len(parts) >= 5:
            area = parts[2]
            unit_id = parts[3]
            typ = parts[4]
        else:
            return

        p = Point("device_health") \
            .tag("device_id", payload.get("device_id")) \
            .tag("area", area) \
            .tag("unit_id", unit_id) \
            .tag("type", typ) \
            .tag("status", payload.get("status")) \
            .field("details", payload.get("details", "")) \
            .time(int(payload.get("timestamp", time.time()) * 1e9), WritePrecision.NS)
            
        self._add_to_buffer(p)

    def _add_to_buffer(self, point):
        with self.buffer_lock:
            if len(self.buffer) >= self.influx_buffer_max:
                # Drop oldest
                self.buffer.pop(0)
            self.buffer.append(point)

    def flush(self):
        with self.buffer_lock:
            if not self.buffer:
                return
            points_to_write = self.buffer[:self.influx_batch_size]
        
        try:
            if self.write_api:
                self.write_api.write(bucket=self.influx_bucket, record=points_to_write)
                
                with self.buffer_lock:
                    self.buffer = self.buffer[len(points_to_write):]
                self.last_flush = time.time()
        except Exception as e:
            logger.error(f"Failed to write to InfluxDB: {e}")
            # Keep in buffer to retry later

    def check_flush(self):
        if time.time() - self.last_flush >= self.influx_flush_s:
            self.flush()
