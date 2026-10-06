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
        
        # Store latest valid state
        if payload.get("quality", "ok") == "ok":
            if "value" in payload:
                self.current_state[area][unit_id][typ] = payload["value"]
            # For actuators, store state too if needed
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
        for area, units in self.current_state.items():
            area_comfort_sum = 0
            area_comfort_count = 0
            area_risks = []
            
            for unit_id, sensors in units.items():
                if area == "park" or area == "complex":
                    continue # Comfort mainly for indoor spaces
                    
                # 1. Calculate Comfort
                comfort_score, comfort_details = calculate_comfort(sensors)
                if comfort_score is not None:
                    area_comfort_sum += comfort_score
                    area_comfort_count += 1
                    
                    payload = {
                        "area": area,
                        "unit_id": unit_id,
                        "comfort_score": comfort_score,
                        "details": comfort_details,
                        "timestamp": current_time
                    }
                    client.publish(f"Complex/analysis/{area}/{unit_id}/comfort", json.dumps(payload), retain=True)

                # 2. Evaluate Risks
                risks = evaluate_risks(sensors, self.model)
                for risk in risks:
                    area_risks.append(risk)
                    payload = {
                        "area": area,
                        "unit_id": unit_id,
                        "risk": risk["name"],
                        "severity": risk["severity"],
                        "details": risk["details"],
                        "timestamp": current_time
                    }
                    client.publish(f"Complex/analysis/{area}/{unit_id}/risk/{risk['name']}", json.dumps(payload), retain=True)
            
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
                # Deduplicate or aggregate risks if needed
                payload = {
                    "area": area,
                    "active_risks": area_risks,
                    "timestamp": current_time
                }
                client.publish(f"Complex/analysis/{area}/aggregate/risks", json.dumps(payload), retain=True)
