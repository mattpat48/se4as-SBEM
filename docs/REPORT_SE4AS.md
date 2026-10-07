# Autonomous Systems - Final Report (SE4AS)

## 1. Introduction
Brief introduction to the Smart Building project, its objectives, and the problems it aims to solve (e.g., energy efficiency, hazard detection, autonomous management).

## 2. Architecture & The MAPE-K Loop
The system implements a centralized intelligent control architecture based on the MAPE-K (Monitor-Analyze-Plan-Execute, plus Knowledge) reference model.

### 2.1 Monitor (M)
- **Components:** `simulator`, `sensors`, `monitor`
- **Role:** The `simulator` simulates the physical building. The `sensors` component generates realistic sensor data. The `monitor` component ingests raw MQTT data from sensors, validates it, calculates derived metrics, and stores the structured knowledge into the central database.

### 2.2 Analyze (A)
- **Components:** `analyzer`
- **Role:** Queries the knowledge base (InfluxDB) or listens to validated real-time data to identify trends, hazards (e.g., fire risks, gas leaks), and evaluate comfort levels. It raises alerts when the environment state violates predefined policies.

### 2.3 Plan (P)
- **Components:** `planner`, `nodered`
- **Role:** Subscribes to the alerts produced by the Analyzer. When a critical state (like a fire) is detected, it decides the necessary sequence of mitigation actions (e.g., turn on alarms, shut gas valves, evacuate). Node-RED is also used for orchestrating alerts and sending external notifications (e.g., Telegram).

### 2.4 Execute (E)
- **Components:** `planner` (executor logic), `ui`, `view`
- **Role:** The `executor` module inside the planner maps abstract actions to concrete MQTT commands sent back to the actuators in the `simulator`. The `ui` and `view` provide a dashboard and a 3D visualization to allow human operators to monitor execution and manually override if necessary.

### 2.5 Knowledge (K)
- **Components:** `influxdb`
- **Role:** Serves as the central repository for historical data, validated metrics, and analyzed risks. It is accessed by multiple components to maintain a shared understanding of the environment.

## 3. Implementation Details
(To be expanded)
- Docker Compose setup
- MQTT Communication scheme (`Complex/#` topic structure)
- Physics and simulation logic
- InfluxDB data schemas

## 4. Testing & Validation
(To be expanded)
- End-to-end tests for critical scenarios (Fire, Gas Leak)
- Evaluation of response latency
- UI and manual testing

## 5. Conclusion
(To be expanded)
Summary of achievements and future work.
