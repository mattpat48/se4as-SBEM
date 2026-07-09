# Report SE4IOT and SE4AS - 2025/2026
- Matteo Patella, 308056, matteo.patella@student.univaq.it
- Altieri Giovanni, 309006, giovanni.altieri@student.univaq.it

---

TODO: aggiungere dinamicità dei parametri (MQTT topics, ed eventualmente location e tipi di sensori iniettati ?)
TODO: aggiungere yml files per setup immediato
TODO: grafana
TODO: IMPORTANTE!!! I THRESHOLD CONFIGURATI E MODIFICABILI DEVONO VEDERSI PURE SU GRAFANA
TODO: inserire una parte di calcolo di eventi (tipo umidità molto bassa + temperatura molto alta + noise level alto = incendio, ad esempio)

## SE4IOT Functional Requirements

### Sensor Integration

We choose to simulate sensors, placing its code in the `sensors` container. The sensors produce various data every 5 seconds. We chose to produce 5 types of data that best fit the environment and domain we are operating on:

- Temperature → keeps track of the temperature of the place, useful to predict weather conditions or accidents (such as fires)
- Air Humidity → this parameter is particularly useful when predicting weather, but also “livability” of the place combined with other parameters (such as temperature and Air Quality)
- Air Quality → quantity of CO2 in the air, with this parameter we can detect particularly polluted or clean places
- Traffic Speed → useful data when trying to detect traffic jams, especially if combined with Air Quality and Noise Level
- Noise Level → we can use this parameter when trying to determine dangerous events, such as explosions or fights or places full of people

We programmed the sensor data generation to produce not totally random values, but to start from a certain quantity and, basing on the volatility number of each data type, randomly increase or decrease that value, so we have uniform and coherent data ranges.

Sensor include in the published MQTT package:

- `sensorid` → a unique identifier (in our case, we choose a simple wording of “sensor_x” to keep the package readable) assigned to each sensor
- `value` → the generated value
- `timestamp` → the registered timestamp of the data; we chose to save the timestamp at the generation to have more precise time events (instead of using the timestamp of the registration in the database)

We also addressed a specific problem regarding the persistence of the configuration. Since MQTT retains the last message sent to a topic (to allow new subscribers to receive the latest configuration), the system would "remember" changes made via UI even after a full restart, which was problematic for testing.
To fix this, we introduced a `RESTORE_SESSION` environment variable in the `sensors` container.
- If set to `true` (default), the system accepts retained messages, restoring the previous session's state (resilience).
- If set to `false`, the system ignores retained configuration messages at startup, ensuring a clean start using only the defaults defined in `datastructure.py`.

### Communication Protocols

MQTT was employed as the main protocol for communication as required. For the broker, we chose to adopt the eclipse-mosquitto docker image.

The structure of topics falls into three categories: alerts and data generation.
Regarding the alerts, the structure is `City/alerts/[place]/[type]`, where `place` is the location the anomaly was manifested and `type` is the type of measurement that raised the alert.
For the data generation the structure is similar, being `City/data/[place]/[type]`, following the same logic of the alerts.
We chose to prioritize locations over type of measurement because we find more fitting in a Smart City environment the option to monitorate the entire place with each of its parameters, instead of observing the same parameter but with different locations.
Finally, we have a third category of topics, the `City/update/#`. In this topic, every kind of update to the configuration of the system will be posted, such as new locations, new sensors, thresholds modifications.

The `sensors` publishes in the `City/data` topic, while the analyzer subscribes to that topic and posts in the `City/alerts` topic. Both these components subscribe to the related `update` topics, and the UI component posts the updates requested by the user in these topics.

### Data Processing

We decided to build our customized analyzer, which is deployed into an independent container. This component subscribes to the various MQTT topics required (`data` and `update` topics), then basing off the set thresholds evaluate each parameter received, and finally procedes to send an alert (critical situation, e.g. parameter beyond threshold) or an alert-revoke (parameter becomes normal again) if necessary.

We use Node-RED to handle the communication between eterogeneous components, such as analyzer and Telegram bot or sensors and InfluxDB. We used `MQTT in` nodes to receive the messages published on the topics, and then we forward these messages to the related node (such as Telegram `sender` or `influxdb out` nodes).

### Data Storage

InfluxDB is the time-series database we chose to store our data. As requested, the data is forwarded to InfluxDB using Node-RED. The data is tagged using the Sensor ID (structured as said in the previous section), the location of the data perceived, the type of data recorded (such as temperature, co2, ...) and finally the timestamp of the event.

### Visualization

TODO: tutto grafana

### Alerting Mechanisms

TODO: change the alert, the channel is too confusionary (spams too much), possible telegram bot UI and not using a channel

For the alerting mechanisms, we decided to employ a Telegram bot that delivers alerts using a channel. This way, using a messaging app, we can obtain an instant and automated way of delivering news regarding the system.

Messages are sent in two different, opposite situations: when a parameter goes beyond the set threshold, and when it becomes normal again. This way, we prevent message spamming but we keep a clear history of what has happened.

## Non-Functional Requirements

### Portability

The system has been fully containerized; the `docker-compose.yml` file and other configuration files (such as `dashboard.yml` and `influxdb.yml`) allow any user to clone the repository from Github and having a fully working environment.

### Scalability

This requirement was satisfied using an external file, `datastructure.py`, that specifies the locations and the types of sensors in the system: a simple array handles the locations, while to create and add new sensors or sensor types, you just have to create a new dataclass specifying the new informations (a more detailed "guide" is in the `README` file).

### Resilience

The resilience is obtained by many controls on the messages in the parsers in Node-RED, and by setting the `qos` in the Sensor MQTT client to 1, so every message is delivered at least one time. Thanks to the fact that we choose to save the timestamp for each registered data, we can now differentiate between possible data sent in the same moment (say with a reconnection situation).

### User-Friendly Design

The user-friendly design was obtained by separating every component and connecting them using Node-RED and Docker injection with Enviroment variables, so no connection strings of complicated queries are present in the files. Also, we decided to build a simple user interface to customize thresholds or follow a single parameter while the system is running.

### Security

MQTT was configured to be accessed only knowing the passwords; following the normal protocol, the file has been encrypted using the `mosquitto_passwd` command, and the password file is in the mosquitto/config/ folder.