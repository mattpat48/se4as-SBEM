# Autonomous Systems - Final Report (SE4AS)

## 1. Introduction & Goals of the System
The objective of this project is the design and implementation of an autonomic management system for a smart residential complex ("Residenza Parco"), adhering to the principles of Autonomic Computing and Self-Adaptive Systems. 

The primary goals of the autonomic manager are:
1. **Safety & Hazard Mitigation**: Protect lives and property by autonomously detecting and mitigating emergency events (fires, gas leaks, carbon monoxide accumulation, seismic shocks).
2. **Environmental Quality & Human Comfort**: Maintain optimal living conditions (indoor temperature, humidity, CO₂ levels, acoustic comfort, and natural lighting).
3. **Energy Efficiency & Resource Optimization**: Balance active HVAC/ventilation usage with passive controls (motorized windows, blinds) and manage microgrid elements (solar PV, battery storage, EV charging).

---

## 2. Managed Resources, Sensors, and Effectors

In accordance with Autonomic Computing foundations, the system cleanly separates the **Autonomic Manager** (MAPE-K loop) from the **Managed Resources** through standardized touchpoints (sensors and effectors over MQTT).

### 2.1 Managed Resources
The managed resource is the physical/simulated residential complex, modeled hierarchically:
1. **Private Living Units (Apartments `A-1`, `A-2`, etc.)**: Individual residential units where comfort, air quality, and personal safety are managed.
2. **Common Building Infrastructure (Stairwells `A-S`, Elevators)**: Shared vertical transit and evacuation routes.
3. **Complex-Level & Outdoor Infrastructure (`park`)**: Shared perimeter infrastructure, community grounds, and the local microgrid.

### 2.2 Sensors (Monitoring Touchpoints)
Sensors provide observability over the state of the managed resources by publishing measurements to `Complex/monitored/<area>/<unit_id>/<type>`:

* **Indoor Climate & Comfort**:
  * `temperature` (°C, valid range -40 to 150 °C)
  * `humidity` (%, valid range 0 to 100 %)
  * `co2` (ppm, indoor air quality)
  * `light` (lux, ambient brightness)
  * `noise_level` (dB, acoustic comfort)
* **Hazard & Life Safety**:
  * `smoke` (% obscuration)
  * `gas` (%LEL, lower explosive limit)
  * `co` (ppm, carbon monoxide concentration)
  * `seismic` (Mw, ground motion detection)
* **Energy, Resources & Occupancy**:
  * `power` (W, aggregate unit power consumption)
  * `pv_power` (W, solar photovoltaic production)
  * `water_flow` (L/min) and `gas_flow` (m³/h)
  * `occupancy` (resident count per unit)
* **Environmental / Weather**:
  * `rain_level` (mm/h), `wind_speed` (km/h), `soil_moisture` (%)

### 2.3 Effectors / Actuators (Execution Touchpoints)
Effectors receive adaptation commands from the autonomic manager via `Complex/cmd/<area>/<unit_id>/<actuator_type>`:

| Subsystem | Effector / Actuator | Commands & Parameters | Role & Safety Tier |
| :--- | :--- | :--- | :--- |
| **Indoor Climate** | `hvac` | `mode: off / heat / cool`, `setpoint: 16-30°C` | Continuous thermal regulation |
| **Air Quality** | `ventilation` (VMC)<br>`window` | `level: 0..3`<br>`position: open / closed` | Passive & active ventilation |
| **Lighting & Shading** | `blinds`<br>`lights` / `park_lights` | `position: 0..100%`<br>`level: 0..100%` / `state: on / off` | Natural illumination & privacy |
| **Safety & Life Protection** | `gas_valve`<br>`smoke_vent`<br>`alarm` / `evacuation_siren`<br>`resident_display` | `position: open / closed`<br>`position: open / closed`<br>`siren: on / off`<br>`message: str, level: info/warning/danger` | **Essential (Safety-Critical)**:<br>Automatic isolation, smoke clearing, resident warning |
| **Common Building** | `elevator`<br>`evacuation_signs` | `mode: normal / recall`<br>`state: on / off` | Ground-floor recall during fire; guidance during evacuation |
| **Microgrid** | `battery`<br>`ev_charger` | `mode: charge / discharge / idle`<br>`mode: charge / pause`, `max_power_w: int` | Peak shaving & solar self-consumption |

### 2.4 Touchpoint Interaction Architecture

```
   ┌────────────────────────────────────────────────────────────┐
   │            MANAGED RESOURCE (Residential Complex)          │
   │   Apartments (A-1..) │ Common Spaces (A-S..) │ Park/Microgrid│
   └───────────────┬────────────────────────────▲───────────────┘
                   │ Sensor Readings            │ Actuator Commands
                   ▼ (Touchpoint: M)            │ (Touchpoint: E)
   ┌────────────────────────────────────────────────────────────┐
   │             MQTT Message Broker (Mosquitto)                │
   │     Topics: Complex/monitored/...    Complex/cmd/...       │
   └───────────────┬────────────────────────────▲───────────────┘
                   │                            │
                   ▼                            │
   ┌────────────────────────────────────────────────────────────┐
   │                   AUTONOMIC MANAGER                        │
   │                                                            │
   │   ┌───────────────┐     ┌───────────────┐     ┌─────────┐  │
   │   │  Monitor (M)  ├────►│  Analyze (A)  ├────►│Plan (P) │  │
   │   └───────┬───────┘     └───────┬───────┘     └───┬─────┘  │
   │           │                     │                 │        │
   │           ▼                     ▼                 │        │
   │   ┌─────────────────────────────────────┐         ▼        │
   │   │            Knowledge (K)            │    ┌──────────┐  │
   │   │  InfluxDB (Historical & Derived)   │    │Execute(E)│──┘
   │   │  Topological Models (complex.json)  │    └──────────┘  │
   │   └─────────────────────────────────────┘                  │
   └────────────────────────────────────────────────────────────┘
```

---

## 3. Architecture & The MAPE-K Loop

The system implements an Autonomic Manager structured according to the classic MAPE-K model:

### 3.1 Monitor (M)
* **Components:** `simulator`, `monitor`
* **Role:**
  * Ingests physical stream from `Complex/sim/#`.
  * Performs data validation (range verification, stuck sensor detection, drift detection).
  * Computes immediate derived metrics (e.g. combined fire indicators, indoor air quality indices).
  * Publishes clean, timestamped records to `Complex/monitored/#` and writes time-series records into `influxdb`.

### 3.2 Analyze (A)
* **Components:** `analyzer`
* **Role:**
  * Maintains an in-memory representation of building state.
  * Evaluates health status, calculates localized comfort indices, and detects active hazards (fire, gas leaks, toxic CO accumulation).
  * Performs hierarchical aggregation (apartment $\to$ floor $\to$ building).
  * Publishes analysis results to `Complex/analysis/#`.

### 3.3 Plan (P)
* **Components:** `planner`
* **Role:**
  * Evaluates system goals and analysis feeds.
  * Translates detected anomalies and environmental shifts into concrete, sequenced adaptation actions.
  * Incorporates a two-tier decision function: safety shielding for life-critical events, and utility-based optimization for environmental changes.

### 3.4 Execute (E)
* **Components:** `planner/executor` (MQTT Adapter), `view` (3D Digital Twin visualization)
* **Role:**
  * Converts planned actions into concrete command messages conforming to the effector schemas.
  * Dispatches commands to `Complex/cmd/<area>/<unit_id>/<actuator_type>`.
  * The 3D view renders live actuator and environmental states for human oversight.

### 3.5 Knowledge (K)
* **Components:** `influxdb`, `config/complex.json`, Grafana
* **Role:**
  * Stores topological layout, unit profiles, sensor/actuator metadata, and thresholds.
  * Retains time-series history for trend analysis, auditing, and predictive model training.

---

## 4. Decision Function & Autonomic Planning Strategy

A central requirement in Self-Adaptive Systems is defining the approach used to develop the **decision function** of the Autonomic Manager (ref: course taxonomy on self-adaptive systems and decision functions). 

For this system, we adopt a **Two-Tier Hybrid Decision Architecture**:

```
                       [Analysis Ingestion]
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Tier 1: SAFETY SHIELD│
                     │  (Deterministic ECA) │
                     └──────────┬──────────┘
                                │
                 Is Life-Critical Hazard Detected?
               (Fire, Gas Leak, Toxic CO Spikes)
                                │
               ┌────────────────┴────────────────┐
               │ YES                             │ NO
               ▼                                 ▼
   ┌──────────────────────┐         ┌───────────────────────────────┐
   │ Immediate Emergency  │         │ Tier 2: UTILITY-BASED PLANNER │
   │ Hard-Coded Sequence  │         │   (Goal-Driven Optimization)  │
   │  (Siren, Gas Shut,   │         │                               │
   │   Vents, Recall)     │         │ • Generates Candidate Plans   │
   └──────────┬───────────┘         │ • Predicts Future Dynamics    │
              │                     │ • Evaluates Multi-Goal Utility│
              │                     │ • Selects Optimal Action Plan │
              │                     └───────────────┬───────────────┘
              │                                     │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
                        [Execute via MQTT]
```

### 4.1 Tier 1: Safety Shielding (Deterministic Event-Condition-Action)
* **Approach**: Rule-Based / Event-Condition-Action (ECA).
* **Target Domain**: Life-safety emergencies (fire detection, combustible gas leaks, structural/seismic events).
* **Rationale**:
  * Safety-critical operations cannot tolerate non-deterministic delays, exploration errors, or black-box misclassifications.
  * Strict safety invariants must be formally verifiable and guaranteed (e.g., $P(\text{gas\_valve} = \text{closed} \mid \text{gas\_leak}) = 1.0$).
  * Execution operates with pre-emptive priority over comfort or energy goals.

### 4.2 Tier 2: Environmental Adaptation (Utility-Based Model-Predictive Planning)
* **Approach**: Goal-Driven / Utility-Based Decision Function with Learned System Dynamics.
* **Target Domain**: Adaptation to continuous environmental changes (outdoor temperature shifts, solar radiation, occupant arrival/departure, rising indoor CO₂).
* **Core Rationale & Comparison with Alternatives**:
  * *Why not pure rule-based?* Hard-coded threshold rules ("if $T > 25^\circ C$ then AC ON") fail to balance trade-offs. They treat opening an energy-free window the same as engaging a 1500W HVAC unit, leading to excessive energy waste.
  * *Why not end-to-end Reinforcement Learning (Q-learning)?* RL requires thousands of simulation exploration steps where random, oscillating, or uncomfortable actions may be chosen. It suffers from slow convergence and lacks the transparency needed for rigorous verification.
  * *Why Utility-Based Planning is Optimal*: It explicitly formulates adaptation as a **multi-objective trade-off problem** between user comfort and power consumption, providing total explainability and deterministic bounds.

### 4.3 Detailed Architecture of the Decision & Learning Components

The implementation of the decision function is divided across modular Python components in the [`planner/`](planner/) subsystem:

1. **`SurrogateTransitionModel` ([`planner/predictor.py`](planner/predictor.py))**:
   * **Physics-Informed Prior Regularization**: Employs Ridge / Recursive Least Squares (RLS) regression with physical prior weights $\theta_0$ for thermal conduction, window ventilation, solar gain, and HVAC heating/cooling capacities:
     $$\theta = (X^T X + \lambda I)^{-1}(X^T y + \lambda \theta_0)$$
   * **Batch Learning from Knowledge (InfluxDB)**: On startup and periodically (every 10 minutes), the model queries InfluxDB (`iot_bucket`) for time-series measurements (`readings` and `actuator_states`). It reconstructs historical transitions ($s_t \to s_{t+\Delta t}$) across all building units and updates the model's sufficient statistics $(A = X^T X, b = X^T y)$.
   * **Online Streaming Adaptation (MQTT)**: Real-time sensor readings (`temperature`, `humidity`, `co2`) from `Complex/monitored/#` are synchronized per unit cycle. Transition rates are weighted by interval duration $w = \min(1.0, (\Delta t / 0.25)^2)$ to prevent short-interval sensor noise from distorting parameters.
   * **Thermostat Deadband & Constraint Clamping**: The model strictly enforces sign invariants (e.g., cooling capacity $\le 0$, heating capacity $\ge 0$) and accounts for the simulator's $\pm 0.5^\circ\text{C}$ HVAC deadband cutoff to eliminate setpoint chattering.

2. **`UtilityPlanner` ([`planner/predictor.py`](planner/predictor.py))**:
   * **Candidate Plan Generation**: For any apartment state, evaluates candidate actions: `keep_current`, `passive_cooling` (windows open, blinds 50%), `natural_air_flush` (windows open, VMC 2), `ventilation_boost` (windows closed, VMC 3), `active_cooling` (HVAC cool at 24°C), `active_heating` (HVAC heat at 23°C), `solar_shading` (blinds down to 20%), and `eco_standby`.
   * **Multi-Attribute Utility Function**:
     $$U(a) = w_{\text{comfort}} \cdot \text{ComfortScore}(\hat{s}_{t+\Delta t}) - w_{\text{energy}} \cdot \frac{\text{Power}(a)}{\text{Power}_{\text{max}}} - w_{\text{wear}} \cdot \Delta\text{Actuator}(a)$$
     where parameters are loaded from [`config/policies.json`](config/policies.json) ($w_{\text{comfort}}=0.60, w_{\text{energy}}=0.30, w_{\text{wear}}=0.10$).
   * **Fault-Tolerant Re-routing**: When an actuator is detected as faulty (e.g., window stuck closed), the planner locks that device to its effective state and evaluates alternative effectors (e.g., falling back to active cooling or VMC boost).

3. **`TwoTierPlanner` ([`planner/plan.py`](planner/plan.py))**:
   * **Tier 1 Pre-emption**: Subscribes to `Complex/analysis/+/+/risk/+`. Hazards (`fire`, `gas_co_leak`, `earthquake`) trigger immediate, high-priority mitigation sequences, completely pre-empting Tier 2 comfort planning for affected units.
   * **Multi-Hazard Conflict Resolution**: Enforces safety hierarchies (e.g., in simultaneous fire and gas leak, fire oxygen starvation overrides gas leak window opening; upon fire clearance, gas leak mitigation is immediately re-evaluated).
   * **Silent Fault Detection**: Automatically detects `no_ack` timeouts and silent `no_effect` faults (where the simulator returns status `ok` but the physical temperature or power draw contradicts the declared state).
   * **Microgrid & EV Charger Peak Shaving**: Regulates building battery storage and throttles/pauses EV chargers (`EV-A`..`EV-D`) during grid deficit conditions (`energy_balance < -4000 W`).

---

## 5. Architectural Patterns & Autonomic Computing Taxonomy

Referencing the classification framework of Autonomic Systems:
* **Coordination Pattern**: Hierarchical & Decentralized. Local autonomic units govern individual apartments (decentralized comfort and gas safety), while building-level coordinators supervise shared common infrastructure (stairwell vents, central evacuation signs, elevators).
* **Autonomic Degree**: Fully autonomous (closed-loop self-adaptation with human-on-the-loop visualization via 3D digital twin).
* **Adaptation Timing**: Proactive (forecasting comfort breaches and pre-empting spikes) combined with Reactive (emergency reflex).

---

## 6. Testing, Validation & Empirical Results

The system has been subjected to rigorous, repeatable testing across two distinct test suites: an in-depth unit/integration suite covering the MAPE-K loop and a live end-to-end simulation suite executed against the running Docker stack.

### 6.1 Unit & Closed-Loop Integration Test Suite (`tests/test_planner_mapek.py`)
A comprehensive suite of **19 unit and integration tests** was developed and executed, achieving a **100% pass rate (19/19 PASS)**:

| Test Name | Tested MAPE-K Property | Scenario & Empirical Validation | Result |
| :--- | :--- | :--- | :--- |
| `test_predict_breach_probability_edge_cases` | Predictor / Analysis | Validates Gaussian tail breach probability on empty, flat, and rising sensor sample sequences. | **PASS** |
| `test_surrogate_model_physical_predictions` | Knowledge & Prediction | Verifies that open window predictions lower temperature and CO₂ in cool weather, and active HVAC cools during heatwaves. | **PASS** |
| `test_surrogate_model_online_learning_and_bounds` | Knowledge Adaptation | Validates online RLS updates while verifying physical parameter sign invariants ($\theta_{\text{conduction}} > 0, \theta_{\text{cooling}} < 0$). | **PASS** |
| `test_surrogate_model_influxdb_batch_training` | Knowledge (InfluxDB) | Verifies Flux query parsing and batch regression training over historical time-series tuples. | **PASS** |
| `test_utility_planner_prefers_passive_cooling_when_outdoor_is_cool` | Planning (Trade-offs) | Indoor 27.5°C, Outdoor 18.5°C $\to$ selects **passive cooling** (window open, HVAC off, 0W) over active HVAC (1500W). | **PASS** |
| `test_utility_planner_switches_to_active_hvac_when_outdoor_is_hot` | Planning (Trade-offs) | Indoor 28.0°C, Outdoor 34.0°C (heatwave) $\to$ selects **active HVAC cooling** with windows closed and blinds down. | **PASS** |
| `test_utility_planner_selects_active_heating_in_cold_wave` | Planning (Trade-offs) | Indoor 16.5°C, Outdoor 0.5°C $\to$ selects **active heating** (HVAC heat at 23°C) with windows closed. | **PASS** |
| `test_utility_planner_handles_high_co2_in_cold_or_rainy_weather_via_vmc` | Planning (Trade-offs) | Indoor CO₂ 1350 ppm, Outdoor 6.0°C and raining $\to$ keeps window closed and selects **VMC level 3** to avoid thermal shock. | **PASS** |
| `test_utility_planner_keeps_current_when_already_comfortable` | Planning (Stability) | Indoor 22.4°C, CO₂ 520 ppm $\to$ selects `keep_current` to minimize actuator wear. | **PASS** |
| `test_utility_planner_adapts_around_faulty_actuator` | Self-Healing / Planning | Window marked faulty $\to$ planner adapts by selecting active HVAC cooling or VMC boost instead of the stuck window. | **PASS** |
| `test_tier1_fire_reaction_and_preemption_over_tier2` | Safety Shield (Tier 1) | Fire risk in A-2-1 $\to$ immediate siren ON, gas shut, VMC 0, window closed, smoke vent open, elevator recall; Tier 2 pre-empted. | **PASS** |
| `test_tier1_gas_co_leak_reaction` | Safety Shield (Tier 1) | Combustible gas leak in B-1-2 $\to$ gas valve closed, windows opened, VMC level 3, siren ON, displays alerted. | **PASS** |
| `test_tier2_automatic_fallback_on_actuator_no_ack` | Execution & Resilience | Window command receives `no_ack` timeout $\to$ planner flags window as faulty and executes immediate fallback plan. | **PASS** |
| `test_closed_loop_mapek_pipeline_with_simulator_monitor_analyzer_planner` | Full Closed Loop | Closed-loop run: Simulator $\to$ Validator $\to$ Analyzer $\to$ Planner $\to$ Simulator. Verifies cooling during heatwave and fire reflex. | **PASS** |
| `test_freezing_weather_high_co2_never_opens_window` | Edge Case Robustness | Indoor 22.6°C, Outdoor 0.0°C, CO₂ 1400 ppm $\to$ window remains closed, VMC boosted to level 3. | **PASS** |
| `test_online_learning_synchronization_and_noise_resilience` | Noise Resilience | Verifies that single-sensor message arrivals do not trigger premature RLS updates and 10s sensor noise does not distort weights. | **PASS** |
| `test_tier1_earthquake_and_cascade_multi_hazard_recovery` | Hazard Recovery | Validates full complex clearance after earthquake and priority recovery in multi-hazard cascade (fire clearing while gas leak active). | **PASS** |
| `test_tier2_silent_no_effect_fault_detection_and_fallback` | Anomaly Detection | Detects silent `no_effect` window fault where simulator returns `ok` but temperature trend contradicts open window. | **PASS** |
| `test_monitor_sensor_drift_detection_and_microgrid_ev_peak_shaving` | Monitoring & Microgrid | Verifies neighbor-median sensor drift detection (`quality="suspect"`) and EV charger throttling during grid power deficit. | **PASS** |

### 6.2 Live End-to-End Stack Verification (`scripts/e2e_simulator.py`)
Executed against the live multi-container Docker deployment running on the host bridge network:
* **Check 1**: `Complex/status/simulator` heartbeat verified online.
* **Check 2**: Verified all 414 simulated raw sensor topics publishing across complex, buildings, stairwells, and apartments.
* **Check 3**: Validated simulator physics clock synchronization at $60\times$ speed.
* **Check 4**: Verified actuator command execution and acknowledgment round-trip via MQTT.
* **Check 5**: Verified command rejection and error messaging for out-of-range setpoints (e.g., setpoint 40°C rejected).
* **Check 6**: Verified actuator fault injection handling (`no_ack` simulation).
* **Check 7**: Injected fire scenario in unit `A-2-1` $\to$ validated smoke sensor readings elevation and immediate Tier 1 safety trigger.
* **Check 8**: Clean teardown of test scenarios and clock speed restoration.
* **Overall E2E Status**: **8 / 8 Checks PASSED**.

### 6.3 Deployment Status
All 8 microservices are active and healthy in Docker:
* `iot_simulator`: Physical building simulation running smoothly.
* `iot_monitor`: Ingesting raw sensor readings, calculating derived metrics, and streaming to InfluxDB and MQTT.
* `iot_analyzer`: Continuous health, comfort, and hazard analysis.
* `iot_planner`: Active two-tier autonomic manager with InfluxDB batch training and online RLS adaptation.
* `iot_mosquitto`: Core MQTT message broker (`1883`, `9001` WebSockets).
* `iot_influxdb`: Time-series database storing sensor readings, derived metrics, and planner decisions (`8086`).
* `iot_grafana`: Live visualization dashboard (`http://localhost:3000`).
* `iot_view`: 3D Three.js Digital Twin visualization (`http://localhost:8080`).

---

## 7. Conclusion
The implementation demonstrates a robust, self-adaptive smart building architecture. By combining a deterministic safety shield with a utility-driven predictive decision function, the system guarantees life-critical safety invariants while achieving optimal energy-comfort Pareto trade-offs during everyday environmental variations. Both unit/integration tests and live closed-loop simulations confirm the stability, explainability, and fault resilience of the autonomic manager.
