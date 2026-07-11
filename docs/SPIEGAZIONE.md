# 📘 SPIEGAZIONE COMPLETA DEL PROGETTO — Smart City IoT L'Aquila

---

## 📑 Indice

1. [Panoramica del Sistema](#1-panoramica-del-sistema)
2. [Architettura Complessiva](#2-architettura-complessiva)
3. [Flusso dei Dati — Passo per Passo](#3-flusso-dei-dati--passo-per-passo)
4. [Tecnologie Utilizzate](#4-tecnologie-utilizzate)
   - 4.1 [Docker & Docker Compose](#41-docker--docker-compose)
   - 4.2 [MQTT & Eclipse Mosquitto](#42-mqtt--eclipse-mosquitto)
   - 4.3 [InfluxDB](#43-influxdb)
   - 4.4 [Node-RED](#44-node-red)
   - 4.5 [Grafana](#45-grafana)
   - 4.6 [Streamlit (UI)](#46-streamlit-ui)
   - 4.7 [Telegram Bot](#47-telegram-bot)
   - 4.8 [Python & Paho MQTT](#48-python--paho-mqtt)
5. [Dettaglio dei Componenti](#5-dettaglio-dei-componenti)
   - 5.1 [Sensors Container](#51-sensors-container)
   - 5.2 [Analyzer Container](#52-analyzer-container)
   - 5.3 [Node-RED Middleware](#53-node-red-middleware)
   - 5.4 [Dashboard Grafana](#54-dashboard-grafana)
   - 5.5 [UI Control Panel](#55-ui-control-panel)
6. [Pattern di Comunicazione](#6-pattern-di-comunicazione)
   - 6.1 [Publish/Subscribe (Pub/Sub)](#61-publishsubscribe-pubsub)
   - 6.2 [Topic Hierarchy](#62-topic-hierarchy)
   - 6.3 [Retained Messages](#63-retained-messages)
   - 6.4 [Quality of Service (QoS)](#64-quality-of-service-qos)
7. [Gestione delle Emergenze](#7-gestione-delle-emergenze)
8. [Sistema di Alerting](#8-sistema-di-alerting)
9. [Concetti Teorici IoT](#9-concetti-teorici-iot)
   - 9.1 [Cos'è l'IoT](#91-cosè-liot)
   - 9.2 [Architettura a Livelli dell'IoT](#92-architettura-a-livelli-delliot)
   - 9.3 [Edge vs Cloud Computing](#93-edge-vs-cloud-computing)
   - 9.4 [Time Series Database](#94-time-series-database)
   - 9.5 [Il Protocollo MQTT in Profondità](#95-il-protocollo-mqtt-in-profondità)
   - 9.6 [Digital Twin](#96-digital-twin)
   - 9.7 [MAPE-K Loop (SE4AS)](#97-mape-k-loop-se4as)
   - 9.8 [Self-Adaptive Systems](#98-self-adaptive-systems)
10. [Configurazione e Deploy](#10-configurazione-e-deploy)
11. [Come Spiegare il Progetto al Professore](#11-come-spiegare-il-progetto-al-professore)

---

## 1. Panoramica del Sistema

Questo progetto implementa un **sistema IoT per Smart City** ambientato a **L'Aquila, Italia**. Simula una rete di sensori distribuiti in punti famosi della città (Piazza del Duomo, Fontana delle 99 Cannelle, Forte Spagnolo, ecc.) che monitorano in tempo reale:

| Sensore | Unità | Range | Soglia |
|---------|-------|-------|--------|
| Temperatura | °C | 15 – 35 | 30.0 |
| Umidità | % | 30 – 90 | 80.0 |
| CO₂ | ppm | 400 – 1200 | 1000.0 |
| Velocità Traffico | km/h | 0 – 100 | 80.0 |
| Livello Rumore | dB | 40 – 95 | 85.0 |
| Sismico | Mw | 0 – 9 | 4.0 |
| Livello Pioggia | mm/h | 0 – 200 | 50.0 |

Il sistema è **completamente containerizzato** (Docker) e comprende 7 microservizi che comunicano tramite il protocollo **MQTT**.

---

## 2. Architettura Complessiva

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DOCKER NETWORK (iot_net)                        │
│                                                                        │
│  ┌──────────┐    MQTT     ┌────────────┐    MQTT     ┌──────────────┐ │
│  │ SENSORS  │───publish──▶│  MOSQUITTO │◀──subscribe──│   ANALYZER   │ │
│  │ (Python) │◀──subscribe─│   (Broker) │──publish───▶│   (Python)   │ │
│  └──────────┘             └─────┬──────┘             └──────────────┘ │
│       │                         │                           │          │
│       │                    subscribe                        │          │
│       │                         │                           │          │
│       │                  ┌──────▼──────┐                    │          │
│       │                  │  NODE-RED   │                    │          │
│       │                  │ (Middleware) │                    │          │
│       │                  └──────┬──────┘                    │          │
│       │                         │                           │          │
│       │                    InfluxDB                     InfluxDB       │
│       │                    Write API                   (opzionale)     │
│       │                         │                           │          │
│       │                  ┌──────▼──────┐                    │          │
│       │                  │  INFLUXDB   │◀───────────────────┘          │
│       │                  │  (Database) │                               │
│       │                  └──────┬──────┘                               │
│       │                         │                                      │
│       │                    Flux Query                                  │
│       │                         │                                      │
│       │                  ┌──────▼──────┐         ┌──────────────┐     │
│       │                  │   GRAFANA   │         │  TELEGRAM    │     │
│       │                  │ (Dashboard) │         │    BOT       │     │
│       │                  └─────────────┘         └──────▲───────┘     │
│       │                                                  │             │
│  ┌────▼────┐                                    Node-RED │             │
│  │   UI    │──────MQTT publish──────────────────────────▶│             │
│  │(Streamlit)                                                         │
│  └─────────┘                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Flusso dei Dati — Passo per Passo

### 🔵 Flusso Principale (Dati Sensori)

```
STEP 1  →  STEP 2  →  STEP 3  →  STEP 4  →  STEP 5  →  STEP 6
Sensore     MQTT       Broker     Node-RED   InfluxDB    Grafana
genera    publish()   Mosquitto   parsing    scrittura   Flux query
dato                  routing     + store    time-series  + dashboard
```

**Step 1 — Generazione del dato (sensors/main.py)**

Il container `sensors` crea oggetti `SimulatedSensor`, uno per ogni combinazione *location × tipo_sensore*. Ogni 10 secondi, il metodo `tick()` di ogni sensore:

1. Calcola un nuovo valore con un modello a **random walk + mean reversion**
2. Applica eventuale **override d'emergenza** se c'è un'emergenza attiva per quella location
3. Serializza il dato in un oggetto `SensorData` (dataclass Python → JSON)

```python
# Esempio di dato JSON prodotto
{
    "sensorid": "sensor_01",
    "value": 23.45,
    "timestamp": "2026-02-17T09:30:00.123456",
    "type": "temperature",
    "unit": "°C",
    "lat": 42.3506,
    "lon": 13.3964
}
```

**Step 2 — Pubblicazione MQTT**

Il sensore pubblica il JSON **sul topic MQTT gerarchico**:

```
City/data/{location}/{tipo_sensore}
```

Esempio: `City/data/Piazza del Duomo/temperature`

Il client usa `QoS 1` (at least once delivery) — il broker conferma la ricezione con un `PUBACK`.

**Step 3 — Routing da Mosquitto**

Il broker riceve il messaggio e lo **inoltra a tutti i subscriber** che hanno un topic matching:

- `City/data/#` → Node-RED (riceve TUTTI i dati sensore)
- `City/#` → Analyzer (riceve dati + aggiornamenti)

Il `#` è un **wildcard multi-livello** MQTT: matcha qualsiasi sequenza di sotto-topic.

**Step 4 — Parsing e Storage (Node-RED)**

Node-RED ha un flow con 3 nodi collegati:

1. **MQTT In** (`City/data/#`) — riceve il messaggio raw
2. **Function "JSON Parser"** — estrae i campi dal JSON e li formatta per InfluxDB:
   - Usa il topic MQTT per estrarre `location` e `sensorType`
   - Crea un array `[fields, tags]` nel formato richiesto dal nodo InfluxDB Out
   - I **fields** sono: il valore numerico (con la unit come nome), lat, lon
   - I **tags** sono: sensorid, location, type, timestamp
3. **InfluxDB Out** — scrive il punto dati nel bucket `iot_bucket`

```
InfluxDB Point:
  measurement: "sensors"
  tags: {sensorid: "sensor_01", location: "Piazza del Duomo", type: "temperature"}
  fields: {"°C": 23.45, "lat": 42.3506, "lon": 13.3964}
  timestamp: now()
```

**Step 5 — Storage Time-Series (InfluxDB)**

InfluxDB salva il dato come punto nella **serie temporale**. I dati hanno una retention di **1 settimana** (`DOCKER_INFLUXDB_INIT_RETENTION=1w`) — dopo 7 giorni vengono cancellati automaticamente.

**Step 6 — Visualizzazione (Grafana)**

Grafana fa query **Flux** periodiche (ogni 10s / refresh automatico) a InfluxDB e aggiorna i pannelli della dashboard.

Esempio di query Flux per la mappa:
```flux
from(bucket: "iot_bucket")
  |> range(start: -5m)
  |> filter(fn: (r) => r._measurement == "sensors")
  |> group(columns: ["location", "_field"])
  |> last()
  |> pivot(rowKey: ["location"], columnKey: ["_field"], valueColumn: "_value")
  |> rename(columns: {"lat": "latitude", "lon": "longitude"})
```

---

### 🔴 Flusso Alerting (Analisi + Notifiche)

```
Sensore  →  Mosquitto  →  Analyzer  →  Mosquitto  →  Node-RED  →  Telegram
publish     routing       confronto     publish       format       invio
dato                      con soglia    alert msg     messaggio    notifica
```

**Step 1** — L'Analyzer è sottoscritto a `City/#` e riceve ogni dato sensore

**Step 2** — Confronta il valore con la soglia del tipo corrispondente (es. temperatura > 30°C)

**Step 3** — Se il valore **supera la soglia** e l'alert **non era già attivo** per quel sensore, pubblica un messaggio di alert su:
```
City/alerts/{location}/{tipo_sensore}
```

**Step 4** — Se il valore **torna sotto soglia**, pubblica un messaggio di recovery sullo stesso topic

**Step 5** — Node-RED è sottoscritto a `City/alerts/#`, riceve l'alert, formatta il messaggio e lo invia tramite il **Telegram Bot** al canale configurato

L'Analyzer usa un **dizionario di stato** (`active_alerts`) per implementare un meccanismo di **debouncing**: invia l'alert solo alla prima violazione e il recovery solo quando torna alla normalità, evitando spam di notifiche.

---

### 🟡 Flusso Configurazione (UI → Sistema)

```
UI Streamlit  →  MQTT publish (retain=True)  →  Mosquitto  →  Sensors / Analyzer
```

L'utente dalla UI può:
- **Aggiungere/rimuovere location** → pubblica su `City/update/locations`
- **Modificare soglie** → pubblica su `City/update/thresholds`
- **Cambiare parametri sensori** → pubblica su `City/update/config`
- **Attivare/fermare emergenze** → pubblica su `City/emergency`

I messaggi sono pubblicati con **retain=True**: Mosquitto salva l'ultimo messaggio per ogni topic. Quando un container si riavvia, riceve automaticamente l'ultima configurazione senza perdere lo stato.

---

## 4. Tecnologie Utilizzate

### 4.1 Docker & Docker Compose

**Cos'è Docker?**
Docker è una piattaforma di **containerizzazione** che permette di impacchettare un'applicazione e tutte le sue dipendenze in un'unità isolata chiamata **container**. A differenza delle macchine virtuali, i container condividono il kernel del sistema operativo host, rendendoli molto più leggeri e veloci da avviare.

**Concetti chiave:**
- **Immagine (Image)**: template read-only con il codice, le dipendenze, la configurazione. Definita nel `Dockerfile`
- **Container**: istanza in esecuzione di un'immagine. È isolato ma può comunicare via volumi e network
- **Volume**: meccanismo per persistere dati oltre il ciclo di vita del container
- **Network**: rete virtuale che permette ai container di comunicare tra loro per nome

**Docker Compose** orchestrante multi-container:
```yaml
services:
  sensors:
    build: ./sensors              # Costruisci da Dockerfile
    environment:
      - MQTT_BROKER=${MQTT_BROKER}  # Variabile da .env
    networks:
      - iot_net                    # Stessa rete degli altri
```

**Nel nostro progetto:**
- 7 servizi (InfluxDB, Mosquitto, Grafana, Node-RED, Sensors, Analyzer, UI)
- Tutti sulla stessa rete `iot_net` (comunicano per nome, es. `mosquitto:1883`)
- Le variabili d'ambiente sono centralizzate nel file `.env`
- I `Dockerfile` per sensors, analyzer, UI usano l'immagine base `python:3.9-slim`

**Perché Docker e non esecuzione diretta?**
- **Riproducibilità**: chiunque con Docker può lanciare il progetto con un solo comando
- **Isolamento**: ogni servizio ha il suo ambiente, niente conflitti di dipendenze
- **Scalabilità**: puoi replicare container (`docker compose up --scale sensors=3`)
- **Portabilità**: funziona identicamente su Windows, Linux, macOS

---

### 4.2 MQTT & Eclipse Mosquitto

**Cos'è MQTT?**
MQTT (**Message Queuing Telemetry Transport**) è un protocollo di messaggistica **lightweight** basato sul pattern **publish/subscribe**. È stato progettato per dispositivi con risorse limitate e reti con alta latenza o banda ridotta — perfetto per l'IoT.

**Caratteristiche chiave:**
- **Header minimo**: solo 2 byte di overhead (vs HTTP che ha centinaia di byte di header)
- **Bidirezionale**: un client può sia pubblicare che sottoscrivere
- **Asincrono**: publisher e subscriber non devono essere online contemporaneamente
- **Push model**: i dati arrivano ai subscriber appena disponibili (niente polling)

**Componenti MQTT:**
1. **Broker** (Mosquitto nel nostro caso): server centrale che riceve, filtra e inoltra i messaggi
2. **Publisher**: client che invia messaggi su un topic
3. **Subscriber**: client che si registra per ricevere messaggi da uno o più topic
4. **Topic**: stringa gerarchica che identifica il "canale" (es. `City/data/Piazza del Duomo/temperature`)

**Eclipse Mosquitto** è un broker MQTT open-source, leggero e conformemente allo standard MQTT 3.1/3.1.1/5.0. La configurazione nel progetto:

```conf
persistence true                              # Salva messaggi su disco
persistence_location /mosquitto/data/         # Path di persistenza
listener 1883                                 # Porta TCP standard MQTT
allow_anonymous false                         # Richiede autenticazione
password_file /mosquitto/config/passwordfile.txt  # File con user:hash
```

**Perché MQTT e non HTTP/REST?**
- HTTP è request/response (pull), MQTT è pub/sub (push) → meno traffico
- MQTT mantiene una **connessione persistente** TCP → niente overhead di handshake ripetuti
- Supporta **retained messages** e **QoS** nativamente
- Overhead bassissimo: ideale per migliaia di sensori che inviano dati ogni pochi secondi

---

### 4.3 InfluxDB

**Cos'è InfluxDB?**
InfluxDB è un **Time Series Database (TSDB)** — un database ottimizzato per dati indicizzati nel tempo. A differenza di un database relazionale (MySQL, PostgreSQL), InfluxDB è progettato per:
- Altissimo throughput di **scrittura** (milioni di punti/secondo)
- Query aggregate temporali velocissime (media, max, min su finestre di tempo)
- Compressione nativa dei dati temporali
- Retention policy automatiche (cancella dati vecchi)

**Modello dati:**

```
Measurement: "sensors"
Tags (indicizzati, stringhe):
  - sensorid: "sensor_01"
  - location: "Piazza del Duomo"
  - type: "temperature"
Fields (valori, non indicizzati):
  - °C: 23.45
  - lat: 42.35
  - lon: 13.39
Timestamp: 2026-02-17T09:30:00Z
```

**Tags vs Fields:**
- **Tags** = metadati, indicizzati → usati nei filtri WHERE. Perfetti per location, sensorid, tipo
- **Fields** = valori effettivi, NON indicizzati → i dati numerici misurati
- Le query per tag sono molto più veloci delle query per field

**Linguaggio Flux:**
InfluxDB 2.x usa **Flux**, un linguaggio funzionale per query:

```flux
from(bucket: "iot_bucket")                        // Da quale bucket
  |> range(start: -5m)                            // Ultimi 5 minuti
  |> filter(fn: (r) => r._measurement == "sensors") // Solo sensori
  |> filter(fn: (r) => r._field == "°C")          // Solo temperatura
  |> group(columns: ["location"])                   // Raggruppa per location
  |> mean()                                         // Media per gruppo
```

L'operatore `|>` (pipe-forward) concatena le trasformazioni — ogni step prende l'output del precedente.

**Configurazione nel progetto:**
- Versione: 2.7
- Organizzazione: `iot_org`
- Bucket: `iot_bucket`
- Retention: 1 settimana
- Autenticazione: token `my-super-secret-auth-token`

---

### 4.4 Node-RED

**Cos'è Node-RED?**
Node-RED è un tool di **flow-based programming** sviluppato da IBM. Permette di collegare hardware, API e servizi online tramite un'interfaccia grafica drag-and-drop basata su browser. Ogni "nodo" esegue un'operazione specifica e i dati fluiscono tra nodi collegati da fili.

**Ruolo nel progetto (Middleware/ETL):**
Node-RED funge da **middleware** tra MQTT e InfluxDB. È il componente **ETL** (Extract, Transform, Load):
- **Extract**: riceve i dati grezzi da MQTT
- **Transform**: parsa il JSON, estrae i campi, formatta per InfluxDB
- **Load**: scrive i dati nel database

**Flow del progetto — 4 flussi paralleli:**

```
Flow 1: Dati Sensori
  MQTT In (City/data/#) → JSON Parser (function) → InfluxDB Out

Flow 2: Alerts → Telegram
  MQTT In (City/alerts/#) → Message Setup (function) → Telegram Sender

Flow 3: Threshold Updates
  MQTT In (City/update/#) → Threshold Parser (function) → InfluxDB Out

Flow 4: Emergency Events
  MQTT In (City/emergency) → Emergency Parser (function) → InfluxDB Out

Flow 5: Init (on startup)
  Inject (once) → Default Thresholds (function) → InfluxDB Out
```

**Perché Node-RED e non codice Python diretto?**
- Visuale e intuitivo per flussi di dati
- Ha nodi nativi per MQTT, InfluxDB, Telegram
- Facilmente estensibile senza ricompilare
- Perfetto per **integrazione** tra protocolli diversi

---

### 4.5 Grafana

**Cos'è Grafana?**
Grafana è una piattaforma di **osservabilità e visualizzazione** open-source. Supporta centinaia di data source (InfluxDB, Prometheus, MySQL, ecc.) e offre dashboard interattive, alerting, e annotazioni.

**Componenti nel progetto:**

1. **Datasource** (provisioning/datasources/datasource.yml): configurazione della connessione a InfluxDB con linguaggio Flux

2. **Dashboard** (dashboards/dashboard.json): ~5000 righe di JSON che definiscono:
   - 🗺️ **Mappa Geomap** — posizione dei sensori su OpenStreetMap con cerchi colorati in base alla percentuale di soglia
   - 📡 **Active Sensors** — conteggio sensori attivi
   - 🚨 **Threshold Violations** — conteggio sensori sopra soglia
   - 🌿 **Environmental Quality Index** — gauge 0-100% calcolato invertendo i ppm CO₂
   - ⏱️ **Data Freshness** — tempo dall'ultimo dato ricevuto
   - 🌡️💧🌫️🚗🔊🏔️🌧️ **Gauge per ogni tipo** di sensore
   - 📈 **Grafici time-series** per l'andamento storico
   - 📊 **Heatmap** dei valori normalizzati come % della soglia
   - 📡 **Sensor Liveness** — timeline che mostra se ogni sensore sta inviando dati
   - 🚨 **Emergency section** — stato emergenza, timeline, log

3. **Alerting** (provisioning/alerting/rules.yml): regole di alerting Grafana Unified Alerting che verificano ogni minuto se i valori medi superano le soglie. Separate dall'Analyzer per **ridondanza**.

4. **Template Variables** — il selettore `$location` in alto nella dashboard permette di filtrare per location. Tutte le query Flux usano `r.location =~ /^${location:regex}$/`.

**Provisioning:**
Grafana carica automaticamente datasource, dashboard e regole di alerting dai file YAML/JSON nelle cartelle `provisioning/`. Non serve configurazione manuale.

---

### 4.6 Streamlit (UI)

**Cos'è Streamlit?**
Streamlit è un framework Python per creare **web app interattive** con poche righe di codice. Perfetto per dashboard di controllo, non richiede conoscenze di HTML/CSS/JS.

**Ruolo nel progetto:**
L'UI Streamlit (porta 8501) è il **pannello di controllo** dell'intero sistema. Permette di:

1. **Gestire le location** — aggiungere preset famosi de L'Aquila o coordinate manuali, rimuovere location
2. **Configurare le soglie** — slider per ogni tipo di sensore
3. **Aggiungere tipi di sensore** — nuovi sensori completamente custom
4. **Simulare emergenze** — 5 scenari predefiniti (incendio, alluvione, terremoto, fuga di gas, incidente)
5. **Monitoraggio stato** — connessione MQTT, location attive, tipi sensori

Ogni azione pubblica un messaggio MQTT che viene ricevuto in real-time dai container sensors/analyzer.

---

### 4.7 Telegram Bot

Un bot Telegram (`mpga_alert_bot`) invia notifiche al canale configurato quando l'Analyzer rileva violazioni di soglia. Il flusso:

1. Analyzer pubblica su `City/alerts/{location}/{type}`
2. Node-RED riceve il messaggio (MQTT In `City/alerts/#`)
3. Il nodo Function formatta il payload per il nodo Telegram Sender
4. Il messaggio viene inviato al canale Telegram tramite Bot API

Questo implementa il principio IoT di **notifica push** — l'utente viene informato proattivamente senza dover controllare la dashboard.

---

### 4.8 Python & Paho MQTT

**Paho MQTT** è la libreria client MQTT ufficiale di Eclipse Foundation per Python. Gestisce:
- Connessione TCP persistente con il broker
- Reconnect automatico in caso di disconnessione
- Thread separato per il network loop (`loop_start()` / `loop_forever()`)
- Callback pattern: `on_connect`, `on_message`, `on_disconnect`

```python
client = mqtt.Client()
client.on_connect = on_connect    # Chiamata quando la connessione è stabilita
client.on_message = on_message    # Chiamata ad ogni messaggio ricevuto
client.username_pw_set(user, password)
client.connect(broker, 1883, keepalive=60)
client.loop_start()  # Thread di background per gestire la rete
```

**Dataclass `SensorData`:**
Struttura dati condivisa tra sensors e analyzer tramite volume mount di `datastructure.py`. Usa le Python dataclass per:
- Serializzazione JSON (`to_json()`)
- Deserializzazione JSON (`from_json()`)
- Tipizzazione forte del dato

---

## 5. Dettaglio dei Componenti

### 5.1 Sensors Container

**File**: `sensors/main.py`

**Responsabilità**: Simulare una rete di sensori IoT distribuiti

**Logica di generazione dati:**
- **Random Walk**: il valore precedente +/- un cambiamento casuale basato sulla `volatility`
- **Mean Reversion**: per sensori come pioggia e sismico, il valore tende a tornare al minimo (realistico: non piove sempre)
- **Anomaly Injection**: 10% di probabilità di un picco più grande (simula eventi reali)
- **Seismic Model**: modello a 4 fasce di probabilità:
  - 92%: rumore di fondo (0-0.5 Mw)
  - 6%: micro-tremor (0.5-2.0 Mw)
  - 1.5%: evento moderato (2.0-4.0 Mw)
  - 0.5%: terremoto forte (4.0-7.0 Mw)

**Configurazione dinamica:**
Il container si sottoscrive a 3 topic MQTT per ricevere aggiornamenti in tempo reale:
- `City/update/locations` — cambio delle location monitorate
- `City/update/config` — cambio parametri sensori (tipi, densità)
- `City/emergency` — attivazione/disattivazione emergenza

Quando riceve un aggiornamento, **rigenera** tutti i sensori con `generate_sensors()`.

**Emergency Override:**
Quando un'emergenza è attiva per una location, i sensori di quella location forzano valori estremi tramite gli `effects` definiti nello scenario. Esempio per incendio:
```python
effects = {"temperature": 75.0, "co2": 2500.0, "noise_level": 95.0}
```
I valori vengono leggermente randomizzati (±2.0) per realismo.

---

### 5.2 Analyzer Container

**File**: `analyzer/main.py`

**Responsabilità**: Analizzare i dati in tempo reale e generare alert

**Logica:**
1. Riceve **ogni** messaggio su `City/#`
2. Deserializza il JSON usando `SensorData.from_json()`
3. Confronta il valore con la soglia del tipo (`THRESHOLDS`)
4. Se `valore > soglia` e `alert non già attivo per quel sensor_id`:
   - Pubblica alert su `City/alerts/{location}/{tipo}`
   - Segna `active_alerts[sensor_id] = True`
5. Se `valore <= soglia` e `alert era attivo`:
   - Pubblica recovery
   - Segna `active_alerts[sensor_id] = False`

**Debouncing**: Il dizionario `active_alerts` previene notifiche ripetute. L'alert viene inviato solo al **cambio di stato** (normale→alert o alert→normale), non ad ogni lettura.

**Soglie dinamiche**: L'Analyzer si sottoscrive anche a `City/update/thresholds` e aggiorna in memoria le soglie tramite `THRESHOLDS.update()`.

---

### 5.3 Node-RED Middleware

**File**: `nodered/data/flows.json`

Node-RED ha 5 flussi paralleli:

| # | Input | Processing | Output |
|---|-------|-----------|--------|
| 1 | `City/data/#` | JSON Parser → estrae fields/tags | InfluxDB (measurement: sensors) |
| 2 | `City/alerts/#` | Message Setup → chat_id | Telegram Bot |
| 3 | `City/update/#` | Threshold Parser → filtra solo thresholds | InfluxDB (measurement: thresholds) |
| 4 | `City/emergency` | Emergency Parser → severity level mapping | InfluxDB (measurement: emergencies) |
| 5 | Inject (startup, once) | Default Thresholds → valori iniziali | InfluxDB (measurement: thresholds) |

**JSON Parser (Flow 1) — il cuore:**
```javascript
var topicParts = msg.topic.split('/');
var location = topicParts[2];      // Es: "Piazza del Duomo"
var sensorType = topicParts[3];    // Es: "temperature"
var unit = data.unit;              // Es: "°C"

var fields = {};
fields[unit] = parseFloat(data.value);  // Es: "°C": 23.45
fields["lat"] = parseFloat(data.lat);
fields["lon"] = parseFloat(data.lon);

msg.measurement = "sensors";
msg.payload = [
    fields,                         // ← InfluxDB Fields
    { sensorid, location, type }    // ← InfluxDB Tags
];
```

Questo è fondamentale: la unit diventa il **nome del field** in InfluxDB. Quindi i dati di temperatura sono nel field `°C`, l'umidità in `%`, il CO₂ in `ppm`, ecc. Le query Grafana filtrano per `r._field == "°C"`.

---

### 5.4 Dashboard Grafana

La dashboard è divisa in sezioni logiche:

**Sezione 1 — Smart City Map**
- Mappa OpenStreetMap con marker sui punti monitorati
- Colore del marker basato sulla % di soglia per quel punto
- Pannelli laterali: sensori attivi, violazioni, indice qualità aria, data freshness

**Sezione 2 — Live Sensor Status**
- 7 gauge, uno per tipo di sensore, con soglie colorate (verde/giallo/rosso)
- Mostrano la media attuale delle ultime letture

**Sezione 3 — Trend & History**
- Grafici time-series per ogni tipo di sensore
- Mostrano l'andamento nel tempo, utili per identificare pattern

**Sezione 4 — Heatmap & Sensor Liveness**
- **Threshold % Heatmap**: tutti i valori normalizzati come % della soglia del proprio tipo. Se il valore è al 100% = soglia raggiunta
- **Sensor Liveness**: timeline che mostra se ogni sensore sta inviando dati. Verde = ONLINE, rosso = OFFLINE

**Sezione 5 — Alerts & Violations**
- Log tabellare delle violazioni di soglia
- Timeline storica degli alert

**Sezione 6 — Emergency**
- Stato emergenza attiva
- Conteggio eventi
- Timeline severità

---

### 5.5 UI Control Panel

L'UI Streamlit (porta 8501) è organizzata in 3 sezioni:

**Sezione 1 — Location Management**
- Preset de L'Aquila con coordinate GPS reali
- Input manuale per coordinate custom
- Ogni location ha lat/lon usati per la mappa Grafana e i sensori

**Sezione 2 — Sensor & Alert Configuration**
- Slider per ogni soglia
- Form per aggiungere nuovi tipi di sensore
- Configurazione densità sensori (sensori per tipo per location)

**Sezione 3 — Emergency Simulation**
- 5 scenari predefiniti con effetti sui sensori
- Selettore di location e severità
- Pulsante di stop emergenza

---

## 6. Pattern di Comunicazione

### 6.1 Publish/Subscribe (Pub/Sub)

Il pattern **Pub/Sub** è il fondamento di MQTT. A differenza del modello request/response (HTTP), nel Pub/Sub:

- **Publisher** e **Subscriber** sono **disaccoppiati**: non si conoscono a vicenda
- Il **Broker** funge da intermediario: il publisher invia al broker, il broker distribuisce ai subscriber
- **Disaccoppiamento spaziale**: publisher e subscriber non devono conoscersi
- **Disaccoppiamento temporale**: non devono essere online contemporaneamente (grazie ai retained messages)
- **Disaccoppiamento di sincronizzazione**: le operazioni sono asincrone

```
Publisher                    Broker                    Subscriber
    |                          |                          |
    |-- PUBLISH topic: A/B --->|                          |
    |                          |--- PUBLISH topic: A/B -->|
    |                          |                          |
    |                          |   (se QoS 1)             |
    |<---- PUBACK -------------|<---- PUBACK -------------|
```

Nel nostro progetto:
- I **Sensors** sono publisher sui topic `City/data/...`
- L'**Analyzer** è subscriber su `City/#` e publisher su `City/alerts/...`
- **Node-RED** è subscriber su più topic e agisce come bridge verso InfluxDB e Telegram
- La **UI** è publisher su `City/update/...` e `City/emergency`

---

### 6.2 Topic Hierarchy

MQTT organizza i topic in una **gerarchia ad albero** con `/` come separatore:

```
City/
├── data/
│   ├── Piazza del Duomo/
│   │   ├── temperature
│   │   ├── humidity
│   │   ├── co2
│   │   └── ...
│   ├── Fontana delle 99 Cannelle/
│   │   └── ...
│   └── Forte Spagnolo/
│       └── ...
├── alerts/
│   ├── Piazza del Duomo/
│   │   └── temperature
│   └── ...
├── update/
│   ├── locations
│   ├── config
│   └── thresholds
└── emergency
```

**Wildcards:**
- `+` → matcha **un** livello: `City/data/+/temperature` riceve la temperatura di TUTTE le location
- `#` → matcha **tutti** i livelli restanti: `City/data/#` riceve TUTTO sotto `City/data/`

---

### 6.3 Retained Messages

Un messaggio pubblicato con `retain=True` viene **salvato dal broker** come l'ultimo messaggio per quel topic. Quando un nuovo subscriber si connette, riceve immediatamente l'ultimo messaggio retained.

**Uso nel progetto:**
- Le configurazioni (locations, thresholds, emergency) sono retained
- Se il container sensors si riavvia, riceve subito l'ultima configurazione
- Il flag `RESTORE_SESSION` controlla se i container accettano i messaggi retained al riavvio

**Senza retained messages:**
Se i sensors si riavviassero, non saprebbero quali location monitorare fino al prossimo aggiornamento dalla UI. Con il retain, il broker gli invia subito l'ultima configurazione pubblicata.

---

### 6.4 Quality of Service (QoS)

MQTT definisce 3 livelli di QoS che bilanciano **affidabilità** vs **overhead**:

| QoS | Nome | Garantia | Overhead | Uso nel progetto |
|-----|------|----------|----------|------------------|
| 0 | At most once | Nessuna, fire-and-forget | Minimo | Analyzer subscribe su `City/#` |
| 1 | At least once | Almeno una consegna (PUBACK) | Medio | Sensors publish, Config updates |
| 2 | Exactly once | Esattamente una (4-way handshake) | Alto | Non usato |

**QoS 0**: Il messaggio potrebbe perdersi. OK per dati sensori ad alta frequenza — ne arriva uno ogni 10 secondi, se ne perdi uno non è grave.

**QoS 1**: Il broker conferma la ricezione. Se non riceve il PUBACK, ritrasmette. Potrebbe causare duplicati. Usato per configurazioni e alert che non devono perdersi.

**QoS 2**: Handshake a 4 step (PUBLISH → PUBREC → PUBREL → PUBCOMP). Nessun duplicato, nessuna perdita. Troppo overhead per il nostro caso.

---

## 7. Gestione delle Emergenze

Il sistema implementa un **meccanismo di simulazione emergenze** end-to-end:

**5 scenari predefiniti:**

| Emergenza | Effetti sui sensori |
|-----------|-------------------|
| 🔥 Incendio | temp: 75°C, CO₂: 2500 ppm, rumore: 95 dB |
| 🌊 Alluvione | pioggia: 180 mm/h, umidità: 99%, traffico: 0 km/h |
| 🏚️ Terremoto | sismico: 7.5 Mw, rumore: 110 dB, traffico: 0 km/h |
| ☣️ Fuga di Gas | CO₂: 3000 ppm, rumore: 70 dB |
| 🚗 Incidente | traffico: 0 km/h, rumore: 95 dB |

**Flusso:**
1. Operatore seleziona scenario, location e severità dalla UI
2. UI pubblica su `City/emergency` con `retain=True`
3. Sensors ricevono l'emergenza e forzano valori estremi per la location indicata
4. I valori estremi triggerano gli alert dell'Analyzer
5. Analyzer pubblica su `City/alerts/...`
6. Node-RED invia notific Telegram
7. Node-RED salva l'evento emergenza su InfluxDB (measurement: `emergencies`)
8. Grafana visualizza lo stato emergenza nella dashboard

L'emergenza viene **fermata** pubblicando `{"active": false}` sullo stesso topic.

---

## 8. Sistema di Alerting

Il progetto ha **due sistemi di alerting indipendenti** per ridondanza:

### Sistema 1: Analyzer + Telegram (Push immediato)
- Analisi in tempo reale di ogni dato
- Notifica Telegram immediata via Node-RED
- Debouncing per evitare spam
- Soglie dinamiche dall'UI

### Sistema 2: Grafana Unified Alerting (Dashboard-based)
- Regole definite in `provisioning/alerting/rules.yml`
- Ogni tipo di sensore ha la sua regola (temperatura > 30, umidità > 80, CO₂ > 1000, ecc.)
- Verifica ogni 1 minuto, firma alert dopo 2 minuti (`for: 2m`)
- Contatto: email (configurabile) a `admin@smartcity.local`
- Visibile nella dashboard Grafana come icono di alert

**Perché due sistemi?**
- L'Analyzer è **real-time** (reagisce in < 1 secondo) ma potrebbe crashare
- Grafana è più **resiliente** (valuta query aggregate ogni minuto) e ha UI di gestione alert integrata
- In un sistema IoT reale, la ridondanza è essenziale

---

## 9. Concetti Teorici IoT

### 9.1 Cos'è l'IoT

L'**Internet of Things** è un paradigma in cui oggetti fisici ("things") sono dotati di sensori, attuatori, e connettività di rete per raccogliere e scambiare dati senza intervento umano.

**Caratteristiche fondamentali:**
- **Sensing**: capacità di misurare grandezze fisiche (temperatura, umidità, ecc.)
- **Connectivity**: comunicazione tramite protocolli (MQTT, CoAP, HTTP, BLE)
- **Data Processing**: analisi dei dati raccolti (edge o cloud)
- **Actuation**: capacità di agire sull'ambiente (nel nostro caso: alerting)
- **Scalabilità**: gestione di migliaia/milioni di dispositivi

**Nel nostro progetto**: simuliamo una rete di ~7 sensori per location, ciascuno con coordinate GPS, che inviano dati ogni 10 secondi al broker centrale.

---

### 9.2 Architettura a Livelli dell'IoT

L'architettura IoT è tipicamente organizzata in **4 livelli**:

```
┌─────────────────────────────────────┐
│  LIVELLO 4: APPLICAZIONE            │  ← Grafana Dashboard, UI Streamlit
│  Visualizzazione, Business Logic    │
├─────────────────────────────────────┤
│  LIVELLO 3: PROCESSING              │  ← Analyzer, Node-RED, Grafana Alerting
│  Analisi dati, Alerting, ETL        │
├─────────────────────────────────────┤
│  LIVELLO 2: NETWORK / TRANSPORT     │  ← MQTT (Mosquitto), Docker Network
│  Comunicazione e routing messaggi   │
├─────────────────────────────────────┤
│  LIVELLO 1: PERCEPTION / DEVICE     │  ← Sensors Container
│  Raccolta dati dal mondo fisico     │
└─────────────────────────────────────┘
```

**Mapping sul nostro progetto:**
- **Perception**: Il container sensors simula dispositivi fisici. In un progetto reale sarebbero ESP32, Raspberry Pi, Arduino con sensori reali
- **Network**: MQTT su TCP/IP. Il broker Mosquitto gestisce il routing dei messaggi
- **Processing**: L'Analyzer fa real-time analysis. Node-RED fa ETL. InfluxDB storage
- **Application**: Grafana per monitoring, Streamlit per controllo, Telegram per notifiche

---

### 9.3 Edge vs Cloud Computing

| | Edge Computing | Cloud Computing |
|---|---|---|
| **Dove** | Vicino al dispositivo | Data center remoto |
| **Latenza** | Bassa (ms) | Alta (100ms+) |
| **Bandwidth** | Ridotto (pre-processing locale) | Alto (raw data upload) |
| **Privacy** | Dati rimangono in locale | Dati su server esterno |
| **Scalabilità** | Limitata dal device | Praticamente illimitata |
| **Esempio** | Sensor che pre-filtra dati anomali | InfluxDB su AWS |

**Nel nostro progetto**: Il sistema è ibrido ma tendenzialmente **fog/edge**:
- I sensori fanno **pre-processing locale** (il modello di random walk è locale)
- L'Analyzer fa **edge analytics** (confronto soglie in tempo reale, debouncing)
- InfluxDB fa **storage centralizzato** (ma locale, non cloud)
- Tutto gira su un **singolo host Docker** = fog computing

In produzione, i sensori sarebbero su dispositivi edge (ESP32), l'Analyzer su un gateway locale, e InfluxDB/Grafana potenzialmente in cloud.

---

### 9.4 Time Series Database

Un TSDB è ottimizzato per dati con una **dimensione temporale dominante**. Differenze rispetto a un RDBMS:

| Aspetto | RDBMS (MySQL) | TSDB (InfluxDB) |
|---------|---------------|-----------------|
| Schema | Fisso (SQL DDL) | Schemaless (tags + fields dinamici) |
| Write focus | Read-heavy, transazioni ACID | Write-heavy, append-only |
| Query tipica | JOIN tra tabelle | Aggregazioni su range temporali |
| Compressione | Generica | Ottimizzata per serie temporali |
| Retention | Manuale | Automatica per policy |
| Indexing | B-Tree su colonne | Hash index su tag + TSM (Time-Structured Merge Tree) |

**Perché non un semplice SQL?**
Con 7 sensori × 7 tipi × 1 lettura/10s = ~5 punti/secondo. Sembra poco, ma in produzione con centinaia di location e più sensori, arriviamo a migliaia di write/secondo. InfluxDB gestisce questo con:
- **Write-Ahead Log (WAL)** per durabilità
- **TSM Engine** per compressione fino a 10x
- **Retention policy** automatiche (nel nostro caso: 1 settimana)

---

### 9.5 Il Protocollo MQTT in Profondità

**Architettura del pacchetto MQTT:**

```
┌──────────────────────────────────────┐
│ Fixed Header (2 bytes)               │
│  ├── Packet Type (4 bits)            │  CONNECT, PUBLISH, SUBSCRIBE...
│  ├── Flags (4 bits)                  │  DUP, QoS, RETAIN
│  └── Remaining Length (1-4 bytes)    │
├──────────────────────────────────────┤
│ Variable Header (dipende dal tipo)   │
│  • CONNECT: Protocol name, version   │
│  • PUBLISH: Topic name, Packet ID    │
├──────────────────────────────────────┤
│ Payload                              │
│  • CONNECT: Client ID, User, Pass    │
│  • PUBLISH: Messaggio effettivo      │
│  • SUBSCRIBE: Lista di topic + QoS   │
└──────────────────────────────────────┘
```

**Ciclo di vita della connessione:**

```
Client                           Broker
  |                                |
  |--- CONNECT ------------------>|  (clientId, username, password, keepAlive=60s)
  |<-- CONNACK -------------------|  (returnCode=0 → successo)
  |                                |
  |--- SUBSCRIBE (City/#, QoS1)-->|
  |<-- SUBACK --------------------|
  |                                |
  |--- PUBLISH (City/data/...) -->|  (QoS 1)
  |<-- PUBACK --------------------|
  |                                |
  |         (ogni 60s)             |
  |--- PINGREQ ------------------>|
  |<-- PINGRESP ------------------|
  |                                |
  |--- DISCONNECT --------------->|
```

**Keep Alive**: Il client deve inviare un `PINGREQ` almeno ogni `keepAlive` secondi. Se il broker non riceve nulla per 1.5x keepAlive, considera il client disconnesso.

**Last Will and Testament (LWT)**: Un client può registrare un messaggio "testamento" al CONNECT. Se il broker rileva una disconnessione anomala, pubblica automaticamente quel messaggio. Utile per rilevare guasti.

**Clean Session vs Persistent Session**: Con `cleanSession=false`, il broker mantiene le sottoscrizioni e i messaggi in coda anche se il client si disconnette. Al reconnect, riceve i messaggi persi. Nel nostro progetto usiamo `cleanSession=true` + retained messages.

---

### 9.6 Digital Twin

Un **Digital Twin** è una replica virtuale di un'entità fisica. Nel nostro progetto:

- Le **location** de L'Aquila con coordinate GPS reali = digital twin della città
- I **SimulatedSensor** con modelli di generazione realistici = digital twin di sensori fisici
- La **dashboard Grafana** con la mappa = visualizzazione del digital twin
- I **parametri configurabili** (volatilità, range, soglie) = calibrazione del twin

Il concetto di Digital Twin è fondamentale nell'IoT industriale: permette di testare scenari (emergenze) senza rischi e di prevedere comportamenti futuri.

---

### 9.7 MAPE-K Loop (SE4AS)

Il **MAPE-K** è il modello di riferimento per i **Self-Adaptive Systems** (SE4AS = Software Engineering for Adaptive Systems):

```
        ┌──────────────────────────────────────────┐
        │           KNOWLEDGE (K)                   │
        │         InfluxDB + Thresholds             │
        └──────┬───────────┬───────────┬────────────┘
               │           │           │
    ┌──────────▼──┐  ┌─────▼─────┐  ┌──▼──────────┐  ┌──────────┐
    │  MONITOR    │  │  ANALYZE  │  │   PLAN       │  │ EXECUTE  │
    │             │→│            │→│              │→│           │
    │ Sensors +   │  │ Analyzer  │  │ UI/Analyzer  │  │ Sensors  │
    │ Node-RED    │  │ Threshold │  │ Alert/Config │  │ Override │
    │ InfluxDB    │  │ Comparison│  │ Decision     │  │ + Notify │
    └─────────────┘  └───────────┘  └──────────────┘  └──────────┘
```

**Mapping sul progetto:**

| MAPE-K | Componente | Descrizione |
|--------|-----------|-------------|
| **Monitor** | Sensors → MQTT → Node-RED → InfluxDB | Raccolta continua di dati ambientali |
| **Analyze** | Analyzer (confronto soglie) + Grafana Alerting | Rilevamento anomalie e violazioni |
| **Plan** | Analyzer (debouncing logic) + UI (policy soglie) | Decisione su quando e come reagire |
| **Execute** | MQTT publish alert → Telegram + Grafana alert firing | Attuazione della risposta |
| **Knowledge** | InfluxDB (dati storici) + Thresholds (soglie) + Config (parametri) | Base di conoscenza condivisa |

**Proprietà di Self-Adaptation nel progetto:**
- **Self-Monitoring**: il sistema monitora continuamente sé stesso (Sensor Liveness)
- **Self-Configuration**: le location, i parametri e le soglie possono essere cambiati a runtime via MQTT
- **Self-Healing**: se un container crasha, Docker lo riavvia (`restart: unless-stopped`) e i retained messages ripristinano lo stato
- **Self-Alerting**: il sistema genera automaticamente alert e notifiche

---

### 9.8 Self-Adaptive Systems

Un **sistema self-adaptive** è capace di modificare il proprio comportamento a runtime in risposta a cambiamenti nell'ambiente o nei requisiti.

**I 4 principi nel nostro progetto:**

1. **Awareness**: Il sistema è consapevole del suo stato
   - Sensor Liveness: sa se i sensori inviano dati
   - Threshold Violations: sa quanti sensori sono in allarme
   - Data Freshness: sa quanto sono recenti i dati

2. **Dynamics**: Il sistema cambia a runtime
   - Aggiunta/rimozione location senza restart
   - Cambio soglie senza restart
   - Attivazione emergenze senza restart
   - Tutto via MQTT con retained messages

3. **Autonomy**: Il sistema reagisce senza intervento umano diretto
   - L'Analyzer genera alert autonomamente
   - Le notifiche Telegram partono automaticamente
   - Grafana fa alert in modo indipendente

4. **Robustness**: Il sistema tollera guasti
   - Container Docker con auto-restart
   - Retained messages preservano stato
   - Due sistemi di alerting ridondanti
   - InfluxDB con WAL per durabilità

---

## 10. Configurazione e Deploy

### File `.env`
Tutte le variabili d'ambiente sono centralizzate nel file `.env`. Docker Compose lo legge automaticamente.

### Deploy completo
```bash
docker compose up -d --build --remove-orphans
```
Questo comando:
1. Costruisce le immagini per sensors, analyzer, UI, Node-RED (da Dockerfile)
2. Scarica le immagini base per InfluxDB, Mosquitto, Grafana
3. Crea la rete `iot_net`
4. Avvia tutti i container in ordine di dipendenza
5. `--remove-orphans` rimuove container orfani

### Porte esposte
| Servizio | Porta | URL |
|----------|-------|-----|
| Grafana | 3000 | http://localhost:3000 |
| InfluxDB | 8086 | http://localhost:8086 |
| Node-RED | 1880 | http://localhost:1880 |
| UI Streamlit | 8501 | http://localhost:8501 |
| Mosquitto | 1883 | mqtt://localhost:1883 |

---

## 11. Come Spiegare il Progetto al Professore

### Apertura (30 secondi)
> "Ho realizzato un sistema IoT per Smart City che monitora in tempo reale parametri ambientali della città de L'Aquila. Il sistema comprende 7 microservizi containerizzati Docker che comunicano tramite il protocollo MQTT seguendo il pattern publish/subscribe."

### Architettura (1 minuto)
> "L'architettura segue il modello a 4 livelli IoT: al livello Perception ho sensori simulati in Python che generano dati realistici per 7 parametri ambientali con coordinate GPS. Al livello Network uso MQTT con broker Mosquitto per il routing dei messaggi. Al livello Processing ho un Analyzer Python per il real-time alerting e Node-RED come middleware ETL verso InfluxDB. Al livello Application ho una dashboard Grafana per la visualizzazione e un pannello di controllo Streamlit per la configurazione a runtime."

### Flusso dati (1 minuto)
> "I sensori pubblicano dati JSON su topic MQTT gerarchici come `City/data/Piazza del Duomo/temperature`. Il broker Mosquitto li distribuisce a tutti i subscriber: Node-RED li parsa e scrive su InfluxDB, l'Analyzer li confronta con le soglie e genera alert se necessario. Gli alert vengono inviati via Telegram tramite Node-RED. Grafana fa query Flux su InfluxDB per la dashboard real-time."

### Aspetti SE4AS — Self-Adaptive (1 minuto)
> "Il progetto implementa il MAPE-K loop: il Monitor è la raccolta dati sensori, l'Analyze è il confronto con soglie nell'Analyzer, il Plan è la logica di debouncing e la configurazione delle policy via UI, l'Execute è l'invio degli alert e L'override dei sensori in emergenza. La Knowledge è il database InfluxDB con i dati storici e le soglie. Il sistema è self-adaptive perché le location, le soglie e i parametri possono essere cambiati a runtime via MQTT senza riavvii."

### Scelte tecnologiche chiave (30 secondi)
> "Ho scelto MQTT invece di HTTP perché è ottimizzato per IoT: 2 byte di overhead, connessione persistente, pattern pub/sub. InfluxDB come time-series database per l'altissimo throughput di scrittura e le query aggregate temporali. Docker Compose per la riproducibilità e l'isolamento. Il file `.env` centralizza tutte le configurazioni."

### Demo live (mostra)
1. Apri Grafana → mostra la mappa con i sensori
2. Apri la UI → aggiungi una location → mostra che appare sulla mappa
3. Attiva un'emergenza → mostra i valori che salgono sulla dashboard
4. Mostra la notifica Telegram arrivata
5. Ferma l'emergenza → valori tornano normali

---

> **Nota finale**: Questo progetto dimostra la comprensione pratica dei concetti chiave dell'IoT (protocolli, architetture, database temporali, alerting) e dei Self-Adaptive Systems (MAPE-K, self-configuration, self-healing, self-monitoring) applicati a uno scenario reale di Smart City.
