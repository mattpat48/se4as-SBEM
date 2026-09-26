import json
from dataclasses import dataclass, asdict

@dataclass
class SensorData:
    sensorid: str
    value: float
    timestamp: float  # epoch seconds (UTC)
    # Additional metadata for Smart City context
    type: str = "temperature"
    unit: str = "°C"
    lat: float = 0.0
    lon: float = 0.0

    def to_json(self):
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, json_str):
        data = json.loads(json_str)
        return cls(**data)

# Configuration Lists
LOCATIONS = []

# Real GPS coordinates for L'Aquila, Italy
LOCATION_COORDS = {}

# Famous L'Aquila locations presets (selectable from UI)
LAQUILA_PRESETS = {
    "Parco del Castello":          {"lat": 42.3555, "lon": 13.4045},
    "Piazza del Duomo":            {"lat": 42.3498, "lon": 13.3996},
    "Fontana delle 99 Cannelle":   {"lat": 42.3524, "lon": 13.3917},
    "Basilica di Collemaggio":     {"lat": 42.3426, "lon": 13.4048},
    "Corso Vittorio Emanuele II":  {"lat": 42.3520, "lon": 13.4010}, 
    "Piazza del Palazzo":          {"lat": 42.3515, "lon": 13.3984},
    "Villa Comunale":              {"lat": 42.3460, "lon": 13.4016},
    "Forte Spagnolo":              {"lat": 42.3561, "lon": 13.4052},
    "Porta Napoli":                {"lat": 42.3418, "lon": 13.4020},
    "Piazza Santa Maria Paganica": {"lat": 42.3524, "lon": 13.3996},
    "Stazione FS L'Aquila":        {"lat": 42.3547, "lon": 13.3860},
    "Ospedale San Salvatore":      {"lat": 42.3682, "lon": 13.3535},  
    "Università L'Aquila (Coppito)": {"lat": 42.3675, "lon": 13.3505},  
}

SENSOR_PARAMS = [
    {"type": "temperature", "unit": "°C", "min_v": 15.0, "max_v": 35.0, "volatility": 0.5},
    {"type": "humidity", "unit": "%", "min_v": 30.0, "max_v": 90.0, "volatility": 1.0},
    {"type": "co2", "unit": "ppm", "min_v": 400.0, "max_v": 1200.0, "volatility": 10.0},
    {"type": "traffic_speed", "unit": "km/h", "min_v": 0.0, "max_v": 100.0, "volatility": 5.0},
    {"type": "noise_level", "unit": "dB", "min_v": 40.0, "max_v": 95.0, "volatility": 2.0},
    {"type": "seismic", "unit": "Mw", "min_v": 0.0, "max_v": 9.0, "volatility": 0.02},
    {"type": "rain_level", "unit": "mm/h", "min_v": 0.0, "max_v": 200.0, "volatility": 1.5},
]

SENSORS_PER_TYPE = 1 # Number of sensors per type per location (can be adjusted)

THRESHOLDS = {
    "temperature": 30.0,
    "humidity": 80.0,
    "co2": 1000.0,
    "traffic_speed": 80.0,
    "noise_level": 85.0,
    "seismic": 4.0,
    "rain_level": 50.0
}