import time
import json
import logging
from collections import defaultdict
from rules import calculate_comfort, evaluate_risks

logger = logging.getLogger(__name__)

class AnalyzerEngine:
    def __init__(self):
        self.model = {}
        # current_state: area -> unit_id -> type -> value
        self.current_state = defaultdict(lambda: defaultdict(dict))
        self.health_state = defaultdict(lambda: defaultdict(dict))
        self.active_risks = defaultdict(lambda: defaultdict(set))
        self.initialized_units = set()
        self.last_analysis_time = 0

    def update_model(self, model):
        self.model = model
        logger.info("Model updated in Analyzer")

    def process_monitored(self, client, topic, payload):
        parts = topic.split('/')
        if len(parts) < 5:
            return
            
        area = parts[2]
        unit_id = parts[3]
        typ = parts[4]
        
        # Store latest valid state (or suspect for emergency sensors per safety principle D17)
        quality = payload.get("quality", "ok")
        if quality == "ok" or (quality == "suspect" and typ in ("smoke", "gas", "co", "seismic")):
            if "value" in payload:
                self.current_state[area][unit_id][typ] = payload["value"]
            elif payload.get("kind") == "actuator":
                self.current_state[area][unit_id][typ] = payload

    def process_health(self, client, topic, payload):
        parts = topic.split('/')
        if len(parts) < 5:
            return
            
        area = parts[2]
        unit_id = parts[3]
        typ = parts[4]
        
        self.health_state[area][unit_id][typ] = payload.get("status", "ok")

    def run_periodic_analysis(self, client):
        current_time = time.time()
        
        # Process each unit independently
        for area, units in list(self.current_state.items()):
            area_comfort_sum = 0
            area_comfort_count = 0
            area_risks = []
            
            for unit_id, sensors in list(units.items()):
                if area == "complex":
                    continue
                    
                # 1. Calculate Comfort (for indoor spaces)
                if area != "park":
                    comfort_score, comfort_details = calculate_comfort(sensors)
                    if comfort_score is not None:
                        area_comfort_sum += comfort_score
                        area_comfort_count += 1
                        
                        sensor_snapshot = {
                            k: v for k, v in sensors.items()
                            if isinstance(v, (int, float))
                        }
                        payload = {
                            "area": area,
                            "unit_id": unit_id,
                            "comfort_score": comfort_score,
                            "details": comfort_details,
                            "sensors": sensor_snapshot,
                            "timestamp": current_time
                        }
                        client.publish(f"Complex/analysis/{area}/{unit_id}/comfort", json.dumps(payload), retain=True)

                # 2. Evaluate Risks
                risks = evaluate_risks(sensors, self.model)
                current_risk_names = set()
                for risk in risks:
                    r_name = risk["name"]
                    current_risk_names.add(r_name)
                    area_risks.append({**risk, "unit_id": unit_id})
                    payload = {
                        "area": area,
                        "unit_id": unit_id,
                        "risk": r_name,
                        "severity": risk["severity"],
                        "details": risk["details"],
                        "timestamp": current_time
                    }
                    client.publish(f"Complex/analysis/{area}/{unit_id}/risk/{r_name}", json.dumps(payload), retain=True)
                
                # Clear previously active risks that have now subsided (and clear stale retained broker risks on first pass)
                prev_risks = set(self.active_risks[area][unit_id])
                if (area, unit_id) not in self.initialized_units:
                    self.initialized_units.add((area, unit_id))
                    prev_risks |= {"fire", "gas_co_leak"} if area != "park" else {"earthquake"}
                for cleared_name in (prev_risks - current_risk_names):
                    clear_payload = {
                        "area": area,
                        "unit_id": unit_id,
                        "risk": cleared_name,
                        "severity": 0,
                        "details": {},
                        "timestamp": current_time
                    }
                    client.publish(f"Complex/analysis/{area}/{unit_id}/risk/{cleared_name}", json.dumps(clear_payload), retain=True)
                self.active_risks[area][unit_id] = current_risk_names
            
            # 3. Hierarchical Aggregation for Building (area)
            if area_comfort_count > 0:
                avg_comfort = area_comfort_sum / area_comfort_count
                payload = {
                    "area": area,
                    "average_comfort": avg_comfort,
                    "timestamp": current_time
                }
                client.publish(f"Complex/analysis/{area}/aggregate/comfort", json.dumps(payload), retain=True)
                
            if area_risks:
                payload = {
                    "area": area,
                    "active_risks": area_risks,
                    "timestamp": current_time
                }
                client.publish(f"Complex/analysis/{area}/aggregate/risks", json.dumps(payload), retain=True)
