## Smart Building Environmental Manager (Full Management + Emergency Handling)

## 1. Goal of the system

The system has three coordinated goals:

- Maintain comfort and livability in all managed rooms (thermal, air quality, visual, and acoustic comfort).
- Optimize operational efficiency (energy, ventilation, and lighting usage).
- Guarantee safety through automatic detection and response to potential emergencies (fire risk, poor air quality risk, and abnormal crowd/noise behavior).

In short, the objective is not only comfort control, but full building condition management with autonomous adaptation.

## 2. Managed resources

The system manages both physical and logical resources.

### Physical managed resources

- Rooms, floors, and common areas.
- HVAC subsystems (heating/cooling setpoints, airflow, fan speed).
- Mechanical ventilation or fresh-air intake.
- Motorized windows and blinds.
- Smart lighting controllers.
- Alarm and notification devices (sirens, panel messages, emergency channels).

### Logical managed resources

- Per-room policies (comfort profile, occupancy profile, priority level).
- Emergency policies (evacuation mode, ventilation strategy, alarm routing).
- Threshold configuration (normal mode vs emergency mode).
- Historical telemetry and derived indicators used for adaptation.

## 3. Sensors and effectors (managed resource touchpoints)

### Sensors

- Temperature sensors.
- Relative humidity sensors.
- CO2 / indoor air quality sensors.
- Noise level sensors.
- Light level sensors.
- Occupancy presence sensors (PIR, badge events, or camera-free counters).
- Optional safety sensors for emergency handling:
	- Smoke detector state.
	- Heat detector state.
	- Door/window contact state.

### Effectors

- HVAC commands:
	- Temperature setpoint update.
	- Fan speed control.
	- Airflow profile selection.
- Ventilation commands:
	- Increase/decrease fresh-air exchange.
- Lighting commands:
	- Dimming level.
	- Area on/off schedules.
- Envelope commands:
	- Window open/close.
	- Blind angle/position.
- Safety and emergency commands:
	- Activate/deactivate alarms.
	- Trigger emergency notification workflows.
	- Switch rooms or zones to emergency operating mode.

## 4. Architectural pattern for the autonomic manager

- Building-level manager:
	- Maintains global goals, policies, and safety priorities.
	- Resolves conflicts across zones (for example, energy optimization vs emergency ventilation).
- Zone/room-level managers:
	- Execute local adaptation loops with low latency.
	- Apply room-specific policies and device commands.

This pattern supports scalability and fault isolation while still enabling coherent building-wide behavior.

## 5. MAPE-K loop realization

### Monitor

The previous monitoring system, introduces in the SE4IOT exam, will be re-used, after all the necessary adaptations. It already includes many sensors of the ones cited above and already uses MQTT as the communication technology.

### Analyzer

- Computes room-level and building-level indicators.
- Detects threshold violations and trend anomalies.
- Computes composite risk indicators for emergency scenarios.

Examples of analyzed characteristics:

- Comfort index (from temperature, humidity, CO2, light, noise, occupancy).
- Air quality stress score (CO2 trend + persistence).
- Fire risk proxy (high temperature growth + low humidity + smoke/noise anomaly if available).
- Operational anomaly indicators (sensor drift, impossible value combinations).

Possible approaches:

- Rule-based analysis for deterministic and explainable behavior.
- Optional anomaly detection layer (for example, Isolation Forest or seasonal baseline deviation) as future extension.

### Planner

- Selects adaptation actions based on analyzer output and policy constraints.
- Prioritizes safety over comfort and comfort over optimization.
- Produces a sequence of actions with rollback or timeout conditions.

Example planning logic:

- Comfort mode: adjust HVAC and lighting with minimal energy overhead.
- Air quality event: increase ventilation, then reassess after a fixed interval.
- Emergency mode: override normal policies, activate alarm workflow, apply predefined safe-state actions.

### Executor

- Sends commands to devices and services.
- Tracks command acknowledgement, retries, and fallback actions.
- Logs execution outcomes for audit and learning.

Possible technologies:

- MQTT command topics for actuators.
- BACnet or Modbus gateway integration for real building systems.
- Home Assistant or openHAB as optional actuator abstraction layer.

### Knowledge

The knowledge base stores static and dynamic knowledge used by all MAPE phases.

- Building model:
	- Rooms, floors, adjacency, evacuation-critical zones.
- Device model:
	- Sensor/effector capabilities and constraints.
- Policy model:
	- Comfort policies, occupancy profiles, safety constraints, emergency playbooks.
- Runtime knowledge:
	- Historical trends, learned baselines, action outcomes.

Possible representation:

- YAML/JSON policy files for initial implementation.
- Relational or document storage for room/device metadata.
- Time-series storage for runtime observations.

## 6. Adaptation goals of the autonomic manager

The adaptation strategy is multi-objective and context-sensitive.

- Comfort adaptation:
	- Keep room conditions inside defined comfort envelopes.
- Efficiency adaptation:
	- Minimize unnecessary HVAC and lighting usage.
- Safety adaptation:
	- Detect and handle hazardous conditions with strict priority.

Priority order:

1. Safety
2. Availability of essential services
3. Comfort
4. Energy optimization

## 7. Decision-function approach

The baseline decision function is rule-based with policy priorities.

Why this approach:

- Explainable and easy to validate with the professor.
- Fast to prototype and robust for deterministic control.
- Naturally maps to emergency procedures and compliance-oriented behavior.

Example rule patterns:

- If CO2 is above threshold for more than N minutes and occupancy is high, then increase ventilation level by one step.
- If room is unoccupied for N minutes, then reduce HVAC and lighting to economy profile.
- If emergency risk score exceeds a critical threshold, then activate emergency mode, issue alarms, and apply safe-state actuator set.

Future extension:

- Hybrid rule + predictive optimization for better energy-performance trade-offs.

## 8. Real technologies and practical implementation path

A concrete implementation can follow these technologies:

- Messaging and integration:
	- Eclipse Mosquitto (MQTT broker).
	- Node-RED for orchestration and integration flows.
- Data layer:
	- InfluxDB for time-series telemetry.
	- Optional PostgreSQL for metadata and policy versions.
- Monitoring and visualization:
	- Grafana dashboards for comfort, energy, and safety KPIs.
- Autonomic manager services:
	- Python services for analyzer/planner/executor logic.
	- Rule engines using plain Python policy modules, or Drools-like pattern if needed later.
- Building protocols and automation:
	- BACnet/Modbus gateway (when integrating real BMS devices).
	- Home Assistant/openHAB adapters for heterogeneous devices.
- Alerting:
	- Telegram, email, or internal incident webhook channels.

## 9. Validation plan for the proposal

To make the step-1 proposal concrete, the team can state clear validation criteria:

- Comfort KPI:
	- Percentage of time each room remains in comfort envelope.
- Efficiency KPI:
	- Reduction of HVAC active time in low-occupancy periods.
- Safety KPI:
	- Detection latency for emergency scenarios.
	- False positive and false negative rates for risk alerts.
- Autonomy KPI:
	- Percentage of events handled without manual intervention.

## 10. Simulation Model

Finally, a small simulation model (hopefully 3D) will be provided. It will represent a group of buildings and/or a group of apartments and it will be possible to observe in real time how they react to the different environmental conditions and how the autonomic manager will adapt to them. The simulation model will be used to validate the proposed system and to demonstrate its capabilities in a controlled environment.