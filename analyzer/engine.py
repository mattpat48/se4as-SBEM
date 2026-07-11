import time
from collections import defaultdict, deque
from datastructure import THRESHOLDS
from influxdb_client import Point, WritePrecision
from rules import evaluate_all


class AnalyzerEngine:
    def __init__(self, influx_write_api=None, influx_bucket=None, influx_org=None, history_window_seconds=300):
        self.influx_write_api = influx_write_api
        self.influx_bucket = influx_bucket
        self.influx_org = influx_org

        # history: {(location, type): deque([...])}
        self.history = defaultdict(lambda: deque(maxlen=1000))
        # grouped by location -> type -> deque of samples
        self.history_by_location = defaultdict(lambda: defaultdict(lambda: deque(maxlen=1000)))

        # keep simple active_alerts similar to previous implementation
        self.active_alerts = {}
        self.history_window_seconds = history_window_seconds

    def _add_sample(self, location, data):
        # sample: value and timestamp (seconds)
        try:
            ts = int(float(data.timestamp))
        except Exception:
            ts = int(time.time())
        sample = {'value': float(data.value), 'timestamp': ts}
        self.history[(location, data.type)].append(sample)
        self.history_by_location[location][data.type].append(sample)

        # prune by time window
        cutoff = int(time.time()) - self.history_window_seconds
        for t, dq in list(self.history.items()):
            while dq and dq[0]['timestamp'] < cutoff:
                dq.popleft()

        for loc, types in self.history_by_location.items():
            for typ, dq in types.items():
                while dq and dq[0]['timestamp'] < cutoff:
                    dq.popleft()

    def process(self, client, location, data):
        """Process a new SensorData instance: threshold check, composite rules, persistence."""
        self._add_sample(location, data)

        # Threshold check
        threshold = THRESHOLDS.get(data.type)
        is_alerting = self.active_alerts.get(data.sensorid, False)
        if threshold is not None:
            if float(data.value) > float(threshold):
                if not is_alerting:
                    alert_msg = f"⚠️ ALERT: {data.sensorid} ({data.type}) at {location} detected {data.value:.2f} {data.unit} (Threshold: {threshold})"
                    client.publish(f"City/alerts/{location}/{data.type}", alert_msg, qos=1)
                    self.active_alerts[data.sensorid] = True
            else:
                if is_alerting:
                    alert_msg = f"✅ RECOVERY: {data.sensorid} ({data.type}) at {location} returned to normal {data.value:.2f} {data.unit}"
                    client.publish(f"City/alerts/{location}/{data.type}", alert_msg, qos=1)
                    self.active_alerts[data.sensorid] = False

        # Composite rules
        types_map = self.history_by_location[location]
        results = evaluate_all(types_map, location)
        for r in results:
            # publish composite alert
            msg = {
                'rule': r.name,
                'score': r.score,
                'details': r.details,
                'location': location,
                'timestamp': int(time.time())
            }
            client.publish(f"City/alerts/{location}/composite", json_dumps(msg), qos=1)

            # persist emergency to InfluxDB
            try:
                if self.influx_write_api is not None:
                    p = Point("emergencies").tag("type", r.name).tag("location", location).field("score", float(r.score)).time(int(time.time() * 1e9), WritePrecision.NS)
                    # add details as fields (where numeric)
                    for k, v in r.details.items():
                        try:
                            p.field(k, float(v))
                        except Exception:
                            pass
                    self.influx_write_api.write(bucket=self.influx_bucket, org=self.influx_org, record=p)
            except Exception as e:
                print(f"Error writing emergency to InfluxDB: {e}")


def json_dumps(obj):
    try:
        import json
        return json.dumps(obj)
    except Exception:
        return str(obj)
