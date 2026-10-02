# IoT Project Setup

## Prerequisites
- Docker
- Docker Compose

## Installation & Setup

### Set Permissions
Docker volumes on Linux map to the host filesystem. We need to set the correct ownership for the containers to write to these folders.

Run these commands in the project root directory:

```bash
# Grafana runs as user 472
sudo chown -R 472:472 grafana/data

# Node-RED runs as user 1000
sudo chown -R 1000:1000 nodered/data

# Mosquitto runs as user 1883
sudo chown -R 1883:1883 mosquitto/

# InfluxDB runs as user 1000
sudo chown -R 1000:1000 influxdb/
```

## Launch Project

To start the stack:
```bash
sudo docker-compose up -d --remove-orphans
```

We also suggest to run:
```bash
sudo docker exec -it iot_influxdb influx delete --bucket iot_bucket --org iot_org --start '1970-01-01T00:00:00Z' --stop '2030-01-01T00:00:00Z' --token my-super-secret-auth-token
```
to perfectly clean the database at startup.

## Menu di sviluppo (macOS e Windows)

Al posto dei comandi a mano si può usare il menu interattivo `dev.py` (solo libreria standard, Python 3.9+):

- **macOS**: doppio clic su `dev.command` nel Finder, oppure `./dev.command` da terminale;
- **Windows**: doppio clic su `dev.bat`, oppure `dev.bat` da terminale;
- ovunque: `python3 dev.py`.

Il menu avvia i preset (vista 3D; pipeline MAPE-K senza Node-RED; stack completo) o una scelta manuale di servizi. Mostra stato e log, avvia e ferma gli scenari del simulatore, regola l'orologio, spia il traffico MQTT, lancia i test e la vista 3D in sviluppo (`npm run dev`), ferma, riavvia e ricostruisce i servizi.
Node-RED parte sempre con `TELEGRAM_CHAT_ID=0` (allarmi non inoltrati), salvo conferma esplicita. Per i test servono [uv](https://docs.astral.sh/uv/) e, per la vista 3D, Node.js.

## Vista 3D (complesso residenziale)

Vista 3D/2D del complesso dell'Aquila (4 palazzi, parco, parcheggio) che mostra in tempo reale i dati del simulatore via MQTT, con un pannello di debug per i comandi agli attuatori e l'orologio simulato.

Per provarla bastano broker, simulatore e vista:
```bash
docker compose up -d --build mosquitto simulator view
```
poi apri http://localhost:8080. **Non avviare Node-RED** (né l'intero stack) mentre la provi: inoltra gli allarmi al canale Telegram reale.

Il browser si collega a Mosquitto via WebSocket (porta 9001) con l'utente `view`, che ha permessi minimi (ACL in `mosquitto/config/aclfile`; credenziali in `.env`). Comandi da tastiera, test, verifica a vista e copione della demo sono in [`docs/VISTA_3D.md`](docs/VISTA_3D.md).

**Crediti dei modelli 3D** (pubblico dominio, CC0 1.0): arredi dal [Furniture Kit](https://kenney.nl/assets/furniture-kit) di Kenney; residenti da [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) e [Ultimate Modular Males](https://quaternius.com/packs/ultimatemodularcharacters.html) di Quaternius. Dettagli e modifiche in [`view/public/models/CREDITS.md`](view/public/models/CREDITS.md); si rigenerano con `scripts/build-models.sh`.



To watch the logs of the singles containers, simply type:
```bash
sudo docker-compose logs -f [name]
```
where name corresponds to the name listed in the `docker-compose.yml` file.

## Monitorate Alerts

To follow the alerts of the system, simply join the Telegram channel [@mpga_alert_channel](https://t.me/mpga_alert_channel).

## Manipulate Sensors and Locations

You can manipulate the system configuration in two ways: **Runtime** (via UI) or **Static** (via code).

### 1. Runtime Configuration (UI)
Access the **IoT Control Panel** at http://localhost:8501.
From here you can:
- **Update Locations**: Add or remove locations dynamically.
- **Update Thresholds**: Adjust the alert thresholds for the Analyzer.
- **Configure Sensors**: Add new sensor types or change the density (sensors per type) without restarting the containers.

### 2. Static Configuration (Defaults)
To change the default values loaded at startup, edit `datastructure.py`:

- **Locations**: Edit the `LOCATIONS` list.
```python
LOCATIONS = ["Road", "Square", "Park"]
```
- to add sensors, create a new `@dataclass` and add the default parameters, then configure the threshold (note that minVal, maxVal vold and threshold should be float values)
```python
@dataclass
class NewSensorData(SensorData):
    type: str = "sensor_data_name"
    unit: str = "sensor_unit"

SENSOR_PARAMS = [
	...
	{"data_cls": NewSensorData, "min_v": minVal, "max_v": maxVal, "volatility": vol, "topic_type": "type"},
]

THRESHOLDS = [
	...
	"type": threshold
]
```
- to add more sensors per location, simply edit the SENSOR_PER_TYPE value
```python
SENSOR_PER_TYPE = 1 # Default number is 1, so each location has only one sensor per parameter to measure
```