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

To start the complete stack:
```bash
./dev.sh
```
or on Windows:
```cmd
dev.bat
```
This will open an interactive menu where you can start the complete stack, the 3D view, or just specific services.

To clean the database at startup (if you want a fresh start):
```bash
docker exec -it iot_influxdb influx delete --bucket iot_bucket --org iot_org --start '1970-01-01T00:00:00Z' --stop '2030-01-01T00:00:00Z' --token my-super-secret-auth-token
```

## System Architecture (MAPE-K)

The project follows the MAPE-K loop structure for Autonomous Systems:
- **Monitor (`monitor/`)**: Ingests raw data from the simulator, validates it, and writes it to InfluxDB.
- **Analyzer (`analyzer/`)**: Evaluates the monitored data against predefined rules and thresholds to detect risks (e.g. fire, gas leaks).
- **Planner (`planner/`)**: Subscribes to analysis alerts and dispatches commands to actuators to mitigate the risks.
- **Executor (`planner/executor/`)**: Translates high-level mitigation strategies into specific MQTT commands.
- **Knowledge (`influxdb/`)**: Stores historical and validated metrics.

## 3D View (Residential Complex)

To test the 3D interactive view and trigger scenarios manually:
1. Start the simulation: `./dev.sh` and select the 3D View preset.
2. Open http://localhost:8080 in your browser.
3. You can spawn fires or gas leaks using the debug panel to observe the system's reaction.

## Monitoring & Logs

To watch the logs of a specific container:
```bash
docker compose logs -f [service_name]
```
(e.g., `docker compose logs -f planner`)

You can view the Grafana dashboard at http://localhost:3000 (default credentials are automatically provisioned).