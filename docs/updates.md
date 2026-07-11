## What Changed Since the Original Project

This document summarizes everything added or changed after we started extending the original SE4IOT/SE4AS project. The goal of the changes is to move from a basic sensor/alert demo to a more complete MAPE-K smart building manager with runtime configurability, predictive planning, and emergency handling.

### 1. New runtime management capabilities

- Added a runtime configuration path so important parameters can be changed without stopping or rebuilding the system.
- Introduced MQTT-based retained updates for:
	- alert thresholds,
	- composite rule parameters,
	- planner policy parameters.
- Added a small runtime config service in `config/service.py` that listens to MQTT update topics and exposes the latest values to the Python services.

### 2. UI changes

- Expanded the Streamlit control panel in `ui/main.py`.
- The UI now lets operators:
	- manage locations and coordinates,
	- change sensor thresholds at runtime,
	- edit sensor density and sensor types,
	- configure composite rules such as fire-risk, CO2 persistence, and noise anomaly detection,
	- edit planner policies such as forecast horizon and proactive decision probability,
	- simulate emergencies and stop them at runtime.
- The UI publishes retained MQTT messages so the system can restore configuration after restart.

### 3. Analyzer changes

- Refactored the analyzer into a more structured implementation.
- Added `analyzer/engine.py` to manage:
	- short-term history windows,
	- threshold-based alerts,
	- composite-rule evaluation,
	- persistence of events into InfluxDB.
- Added `analyzer/rules.py` with rule logic for:
	- `fire_risk`,
	- `co2_persistence`,
	- `noise_anomaly`.
- The analyzer now writes emergency detections to the `emergencies` measurement in InfluxDB.
- Threshold updates received at runtime are also persisted to the `thresholds` measurement.

### 4. Planner changes

- Added a new planner service in `planner/plan.py`.
- Added `planner/predictor.py` for short-horizon forecasting.
- The planner now:
	- reads recent historical telemetry from InfluxDB,
	- reads the latest threshold values,
	- predicts whether a threshold breach is likely,
	- makes proactive decisions when the predicted risk is high,
	- writes planner decisions to the `planner_actions` measurement.
- Added MQTT actuator handling through `executor/mqtt_adapter.py`.
- The planner now supports both reactive and proactive actions.

### 5. New measurements and knowledge flow

- Added or used the following InfluxDB measurements for knowledge and auditing:
	- `sensors` for telemetry,
	- `thresholds` for runtime alert configuration,
	- `emergencies` for composite emergency detections,
	- `planner_actions` for decision auditing.
- The system now uses historical knowledge, not only current sensor values, when planning actions.

### 6. New service and deployment structure

- Added the `planner/` folder with its own Dockerfile and requirements.
- Added `executor/` support code for MQTT command/ack handling.
- Added `config/` for runtime configuration management.
- Updated `docker-compose.yml` to include the planner service.
- Updated requirements and container setup so the new services can run inside the stack.

### 6.1 Node-RED admin flow

- Added a Node-RED policy admin page at `/policy-admin`.
- The page lets operators edit:
	- alert thresholds,
	- composite rule parameters,
	- planner policies.
- The flow reads retained MQTT state, updates Node-RED runtime context, and republishes retained configuration messages so the rest of the system stays synchronized.

### 7. Changes to the control flow and architecture

- Node-RED remains the flow orchestrator for the system.
- Python services now focus on analysis, prediction, and decision-making, while Node-RED continues to handle integration flows and persistence logic.
- The overall architecture is now closer to a full MAPE-K loop:
	- Monitor: sensor telemetry,
	- Analyze: threshold and composite-rule evaluation,
	- Plan: predictive decision-making,
	- Execute: MQTT actuator commands,
	- Knowledge: InfluxDB plus retained MQTT configuration.

### 8. Emergency handling improvements

- Added a richer emergency simulation section in the UI.
- Added emergency event publishing on MQTT with retained messages.
- Added support for emergency persistence and visibility in the data flow.

### 9. What stayed the same

- MQTT is still the core communication mechanism.
- Node-RED is still the main orchestration layer.
- InfluxDB remains the time-series knowledge store.
- Grafana is still used for visualization.
- The project still uses the existing sensor simulation foundation, but now with more autonomous behavior around it.

### 10. Practical impact

- The system can now be tuned at runtime.
- The planner can react before thresholds are crossed, not only after alerts happen.
- Emergency and anomaly detection are no longer based only on single-sensor instant values.
- The project is now much closer to a complete smart-building autonomic manager rather than a basic monitoring demo.

