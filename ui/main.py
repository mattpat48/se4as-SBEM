import streamlit as st
import paho.mqtt.client as mqtt
import json
import os
import time
from datetime import datetime
import datastructure as ds

# Environment Variables
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_USER = os.getenv("MQTT_USERNAME", "admin")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "adminpassword123")
RESTORE_SESSION = os.getenv("RESTORE_SESSION", "true").lower() == "true"

st.set_page_config(page_title="IoT Control Panel", layout="wide")
st.title("🎛️ IoT System Control Panel")

# --- MQTT Connection ---
@st.cache_resource
def get_mqtt_client():
    client = mqtt.Client()
    # Storage for incoming retained configs
    client.external_config = {}

    def on_message(c, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            if msg.topic == "City/update/locations":
                c.external_config["locations"] = payload.get("locations")
                if "location_coords" in payload:
                    c.external_config["location_coords"] = payload["location_coords"]
            elif msg.topic == "City/update/config":
                if "sensor_params" in payload:
                    c.external_config["sensor_params"] = payload["sensor_params"]
                if "sensors_per_type" in payload:
                    c.external_config["sensors_per_type"] = payload["sensors_per_type"]
            elif msg.topic == "City/update/thresholds":
                c.external_config["thresholds"] = payload.get("thresholds")
            elif msg.topic == "City/update/policies":
                c.external_config["policies"] = payload
            elif msg.topic.startswith("City/update/rules/"):
                # City/update/rules/<rulename>
                try:
                    parts = msg.topic.split('/')
                    rulename = parts[3]
                    c.external_config.setdefault("rules", {})[rulename] = payload
                except Exception:
                    pass
            elif msg.topic == "City/emergency":
                c.external_config["active_emergency"] = payload
        except Exception:
            pass
    
    client.on_message = on_message

    if MQTT_USER and MQTT_PASSWORD:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.subscribe([("City/update/#", 1), ("City/emergency", 1)])
        client.loop_start()
        if RESTORE_SESSION:
            time.sleep(0.5) # Wait for retained messages
        return client
    except Exception as e:
        st.error(f"Could not connect to MQTT Broker: {e}")
        return None

client = get_mqtt_client()

def get_initial_config(key, default_val):
    if RESTORE_SESSION and client and hasattr(client, 'external_config'):
        val = client.external_config.get(key)
        if val is not None:
            return val
    return default_val

# --- Session State Initialization ---
if 'sensor_params' not in st.session_state:
    st.session_state.sensor_params = get_initial_config('sensor_params', list(ds.SENSOR_PARAMS))
if 'sensors_per_type' not in st.session_state:
    st.session_state.sensors_per_type = get_initial_config('sensors_per_type', ds.SENSORS_PER_TYPE)
if 'thresholds' not in st.session_state:
    st.session_state.thresholds = get_initial_config('thresholds', dict(ds.THRESHOLDS))
if 'locations_list' not in st.session_state:
    st.session_state.locations_list = get_initial_config('locations', list(ds.LOCATIONS))
if 'location_coords' not in st.session_state:
    st.session_state.location_coords = get_initial_config('location_coords', dict(ds.LOCATION_COORDS))
if 'rules' not in st.session_state:
    # rules stored under City/update/rules/<rulename>
    st.session_state.rules = get_initial_config('rules', {})
if 'policies' not in st.session_state:
    st.session_state.policies = get_initial_config('policies', {})

# =====================================================
# SECTION 1: Location & Coordinates Management
# =====================================================
st.header("📍 Location & Coordinates Management")

loc_col1, loc_col2 = st.columns([1, 1])

with loc_col1:
    st.subheader("🗺️ Current Sensor Locations")
    st.caption("Each location has GPS coordinates used by the sensors and shown on the Grafana map.")
    
    # Show current locations with their coordinates in a nice table
    if st.session_state.location_coords:
        for loc_name, coords in list(st.session_state.location_coords.items()):
            with st.container():
                c1, c2, c3, c4 = st.columns([3, 2, 2, 1])
                c1.markdown(f"**{loc_name}**")
                c2.code(f"Lat: {coords['lat']:.4f}")
                c3.code(f"Lon: {coords['lon']:.4f}")
                if c4.button("🗑️", key=f"del_{loc_name}", help=f"Remove {loc_name}"):
                    del st.session_state.location_coords[loc_name]
                    st.session_state.locations_list = list(st.session_state.location_coords.keys())
                    st.rerun()
    else:
        st.warning("No locations configured. Add one below!")

with loc_col2:
    st.subheader("➕ Add New Location")

    # --- Quick add from L'Aquila presets ---
    st.markdown("**🏛️ Scegli un luogo famoso de L'Aquila:**")
    
    # Filter out already-added presets
    available_presets = {k: v for k, v in ds.LAQUILA_PRESETS.items() 
                        if k not in st.session_state.location_coords}
    
    if available_presets:
        preset_choice = st.selectbox(
            "Seleziona un preset",
            options=["— Seleziona —"] + list(available_presets.keys()),
            key="preset_select"
        )
        
        if preset_choice != "— Seleziona —":
            preset_coords = available_presets[preset_choice]
            st.info(f"📌 **{preset_choice}** — Lat: {preset_coords['lat']:.4f}, Lon: {preset_coords['lon']:.4f}")
            
            if st.button(f"✅ Aggiungi \"{preset_choice}\"", key="add_preset"):
                st.session_state.location_coords[preset_choice] = preset_coords
                st.session_state.locations_list = list(st.session_state.location_coords.keys())
                st.success(f"Aggiunto: {preset_choice}!")
                st.rerun()
    else:
        st.success("Tutti i preset di L'Aquila sono già stati aggiunti! 🎉")
    
    st.divider()
    
    # --- Manual coordinate entry ---
    st.markdown("**✏️ Oppure inserisci coordinate manuali:**")
    
    manual_name = st.text_input("Nome location", placeholder="es. Piazza Navona", key="manual_loc_name")
    mc1, mc2 = st.columns(2)
    manual_lat = mc1.number_input("Latitudine", min_value=-90.0, max_value=90.0, 
                                   value=42.3510, format="%.4f", key="manual_lat")
    manual_lon = mc2.number_input("Longitudine", min_value=-180.0, max_value=180.0, 
                                   value=13.3959, format="%.4f", key="manual_lon")
    
    if st.button("➕ Aggiungi Location Manuale", key="add_manual"):
        if manual_name.strip():
            st.session_state.location_coords[manual_name.strip()] = {
                "lat": manual_lat, "lon": manual_lon
            }
            st.session_state.locations_list = list(st.session_state.location_coords.keys())
            st.success(f"Aggiunto: {manual_name.strip()} ({manual_lat:.4f}, {manual_lon:.4f})")
            st.rerun()
        else:
            st.error("Inserisci un nome per la location!")

# --- Publish locations + coords button ---
st.divider()
if st.button("🚀 Pubblica Locations & Coordinate ai Sensori", type="primary", use_container_width=True):
    payload = {
        "locations": st.session_state.locations_list,
        "location_coords": st.session_state.location_coords
    }
    if client:
        client.publish("City/update/locations", json.dumps(payload), retain=True, qos=1)
        st.success(f"✅ Pubblicato! {len(st.session_state.locations_list)} locations con coordinate inviate ai sensori.")
    else:
        st.error("MQTT non connesso!")

# =====================================================
# SECTION 2: Thresholds & Sensor Config (existing)
# =====================================================
st.divider()
st.header("⚙️ Sensor & Alert Configuration")

col2, col3 = st.columns(2)

with col2:
    st.subheader("⚠️ Threshold Configuration")
    st.info("Adjust the alert thresholds for the Analyzer.")

    new_thresholds = {}

    # Dynamically generate sliders for each sensor type
    for param in st.session_state.sensor_params:
        t_type = param["type"]
        t_unit = param["unit"]
        
        # Get current value or default to 80% of max value
        current_val = st.session_state.thresholds.get(t_type, param["max_v"] * 0.8)
        
        # Create slider
        val = st.slider(
            f"{t_type} ({t_unit})", 
            min_value=0.0, 
            max_value=float(param["max_v"]) * 1.5, 
            value=float(current_val),
            key=f"thresh_{t_type}"
        )
        new_thresholds[t_type] = val

    if st.button("Update Thresholds"):
        st.session_state.thresholds.update(new_thresholds)
        payload = {
            "thresholds": new_thresholds
        }
        if client:
            client.publish("City/update/thresholds", json.dumps(payload), retain=True, qos=1)
            st.success("Thresholds updated successfully!")

with col3:
    st.subheader("🔧 Sensor Configuration")
    st.info("Add new sensor types and configure density.")

    # Sensors per Type
    st.session_state.sensors_per_type = st.number_input("Sensors per Type per Location", min_value=1, value=st.session_state.sensors_per_type)

    # Add New Sensor Type
    with st.expander("Add New Sensor Type"):
        new_type = st.text_input("Type Name (e.g., pressure)")
        new_unit = st.text_input("Unit (e.g., hPa)")
        new_min = st.number_input("Min Value", value=0.0)
        new_max = st.number_input("Max Value", value=100.0)
        new_vol = st.number_input("Volatility", value=1.0)
        
        if st.button("Add Sensor Type"):
            if new_type and new_unit:
                new_param = {
                    "type": new_type, "unit": new_unit, 
                    "min_v": new_min, "max_v": new_max, "volatility": new_vol
                }
                st.session_state.sensor_params.append(new_param)
                st.success(f"Added {new_type}!")

    # Display current types
    st.write("Current Types:", [p['type'] for p in st.session_state.sensor_params])

    if st.button("Update Sensor Config"):
        payload = {
            "sensor_params": st.session_state.sensor_params,
            "sensors_per_type": st.session_state.sensors_per_type
        }
        if client:
            client.publish("City/update/config", json.dumps(payload), retain=True, qos=1)
            st.success("Sensor configuration updated!")

# =====================================================
# SECTION 2.5: Runtime Rules & Planner Policies
# =====================================================
st.divider()
st.header("🧠 Runtime Rules & Planner Policies")
st.caption("Edit composite-rule parameters and planner policies at runtime. Changes are published to MQTT (retained) and applied immediately.")

rule_col1, rule_col2 = st.columns(2)

with rule_col1:
    st.subheader("Composite Rule Parameters")
    # Fire risk params
    fr = st.session_state.rules.get('fire_risk', {})
    fr_slope = st.number_input("fire_risk: slope_threshold (°C/min)", value=float(fr.get('slope_threshold', 0.5)), key='fr_slope')
    fr_hum = st.number_input("fire_risk: humidity_threshold (%)", value=float(fr.get('humidity_threshold', 40.0)), key='fr_hum')

    co2r = st.session_state.rules.get('co2_persistence', {})
    co2_thresh = st.number_input("co2_persistence: threshold (ppm)", value=float(co2r.get('threshold', ds.THRESHOLDS.get('co2', 1000.0))), key='co2_thresh')

    noiser = st.session_state.rules.get('noise_anomaly', {})
    noise_thresh = st.number_input("noise_anomaly: threshold (dB)", value=float(noiser.get('threshold', ds.THRESHOLDS.get('noise_level', 85.0))), key='noise_thresh')
    spike_thresh = st.number_input("noise_anomaly: spike_threshold (dB)", value=float(noiser.get('spike_threshold', 8.0)), key='spike_thresh')

    if st.button("Update Rules"):
        # publish each rule as its own topic
        if client:
            client.publish("City/update/rules/fire_risk", json.dumps({"slope_threshold": fr_slope, "humidity_threshold": fr_hum}), retain=True, qos=1)
            client.publish("City/update/rules/co2_persistence", json.dumps({"threshold": co2_thresh}), retain=True, qos=1)
            client.publish("City/update/rules/noise_anomaly", json.dumps({"threshold": noise_thresh, "spike_threshold": spike_thresh}), retain=True, qos=1)
            # update local cache for immediate UI feedback
            client.external_config.setdefault('rules', {})['fire_risk'] = {"slope_threshold": fr_slope, "humidity_threshold": fr_hum}
            client.external_config.setdefault('rules', {})['co2_persistence'] = {"threshold": co2_thresh}
            client.external_config.setdefault('rules', {})['noise_anomaly'] = {"threshold": noise_thresh, "spike_threshold": spike_thresh}
            st.success("Rules updated and published (retained).")
        else:
            st.error("MQTT not connected")

with rule_col2:
    st.subheader("Planner Policies")
    pol = st.session_state.policies.get('planner', {}) if st.session_state.policies else {}
    horizon = st.number_input("planner.horizon_seconds", value=int(pol.get('horizon_seconds', 300)), step=30, key='planner_horizon')
    proactive_prob = st.number_input("planner.proactive_prob", value=float(pol.get('proactive_prob', 0.6)), min_value=0.0, max_value=1.0, key='planner_prob')

    if st.button("Update Planner Policies"):
        if client:
            payload = {"planner": {"horizon_seconds": int(horizon), "proactive_prob": float(proactive_prob)}}
            client.publish("City/update/policies", json.dumps(payload), retain=True, qos=1)
            client.external_config['policies'] = payload
            st.success("Planner policies updated (retained).")
        else:
            st.error("MQTT not connected")


# --- System Status ---
st.divider()
st.subheader("📡 System Status")
scol1, scol2, scol3 = st.columns(3)
with scol1:
    if client:
        st.success(f"✅ MQTT: {MQTT_BROKER}:{MQTT_PORT}")
    else:
        st.error("❌ MQTT Disconnected")
with scol2:
    st.metric("Active Locations", len(st.session_state.locations_list))
with scol3:
    st.metric("Sensor Types", len(st.session_state.sensor_params))

# =====================================================
# SECTION 3: Emergency Simulation
# =====================================================
st.divider()
st.header("🚨 Emergency Simulation")
st.caption("Simulate emergency scenarios to test the system's response. Emergencies force extreme sensor values at the selected location and are visible on the Grafana dashboard.")

# Emergency scenarios definition
EMERGENCY_SCENARIOS = {
    "🔥 Incendio": {
        "type": "fire",
        "icon": "🔥",
        "description": "Temperatura e CO₂ estremi, rumore alto",
        "color": "#FF4500",
        "effects": {"temperature": 75.0, "co2": 2500.0, "noise_level": 95.0}
    },
    "🌊 Alluvione": {
        "type": "flood",
        "icon": "🌊",
        "description": "Pioggia estrema, umidità 99%, traffico fermo",
        "color": "#1E90FF",
        "effects": {"rain_level": 180.0, "humidity": 99.0, "traffic_speed": 0.0, "noise_level": 90.0}
    },
    "🏚️ Terremoto": {
        "type": "earthquake",
        "icon": "🏚️",
        "description": "Attività sismica intensa, rumore, traffico fermo",
        "color": "#8B4513",
        "effects": {"seismic": 7.5, "noise_level": 110.0, "traffic_speed": 0.0, "co2": 1800.0}
    },
    "☣️ Fuga di Gas": {
        "type": "gas_leak",
        "icon": "☣️",
        "description": "Concentrazione CO₂ estrema",
        "color": "#32CD32",
        "effects": {"co2": 3000.0, "noise_level": 70.0}
    },
    "🚗 Incidente Stradale": {
        "type": "traffic_accident",
        "icon": "🚗",
        "description": "Traffico bloccato e rumore alto",
        "color": "#FFD700",
        "effects": {"traffic_speed": 0.0, "noise_level": 95.0}
    },
}

# Check if there's an active emergency (from retained MQTT)
active_emergency = None
if client and hasattr(client, 'external_config'):
    active_emergency = client.external_config.get("active_emergency")
    if active_emergency and not active_emergency.get("active", False):
        active_emergency = None

# Show active emergency banner
if active_emergency:
    etype = active_emergency.get("type", "unknown")
    eloc = active_emergency.get("location", "unknown")
    etime = active_emergency.get("timestamp", "")
    eseverity = active_emergency.get("severity", "critical")
    # Find matching scenario for icon
    eicon = "🚨"
    for name, scenario in EMERGENCY_SCENARIOS.items():
        if scenario["type"] == etype:
            eicon = scenario["icon"]
            break
    st.error(f"{eicon} **EMERGENZA ATTIVA: {etype.upper().replace('_', ' ')}** — Location: **{eloc}** — Severity: **{eseverity}** — Since: {etime}")

# Emergency location selector
em_col1, em_col2 = st.columns([1, 2])

with em_col1:
    emergency_location = st.selectbox(
        "📍 Location dell'emergenza",
        options=st.session_state.locations_list if st.session_state.locations_list else ["No locations"],
        key="emergency_location"
    )
    
    emergency_severity = st.select_slider(
        "⚠️ Severità",
        options=["warning", "critical", "catastrophic"],
        value="critical",
        key="emergency_severity"
    )

with em_col2:
    st.markdown("**Seleziona lo scenario di emergenza:**")
    
    # Display scenario buttons in a grid
    for name, scenario in EMERGENCY_SCENARIOS.items():
        bcol_info, bcol_btn = st.columns([3, 1])
        with bcol_info:
            st.markdown(f"**{name}** — {scenario['description']}")
        with bcol_btn:
            if st.button("▶️ Avvia", key=f"emergency_{scenario['type']}", use_container_width=True):
                if client and emergency_location != "No locations":
                    payload = {
                        "type": scenario["type"],
                        "location": emergency_location,
                        "severity": emergency_severity,
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "active": True,
                        "effects": scenario["effects"]
                    }
                    client.publish("City/emergency", json.dumps(payload), retain=True, qos=1)
                    # Set directly so banner shows immediately on rerun
                    client.external_config["active_emergency"] = payload
                    st.rerun()
                else:
                    st.error("MQTT non connesso o nessuna location disponibile!")

# Stop emergency button
st.divider()
if st.button("🛑 FERMA EMERGENZA", type="primary", use_container_width=True, key="stop_emergency"):
    if client:
        stop_payload = {
            "type": "none",
            "location": "",
            "severity": "none",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "active": False,
            "effects": {}
        }
        client.publish("City/emergency", json.dumps(stop_payload), retain=True, qos=1)
        if hasattr(client, 'external_config'):
            client.external_config["active_emergency"] = None
        st.success("✅ Emergenza fermata. I sensori torneranno ai valori normali.")
        st.rerun()

st.caption("Changes sent via MQTT topic 'City/update'. Ensure Sensors and Analyzer containers are running.")