# Specifica — Monitor v2 e simulatore del complesso residenziale

| | |
|---|---|
| **Stato** | Design approvato sezione per sezione il 2026-09-30, in attesa di revisione della specifica scritta |
| **Progetto** | SE4AS — Smart Building Environmental Manager (MAPE-K) |
| **Documento di stato** | [`docs/MONITOR.md`](../../MONITOR.md) (decisioni D0–D13, avanzamento) |
| **Sostituisce** | Monitor v1 "Smart City": `sensors/main.py`, topic `City/data/…`, measurement `sensors` |

---

## 1. Obiettivo e perimetro

### 1.1 Obiettivo
Sostituire la simulazione "Smart City" con un **complesso residenziale all'Aquila** (4 palazzi intorno a un parco) e costruire un **Monitor** completo per il ciclo MAPE-K, che:

1. osserva l'ambiente interno ed esterno **e** lo stato degli attuatori;
2. riceve un mondo simulato che **reagisce ai comandi** degli attuatori, così il ciclo MAPE-K si chiude;
3. controlla la qualità dei dati (valori impossibili, sensori bloccati, in deriva o spenti);
4. calcola i valori aggregati (consumi, bilancio energetico, persone presenti);
5. rende tutto disponibile su MQTT e nella Knowledge (InfluxDB).

### 1.2 Dentro il perimetro
- Nuovo servizio **`simulator`**: la risorsa gestita (modello del complesso, orologio simulato, fisica, persone, sensori, attuatori, scenari, guasti).
- Nuovo servizio **`monitor`**: la fase M del MAPE-K.
- File del modello **`config/complex.json`** (Knowledge statica).
- Nuovo contratto MQTT `Complex/…` e nuovo schema InfluxDB.
- **Adeguamento minimo** di Analyzer, Planner/Executor, Node-RED, UI e Grafana ai nuovi topic e nomi, perché continuino a funzionare (tappa 4).

### 1.3 Fuori dal perimetro
- Le **nuove regole** di Analyzer e Planner (comfort, energia, conflitti tra obiettivi, reazioni agli scenari): è il prossimo sotto-progetto, con una sua specifica. Qui la colonna "reazione attesa" degli scenari serve solo come riferimento.
- La **vista 3D**: sotto-progetto successivo. Qui si prepara solo il campo `layout` nel modello.
- Le coordinate GPS del complesso: restano `null` finché non vengono scelte.

---

## 2. Decisioni di riferimento

Il dettaglio è in `docs/MONITOR.md`; qui un riepilogo.

| # | Decisione |
|---|---|
| D1–D2 | Complesso residenziale all'Aquila: 4 palazzi smart con un parco al centro, dove stanno i sensori esterni |
| D3 | Il traffico conta solo come fonte di rumore (e di polveri sottili); `traffic_speed` eliminato |
| D4 | L'unità monitorata è l'appartamento: 4 palazzi × 4 piani × 2 appartamenti = 32, più un vano scale per palazzo |
| D5 | 414 sensori (sezione 6) |
| D6 | Il parco è una risorsa gestita: irrigazione e illuminazione pubblica |
| D7–D8 | 283 attuatori (sezione 6) |
| D9 | Parcheggio condominiale con 4 colonnine |
| D10 | Orologio simulato separato: dati in tempo reale, fisica in ora simulata |
| D11–D12 | 14 scenari (sezione 9) |
| D13 | Due servizi separati: `simulator` (risorsa gestita) e `monitor` (fase M) |

---

## 3. Architettura

```
                   config/complex.json
                          │ (letto all'avvio)
                          ▼
┌───────────────────────────────────────┐        ┌──────────────────────────────┐
│ simulator  (risorsa gestita)          │  raw   │ monitor  (fase M del MAPE-K) │
│ model · clock · environment · physics │──────► │ collector · validator        │
│ occupancy · devices · scenarios       │ state  │ derived · publisher          │
└───────────────────────────────────────┘──────► └──────────────────────────────┘
      ▲ cmd                │ ack, model, clock,             │ monitored, health
      │                    │ scenarios, status              ▼
┌─────┴──────────┐         ▼                        ┌───────────────┐   ┌──────────┐
│ Planner/Exec.  │◄──── broker MQTT (Mosquitto) ───►│ Analyzer      │   │ InfluxDB │
└────────────────┘                                  └───────────────┘   └──────────┘
       UI ──control──► simulator        Node-RED: Telegram, admin policy, scenario_events
```

### 3.1 Regola d'oro
Il manager autonomo (Analyzer, Planner/Executor) **legge solo** `Complex/monitored/…` e `Complex/health/…` e **scrive solo** `Complex/cmd/…`. Uniche eccezioni in lettura: `Complex/model` e `Complex/clock`, che sono contesto. È **vietato** al manager leggere `Complex/raw/…`, `Complex/state/…` e `Complex/scenarios`.

### 3.2 Servizio `simulator/` (Python 3.11)

| Modulo | Responsabilità |
|---|---|
| `model.py` | Carica e valida `config/complex.json`, espande i modelli ripetibili, calcola le adiacenze, produce il modello completo |
| `clock.py` | Ora simulata; velocità ×1…×60; salto a un'ora o a una data |
| `environment.py` | Esterno: sole, meteo, temperatura, rumore del traffico, PM, sismico, terreno del parco |
| `physics.py` | Stato fisico di appartamenti e vani scala; effetti degli attuatori; incendio, gas, CO; energia |
| `occupancy.py` | Presenza delle persone secondo i profili; evacuazione; auto elettriche |
| `devices.py` | Sensori (lettura, rumore di misura, saturazione, guasti) e attuatori (comandi, ack, stato, guasti) |
| `scenarios.py` | Avvio e arresto dei 14 scenari come modifiche dei parametri |
| `main.py` | Ciclo principale, connessione MQTT, Last Will |

### 3.3 Servizio `monitor/` (Python 3.11)

| Modulo | Responsabilità |
|---|---|
| `collector.py` | Iscrizione a `Complex/raw/#`, `Complex/state/#`, `Complex/model`, `Complex/status/simulator` |
| `validator.py` | Catena di controlli (sezione 10) e stato di salute di ogni dispositivo |
| `derived.py` | Valori aggregati per palazzo e complesso |
| `publisher.py` | Pubblica su `Complex/monitored/…` e `Complex/health/…`; scrive in InfluxDB a blocchi |
| `main.py` | Avvio, connessione MQTT, Last Will |

Il `monitor` **non legge** `config/complex.json`: riceve il modello completo da `Complex/model`, così resta indipendente dal formato del file.

### 3.4 Librerie
`paho-mqtt` 2.x con `CallbackAPIVersion.VERSION2` (niente più warning di deprecazione), `influxdb-client` (solo `monitor`), `pytest` per i test. Nessun'altra dipendenza.

---

## 4. Identificativi

| Cosa | Formato ID | Esempio |
|---|---|---|
| Area | `A`, `B`, `C`, `D`, `park`, `parking`, `complex` | `B` |
| Palazzo (unità) | lettera | `A` |
| Appartamento | `<palazzo>-<piano>-<interno>`, piano terra = 0, piani 0–3, interni 1–2 | `A-2-1` |
| Vano scale | `<palazzo>-S` | `B-S` |
| Parco | `park` | `park` |
| Colonnina | `EV-<palazzo>` (area `parking`) | `EV-A` |
| Complesso (derivati) | `complex` (area `complex`) | `complex` |
| Dispositivo | `<unità>.<tipo>` | `A-2-1.co2`, `park.pm10`, `EV-A.ev_charger` |

---

## 5. Il modello del complesso: `config/complex.json`

Unica fonte di verità per la struttura del complesso. Viene creato nella tappa 1. Il simulatore lo legge all'avvio; **se non è valido, il simulatore non parte** e indica l'errore. La struttura **non** si modifica a runtime: si cambia il file e si riavvia il simulatore.

### 5.1 Struttura

```json
{
  "complex": {
    "name": "Residenza Parco",
    "lat": null, "lon": null,
    "seed": 42,
    "sampling_period_s": 10,
    "actuator_state_period_s": 60,
    "physics_step_s": 1,
    "clock": { "speed": 1, "max_speed": 60 }
  },

  "device_types": { "…": "catalogo, sezione 6" },

  "profiles": {
    "famiglia":   { "residents": [3, 4], "weight": 0.40 },
    "lavoratori": { "residents": [1, 2], "weight": 0.30 },
    "anziano":    { "residents": [1, 2], "weight": 0.15 },
    "studenti":   { "residents": [2, 3], "weight": 0.15 }
  },

  "apartment_template": {
    "area_m2": 80, "height_m": 2.7, "insulation": "media",
    "sensors":   ["temperature", "humidity", "co2", "noise_level", "occupancy", "light",
                  "smoke", "gas", "co", "power", "water_flow", "gas_flow"],
    "actuators": ["hvac", "ventilation", "window", "blinds", "lights",
                  "gas_valve", "alarm", "resident_display"]
  },

  "stairwell_template": {
    "sensors":   ["temperature", "smoke", "light", "occupancy"],
    "actuators": ["stair_lights", "smoke_vent", "evacuation_siren"]
  },

  "buildings": [
    { "id": "A", "floors": 4, "apartments_per_floor": 2,
      "orientation": { "1": "S", "2": "N" },
      "pv_peak_w": 20000, "battery_kwh": 40, "battery_max_w": 10000,
      "sensors": ["pv_power"], "actuators": ["elevator", "battery"],
      "layout": { "x_m": 0, "y_m": 45, "rotation_deg": 0,
                  "width_m": 26, "depth_m": 12, "floor_height_m": 3.2 },
      "overrides": { "A-0-1": { "profile": "anziano", "residents": 1 } } }
  ],

  "park": {
    "area_m2": 3000,
    "layout": { "x_m": 0, "y_m": 0, "width_m": 60, "depth_m": 50 },
    "sensors":   ["temperature", "humidity", "rain_level", "wind_speed", "light",
                  "noise_level", "seismic", "pm10", "pm2_5", "soil_moisture"],
    "actuators": ["irrigation", "park_lights", "evacuation_signs"]
  },

  "parking": {
    "layout": { "x_m": 0, "y_m": -75, "width_m": 40, "depth_m": 15 },
    "chargers": [ { "id": "EV-A", "building": "A", "max_power_w": 7400 },
                  { "id": "EV-B", "building": "B", "max_power_w": 7400 },
                  { "id": "EV-C", "building": "C", "max_power_w": 7400 },
                  { "id": "EV-D", "building": "D", "max_power_w": 7400 } ]
  },

  "adjacency_overrides": [],
  "physics": { "…": "parametri, sezione 8" },
  "monitor": { "…": "parametri, sezione 10" }
}
```

### 5.2 Valori di default dei 4 palazzi

| Palazzo | Posizione | `layout` (x, y, rotazione) | Esposizione interno 1 / 2 |
|---|---|---|---|
| A | nord del parco | 0, 45, 0° | S / N |
| B | est | 50, 0, 90° | O / E |
| C | sud | 0, −45, 0° | N / S |
| D | ovest | −50, 0, 90° | E / O |

L'interno 1 guarda sempre verso il parco. Tutti i palazzi: 4 piani, 2 appartamenti per piano, fotovoltaico da 20 kW di picco, batteria da 40 kWh (10 kW massimi).

### 5.3 Regole di espansione (in `model.py`)
1. Per ogni palazzo si generano gli appartamenti `<id>-<piano>-<interno>` dal modello ripetibile e un vano scale `<id>-S`.
2. **Profilo e residenti**: assegnati con il `seed` secondo i pesi di `profiles`; il numero di residenti è estratto nell'intervallo del profilo. Le `overrides` vincono.
3. **Esposizione**: da `orientation` del palazzo; le `overrides` vincono.
4. **Adiacenze calcolate**: stesso piano (interno 1 ↔ 2), piano sopra e sotto (stesso interno), vano scale ↔ tutti gli appartamenti del palazzo. `adjacency_overrides` aggiunge o toglie coppie.
5. **Consistenza**: ogni tipo in `sensors`/`actuators` deve esistere in `device_types` con il `kind` giusto, gli ID devono essere unici e `overrides` deve riferirsi ad appartamenti esistenti. Altrimenti errore all'avvio.

Il modello espanso (tutte le unità, con dispositivi, profilo, residenti, esposizione, adiacenze e layout) viene pubblicato retained su **`Complex/model`**.

---

## 6. Catalogo dei dispositivi (`device_types`)

### 6.1 Sensori

Campi del catalogo: `unit`, `valid_range` (intervallo fisicamente possibile; il sensore **satura** ai bordi), `noise` (deviazione standard del rumore di misura), `rest_value` (valore di riposo, escluso dal controllo "bloccato"; `null` se non esiste), `stuck_check` (se applicare il controllo "bloccato"), `drift_check` (se applicare il controllo "deriva").

| Tipo | Unità | `valid_range` | `noise` | `rest_value` | `stuck_check` | `drift_check` | Dove |
|---|---|---|---|---|---|---|---|
| `temperature` | °C | −40 … 150 | 0.1 | null | sì | sì | app., scale, parco |
| `humidity` | % | 0 … 100 | 0.5 | null | sì | sì | app., parco |
| `co2` | ppm | 0 … 10000 | 10 | null | sì | sì | app. |
| `noise_level` | dB | 20 … 130 | 0.5 | null | sì | no | app., parco |
| `occupancy` | persone | 0 … 50 | 0 | 0 | **no** (valore intero) | no | app., scale |
| `light` | lux | 0 … 120000 | 5 | 0 | sì | no | app., scale, parco |
| `smoke` | % oscuramento | 0 … 100 | 0.05 | 0 | sì | no | app., scale |
| `gas` | % LEL | 0 … 100 | 0.2 | 0 | sì | no | app. |
| `co` | ppm | 0 … 1000 | 1 | 0 | sì | no | app. |
| `power` | W | 0 … 20000 | 5 | 0 | sì | no | app. |
| `water_flow` | L/min | 0 … 30 | 0.1 | 0 | sì | no | app. |
| `gas_flow` | m³/h | 0 … 5 | 0.01 | 0 | sì | no | app. |
| `pv_power` | W | 0 … 50000 | 20 | 0 | sì | no | palazzo |
| `rain_level` | mm/h | 0 … 300 | 0.1 | 0 | sì | no | parco |
| `wind_speed` | km/h | 0 … 200 | 0.5 | 0 | sì | no | parco |
| `seismic` | Mw | 0 … 10 | 0.02 | null | sì | no | parco |
| `pm10` | µg/m³ | 0 … 1000 | 1 | null | sì | no | parco |
| `pm2_5` | µg/m³ | 0 … 1000 | 0.5 | null | sì | no | parco |
| `soil_moisture` | % | 0 … 100 | 0.2 | null | sì | no | parco |

**Rumore di misura:** si aggiunge solo quando il valore vero supera `rest_value`. A riposo il sensore riporta esattamente `rest_value`, come un sensore reale che legge "zero".

**Conteggio:** 12 × 32 appartamenti + 4 × 4 vani scala + 1 × 4 palazzi + 10 nel parco = **414 sensori**.

### 6.2 Attuatori

Campi del catalogo: `commands` (chiavi ammesse, con tipi e limiti), `default` (stato iniziale), `power_w` (consumo elettrico in funzione dello stato), `essential` (resta alimentato dalla batteria durante il blackout).

| Tipo | Comando (chiavi e valori ammessi) | Default | Consumo | Essenziale | Dove |
|---|---|---|---|---|---|
| `hvac` | `mode`: `off`/`heat`/`cool`; `setpoint`: 16–30 °C | `off`, 21 | `cool` 1500 W; `heat` 100 W elettrici + gas dalla caldaia | no | app. |
| `ventilation` | `level`: 0–3 | 1 | 30 W × livello | no | app. |
| `window` | `position`: `open`/`closed` | `closed` | 0 | no | app. |
| `blinds` | `position`: 0–100 (% aperte) | 100 | 0 | no | app. |
| `lights` | `level`: 0–100 | 0 | 100 W × livello/100 | no | app. |
| `gas_valve` | `position`: `open`/`closed` | `open` | 0 | sì | app. |
| `alarm` | `siren`: `on`/`off` | `off` | 10 W | sì | app. |
| `resident_display` | `message`: testo; `level`: `info`/`warning`/`danger`; oppure `clear`: true | vuoto | 5 W | sì | app. |
| `stair_lights` | `mode`: `off`/`normal`/`evacuation` | `off` | 50 W `normal`, 80 W `evacuation` | sì | scale |
| `smoke_vent` | `position`: `open`/`closed` | `closed` | 0 | sì | scale |
| `evacuation_siren` | `siren`: `on`/`off` | `off` | 20 W | sì | scale |
| `elevator` | `mode`: `normal`/`recall` | `normal` | 500 W medi (`normal`), 100 W (`recall`) | sì | palazzo |
| `battery` | `mode`: `charge`/`discharge`/`idle` | `idle` | ± fino a `battery_max_w` | — | palazzo |
| `irrigation` | `state`: `on`/`off` | `off` | 500 W | no | parco |
| `park_lights` | `state`: `on`/`off` | `off` | 2000 W | no | parco |
| `evacuation_signs` | `state`: `on`/`off` | `off` | 200 W | sì | parco |
| `ev_charger` | `mode`: `charge`/`pause`; `max_power_w`: 0–11000 | `charge`, 7400 | potenza di ricarica effettiva | no | parcheggio |

**Stato pubblicato in più rispetto al comando:**
- `battery`: `soc_pct` (stato di carica) e `power_w` (positivo in carica, negativo in scarica);
- `ev_charger`: `car_connected` (sì/no), `power_w`, `energy_needed_kwh`;
- tutti gli attuatori: `power_w` calcolato.

**Conteggio:** 8 × 32 appartamenti + 3 × 4 vani scala + 2 × 4 palazzi + 3 nel parco + 4 colonnine = **283 attuatori**.

---

## 7. Contratto MQTT

### 7.1 Struttura
`Complex/<livello>/<area>/<unità>/<dispositivo>`. Esempio: `Complex/monitored/A/A-2-1/co2`. Per iscriversi a un palazzo intero: `Complex/monitored/A/#`.

### 7.2 Topic

| Topic | Pubblica | Retained | QoS | Frequenza |
|---|---|---|---|---|
| `Complex/model` | simulator | sì | 1 | all'avvio |
| `Complex/clock` | simulator | sì | 1 | ogni secondo reale |
| `Complex/raw/<area>/<unità>/<sensore>` | simulator | no | 0 | ogni `sampling_period_s` |
| `Complex/state/<area>/<unità>/<attuatore>` | simulator | sì | 1 | a ogni cambio e ogni `actuator_state_period_s` |
| `Complex/cmd/<area>/<unità>/<attuatore>` | Executor | no | 1 | a evento |
| `Complex/ack/<area>/<unità>/<attuatore>` | simulator | no | 1 | in risposta a un comando |
| `Complex/monitored/<area>/<unità>/<dispositivo>` | monitor | no | 0 | per ogni dato validato o derivato |
| `Complex/health/<area>/<unità>/<dispositivo>` | monitor | sì | 1 | a ogni cambio di salute |
| `Complex/control/clock` | UI | no | 1 | a evento |
| `Complex/control/scenario` | UI | no | 1 | a evento |
| `Complex/scenarios` | simulator | sì | 1 | a ogni cambio |
| `Complex/status/simulator` | simulator (Last Will) | sì | 1 | `online` all'avvio, `offline` alla caduta |
| `Complex/status/monitor` | monitor (Last Will) | sì | 1 | come sopra, più i problemi con InfluxDB |

Nei topic `monitored` e `health`, i valori derivati usano l'unità del palazzo (`Complex/monitored/A/A/power_total`) o del complesso (`Complex/monitored/complex/complex/power_total`).

### 7.3 Messaggi

`timestamp` = secondi epoch reali (UTC). `sim_time` = ora simulata locale dell'Aquila in ISO 8601 senza fuso.

```json
// Complex/clock
{"sim_time": "2026-09-30T21:15:00", "speed": 60, "timestamp": 1790440000.0}

// Complex/raw/A/A-2-1/co2
{"device_id": "A-2-1.co2", "value": 812.4, "unit": "ppm",
 "timestamp": 1790440000.1, "sim_time": "2026-09-30T21:15:00"}

// Complex/state/A/A-2-1/hvac
{"device_id": "A-2-1.hvac", "state": {"mode": "cool", "setpoint": 24},
 "power_w": 1500, "timestamp": 1790440000.1, "sim_time": "2026-09-30T21:15:00"}

// Complex/cmd/A/A-2-1/hvac
{"cmd_id": "3f2a9c1e-…", "command": {"mode": "cool", "setpoint": 24},
 "issued_by": "planner", "timestamp": 1790440001.0}

// Complex/ack/A/A-2-1/hvac: accettato
{"cmd_id": "3f2a9c1e-…", "status": "ok", "state": {"mode": "cool", "setpoint": 24},
 "timestamp": 1790440001.2}

// Complex/ack/A/A-2-1/hvac: rifiutato (comando non valido, NON è un guasto)
{"cmd_id": "3f2a9c1e-…", "status": "rejected", "reason": "setpoint 40 fuori da 16–30",
 "timestamp": 1790440001.2}

// Complex/monitored/A/A-2-1/co2
{"device_id": "A-2-1.co2", "kind": "sensor", "value": 812.4, "unit": "ppm",
 "quality": "ok", "timestamp": 1790440000.1, "sim_time": "2026-09-30T21:15:00"}

// Complex/monitored/A/A-2-1/hvac
{"device_id": "A-2-1.hvac", "kind": "actuator", "state": {"mode": "cool", "setpoint": 24},
 "power_w": 1500, "quality": "ok", "timestamp": 1790440000.1}

// Complex/monitored/A/A/energy_balance
{"device_id": "A.energy_balance", "kind": "derived", "value": 4200.0, "unit": "W",
 "quality": "partial", "missing": 2, "timestamp": 1790440000.5}

// Complex/health/A/A-2-1/co2
{"device_id": "A-2-1.co2", "status": "stuck", "since": 1790439800.0,
 "details": "valore invariato da 6 letture"}

// Complex/control/clock
{"speed": 60}
{"jump_to": "22:00"}                  // prossima occorrenza di quell'ora
{"jump_to": "2027-01-15T08:00:00"}    // data e ora precise (es. per mostrare l'inverno)

// Complex/control/scenario
{"action": "start", "scenario": "fire", "target": "A-2-1", "params": {}}
{"action": "stop",  "scenario_id": "sc-0007"}

// Complex/scenarios
{"active": [{"scenario_id": "sc-0007", "scenario": "fire", "target": "A-2-1",
             "params": {}, "started_at": 1790440000.0, "sim_started_at": "2026-09-30T21:15:00"}]}
```

### 7.4 Regole
- **`quality`:** `ok` = dato valido; `suspect` = sensore sospettato bloccato o in deriva, dato comunque inoltrato; `partial` = valore derivato calcolato con dati mancanti (`missing` = quanti).
- **Un attuatore guasto non si dichiara.** `no_ack`: nessuna risposta; `no_effect`: risponde `ok` e aggiorna lo stato dichiarato, ma la fisica non cambia.
- **`Complex/scenarios`** è la verità di riferimento: la leggono solo UI, Grafana (via Node-RED/InfluxDB) e vista 3D. Serve per i KPI di rilevamento.
- I topic `City/…` vengono eliminati nella tappa 4.

---

## 8. Modello fisico (`environment.py`, `physics.py`, `occupancy.py`)

### 8.1 Principi
- Ogni grandezza evolve come un sistema del **primo ordine** verso un equilibrio. L'aggiornamento usa la forma esatta `x ← x_eq + (x − x_eq)·e^(−Δt/τ)`, **stabile per qualunque Δt**, quindi anche a ×60.
- Passo di calcolo: `physics_step_s` = 1 s reale, cioè Δt simulato = 1 s × velocità.
- Tutti i parametri stanno in `complex.json → physics` con i default indicati qui sotto. Sono valori **indicativi**: l'obiettivo è la plausibilità delle tendenze e delle reazioni agli attuatori, non la precisione.
- Generatori casuali inizializzati con `seed`: simulazioni ripetibili.

### 8.2 Esterno (`environment.py`)

| Grandezza | Modello | Parametri di default |
|---|---|---|
| Sole | Durata del giorno variabile col mese (coseno tra 9.2 h a dicembre e 15.2 h a giugno), mezzogiorno solare 12:30; fattore sole = seno dell'altezza normalizzata, 0 di notte | — |
| `light` esterna | `100000 lux × sole × (1 − 0.8 × nuvolosità)` | — |
| `temperature` | Media mensile + ciclo giornaliero sinusoidale (minimo 6:00, massimo 15:00, ampiezza ±5 °C) + variazione degli scenari | Medie mensili dell'Aquila (°C): 2.5, 3.5, 7, 10, 14.5, 19, 22, 22, 17.5, 12.5, 7, 3.5 |
| `humidity` | 85% a temperatura minima, 50% a massima, interpolata; +20% con pioggia (massimo 100) | — |
| Meteo | Catena di Markov oraria: asciutto ↔ pioggia; se piove, nuvolosità 0.9 | P(pioggia) 8% per ora; pioggia 1–10 mm/h; vento di base 0–20 km/h |
| `noise_level` | Profilo del traffico: 45 dB di notte, 65 dB ai picchi delle 8 e delle 18 | — |
| `pm10` / `pm2_5` | Base + traffico × fattore; la pioggia dimezza | base 15 / 8 µg/m³; traffico fino a +20 / +10 |
| `seismic` | Solo micro-tremore di fondo, 0–0.5; i terremoti **solo** dallo scenario | — |
| `soil_moisture` | Cala con sole e caldo, sale con pioggia e irrigazione | −0.5%/h × sole × (T/20); +3%/h per mm/h di pioggia; +15%/h con irrigazione |

### 8.3 Appartamento (`physics.py`)

Stato per appartamento: temperatura, umidità, CO₂, fumo, gas, CO, intensità dell'incendio. Volume = `area_m2 × height_m` (default 216 m³).

**Temperatura:** equilibrio verso la temperatura esterna con costante di tempo `τ_env`, più apporti espressi in °C/h:

| Contributo | Default |
|---|---|
| `τ_env` per isolamento | bassa 3 h, media 6 h, alta 12 h |
| Finestra aperta | scambio aggiuntivo con `τ` = 20 min |
| Persone | +0.15 °C/h per persona presente |
| Sole | fino a +1.5 °C/h (esposizione S), 1.0 (E/O), 0.3 (N), × sole × apertura tapparelle |
| HVAC `heat`/`cool` | verso il set-point a massimo 2 °C/h, banda morta ±0.5 °C. **In `heat` accende la caldaia** (consumo di gas) |
| Incendio | fino a +300 °C/h × intensità (il sensore satura a 150 °C) |

**CO₂** (bilancio di massa):
`dC/dt = persone × 92.6 ppm/h × (216 / volume) − ACH × (C − C_esterna)`, con `C_esterna` = 420 ppm.
Ricambi d'aria orari (`ACH`): infiltrazioni 0.3; VMC +0.5 per ogni livello; finestra aperta +4.
Esempio di verifica: 3 persone e solo infiltrazioni portano all'equilibrio a circa 1350 ppm, quindi oltre la soglia di 1000 ppm, e la ventilazione diventa necessaria.

**Umidità:** stesso schema della CO₂. Sorgenti: +2 punti %/h per persona; una doccia aggiunge 15 punti % distribuiti sulla sua durata; la cucina 5 punti % distribuiti sul pasto. Equilibrio verso l'umidità esterna in base all'`ACH`. Il raffrescamento toglie 3%/h.

**Luce interna:** `luce_esterna × 0.02 × apertura_tapparelle + livello_luci × 5 lux`.

**Rumore interno:** somma energetica di: fondo 30 dB; 50 dB per ogni persona sveglia; rumore esterno −30 dB (finestra chiusa) o −10 dB (aperta); sirena 85 dB.

**Incendio** (scenario `fire`):
- l'intensità I (0–1) cresce in modo logistico con tasso 0.2/min; **×1.5 se VMC > 0 o finestra aperta** (più ossigeno);
- fumo = 100 × I (% oscuramento) meno la rimozione dovuta all'`ACH`;
- CO: +500 ppm/h × I; CO₂: +5000 ppm/h × I;
- **propagazione**: se I > 0.7, ogni appartamento adiacente ha il 10% di probabilità al minuto simulato di prendere fuoco; il vano scale riceve fumo pari al 30% di quello dell'appartamento;
- allo stop dello scenario, I decade con `τ` = 10 min (spegnimento).

**Fuga di gas** (scenario `gas_leak`): +2% LEL/min finché `gas_valve` è `open`; rimozione dovuta all'`ACH`.

**Monossido** (scenario `co_poisoning`): +30 ppm/h mentre la caldaia è accesa (riscaldamento o acqua calda) e `gas_valve` è `open`; rimozione dovuta all'`ACH`.

**Energia e consumi:**

| Sensore | Modello |
|---|---|
| `power` | carico base 150 W + elettrodomestici secondo gli orari (cucina 2 kW ai pasti) + consumo di tutti gli attuatori dell'appartamento. Blackout: solo gli attuatori `essential`, se la batteria ha carica |
| `water_flow` | docce da 10 L/min per 8 minuti simulati, una per residente al giorno (mattina o sera); cucina 5 L/min in brevi picchi |
| `gas_flow` | cucina 0.3 m³/h ai pasti; riscaldamento 1.2 m³/h quando HVAC `heat` è attivo; acqua calda 0.8 m³/h durante le docce. Con `gas_valve` `closed` vale 0 |

### 8.4 Vano scale, palazzo, parco, parcheggio
- **Vano scale**: temperatura = media degli appartamenti del palazzo; fumo in ingresso dagli appartamenti in fiamme (30%), rimosso dallo `smoke_vent` aperto con `τ` = 3 min; `occupancy` = persone in transito; luce = esterna × 0.05 + luci delle scale.
- **Palazzo**: `pv_power` = `pv_peak_w × sole × (1 − 0.7 × nuvolosità)`; blackout: nessuna potenza dalla rete. La batteria varia `soc_pct` secondo `mode` e `battery_max_w`, con un limite 0–100%. **Durante il blackout alimenta automaticamente i carichi essenziali**, indipendentemente dal comando, finché ha carica.
- **Parcheggio**: ogni auto arriva tra le 18 e le 20 e riparte tra le 7 e le 9 (ora simulata), con un fabbisogno di 10–30 kWh; la colonnina assorbe `min(max_power_w, fabbisogno residuo)` solo in `charge` e con l'auto collegata.
- **Consumi comuni** (parco, scale, ascensore, colonnine): vengono attribuiti al palazzo di riferimento (colonnina `EV-X` → palazzo X) oppure al complesso (parco).

### 8.5 Persone (`occupancy.py`)
- **Profili** (ora simulata, feriali; nel weekend +50% di presenza di giorno; variazione casuale ±30 min per famiglia):

| Profilo | Fuori casa | Svegli |
|---|---|---|
| famiglia | adulti 8–18, figli 8–14 | 6:30–23:00 |
| lavoratori | 8–19 | 6:30–24:00 |
| anziano | 10–11 (passeggiata) | 7:00–22:00 |
| studenti | 9–13 e 15–18 | 8:00–01:00 |

- Ogni entrata e uscita passa dal vano scale, dove fa salire le persone in transito per 1 minuto simulato.
- **Evacuazione**: se in un appartamento suona `alarm`, oppure nel palazzo suona `evacuation_siren`, i residenti escono entro 2–5 minuti simulati, passano dalle scale e raggiungono il parco. Rientrano solo quando **entrambe** le sirene sono spente.

### 8.6 Sensori e attuatori (`devices.py`)
- **Lettura del sensore**: valore vero → rumore di misura (se sopra `rest_value`) → saturazione a `valid_range` → eventuale guasto.
- **Guasti dei sensori** (scenario `sensor_fault`, parametro `mode`):
  - `stuck`: ripete l'ultimo valore;
  - `drift`: somma un errore che cresce di `drift_rate` per ogni minuto reale (default: 0.05 × l'ampiezza tipica del tipo, per esempio 0.3 °C/min per la temperatura);
  - `offline`: non pubblica più.
- **Comando all'attuatore**:
  - si valida rispetto al catalogo; se non è valido → ack `rejected`;
  - se è valido → si aggiorna lo stato, ack `ok`, si pubblica il nuovo stato; la fisica usa lo stato "effettivo".
- **Guasti degli attuatori** (scenario `actuator_fault`, parametro `mode`):
  - `no_ack`: il comando viene ignorato e non si risponde;
  - `no_effect`: ack `ok` e stato dichiarato aggiornato, ma lo stato effettivo resta quello precedente.

---

## 9. Scenari (`scenarios.py`)

Si avviano e si fermano da `Complex/control/scenario`. Ogni avvio riceve un `scenario_id` (`sc-0001`, …) ed è elencato in `Complex/scenarios`. Più scenari possono essere attivi insieme. **Al riavvio del simulatore non vengono ripristinati.**

| Scenario | `target` | `params` (default) | Effetto nel modello | Reazione attesa (per il futuro Planner) |
|---|---|---|---|---|
| `fire` | appartamento | — | Incendio (8.3) con propagazione | Sirena, gas chiuso, VMC spenta, `smoke_vent` aperto, ascensore `recall`, segnaletica, avvisi |
| `gas_leak` | appartamento | `rate` 2 %LEL/min | Fuga di gas (8.3) | Gas chiuso, finestre aperte, allarme, avviso |
| `co_poisoning` | appartamento | `rate` 30 ppm/h | Caldaia difettosa (8.3) | Gas chiuso, VMC al massimo, finestre aperte, allarme |
| `earthquake` | `complex` | `magnitude` 5.8, `duration_s` 30 (simulati) | `seismic` = magnitudo ± rumore per la durata, poi rientro | Gas chiuso ovunque, ascensori `recall`, sirene, evacuazione verso il parco |
| `heatwave` | `complex` | `delta` +10 °C, `days` 3 | Temperatura esterna +delta per `days` giorni simulati | Tapparelle giù, clima nelle ore di sole, batteria per la sera |
| `cold_wave` | `complex` | `delta` −10 °C, `days` 3 | Temperatura esterna −delta; irrigazione inefficace sotto 0 °C | Riscaldamento, controllo del gas, irrigazione bloccata |
| `pollution` | `complex` | `factor` 4 | PM10 e PM2.5 × factor | Finestre chiuse, VMC senza aria esterna, avviso |
| `power_peak` | `complex` | — | Tutti in casa, elettrodomestici al massimo | Batteria in scarica, colonnine in pausa |
| `storm` | `complex` | — | Pioggia 30–60 mm/h, vento 60–90 km/h | Finestre chiuse, irrigazione sospesa, tapparelle protette |
| `solar_surplus` | `complex` | — | Cielo sereno forzato, residenti fuori casa | Ricarica di batteria e auto |
| `blackout` | `complex` o palazzo | — | Niente corrente dalla rete; solo i carichi `essential` alimentati dalla batteria | Priorità ai servizi essenziali |
| `sensor_fault` | dispositivo (es. `A-2-1.co2`) | `mode`: `stuck`/`drift`/`offline`; `drift_rate` | Guasto del sensore (8.6) | Il Monitor lo rileva; il Planner non agisce su quel dato |
| `actuator_fault` | dispositivo (es. `A-2-1.hvac`) | `mode`: `no_ack`/`no_effect` | Guasto dell'attuatore (8.6) | L'Executor ritenta; il Planner trova un'alternativa |
| `cascade` | `complex` | `magnitude` 5.8, `gas_after_min` 5, `fire_after_min` 10, `targets` (se omesso: 2 appartamenti scelti con il seed in palazzi diversi) | Terremoto → dopo 5 min simulati fuga di gas nei target → dopo 10 min incendio nel primo target | Il manager del complesso risolve i conflitti secondo le priorità |

Lo stop di uno scenario fa **rientrare gradualmente** le grandezze secondo la fisica. Non ci sono salti: per esempio, dopo un'ondata di calore la temperatura esterna torna alla media con `τ` = 6 h simulate.

---

## 10. Monitor

### 10.1 Principio di sicurezza
Un'emergenza reale non deve mai essere scartata perché scambiata per un guasto. Nel dubbio il dato si **inoltra come `suspect`**, non si scarta. I sensori `smoke`, `gas` e `co` non sono mai soggetti a controlli sulla velocità di variazione.

### 10.2 Catena di controlli (per ogni misura `raw`)

| # | Controllo | Regola | Esito |
|---|---|---|---|
| 1 | Formato | `device_id` presente nel modello, unità coerente con il catalogo, JSON valido | Scarto + log |
| 2 | Valore impossibile | Fuori da `valid_range` (può capitare solo con la deriva, perché i sensori saturano) | **Scarto**, salute `out_of_range` |
| 3 | Bloccato | Solo se `stuck_check`: valore identico per `stuck_readings` letture consecutive **e** diverso da `rest_value` | Inoltro `suspect`, salute `stuck` |
| 4 | Deriva | Solo **sensori degli appartamenti** con `drift_check` (vani scala e parco non hanno vicini con cui confrontarsi): residuo = valore − mediana dello stesso tipo negli altri appartamenti del palazzo con qualità `ok` (servono almeno 3 vicini); regressione lineare del residuo sulla finestra `drift_window_min`, applicata solo se la finestra contiene almeno l'80% delle letture attese; deriva se la pendenza supera `drift_slope[tipo]` **e** la variazione del residuo nella finestra supera `drift_delta[tipo]` | Inoltro `suspect`, salute `drift` |
| 4b | Sospensione della deriva | Se nello stesso appartamento `smoke`, `gas` o `co` sono sopra il `rest_value` oltre il rumore, il controllo 4 non si applica | — |
| 5 | Spento | Nessuna misura per `offline_periods × sampling_period_s` secondi | Salute `offline` |

- **Isteresi:** si torna `ok` dopo `recovery_readings` letture valide consecutive.
- **Caduta del simulatore:** con `Complex/status/simulator` = `offline` il monitor pubblica un solo evento (`Complex/status/monitor` con `"simulator": "offline"`) e sospende il controllo 5 finché il simulatore non torna `online`.
- **Limite noto:** un sensore bloccato esattamente sul `rest_value` (per esempio il fumo a 0) non è rilevabile con il controllo 3.

### 10.3 Attuatori
Il monitor inoltra ogni stato su `Complex/monitored/…` con `kind: "actuator"`. Se per `2 × actuator_state_period_s` non arriva uno stato, la salute diventa `offline`. **Non** giudica il funzionamento dell'attuatore: "nessun ack" è compito dell'Executor, "nessun effetto" dell'Analyzer.

### 10.4 Valori derivati (`derived.py`)
Calcolati a ogni `sampling_period_s` con gli ultimi valori validi. Vengono pubblicati come `kind: "derived"` sull'unità del palazzo (`A`…`D`) e del complesso (`complex`).

| Valore | Unità | Calcolo |
|---|---|---|
| `power_total` | W | Palazzo: somma `power` degli appartamenti + consumi di scale, ascensore, colonnina del palazzo + carica della batteria (se positiva). Complesso: somma dei palazzi + parco |
| `energy_balance` | W | `pv_power` − `power_total` + scarica della batteria (positivo = surplus). Complesso: somma dei palazzi − parco |
| `occupancy_total` | persone | Palazzo: somma `occupancy` degli appartamenti + scale. Complesso: somma dei palazzi |

Se qualche ingresso è `offline` o scartato, il valore esce con `quality: "partial"` e `missing: <n>`.

### 10.5 Parametri (`complex.json → monitor`)

```json
"monitor": {
  "stuck_readings": 6,
  "offline_periods": 3,
  "recovery_readings": 3,
  "drift_window_min": 20,
  "drift_slope": { "temperature": 0.1, "humidity": 0.5, "co2": 20 },
  "drift_delta": { "temperature": 2.0, "humidity": 8.0, "co2": 300 },
  "influx_batch_size": 500,
  "influx_flush_s": 1,
  "influx_buffer_max": 50000
}
```
`drift_slope` è espresso in unità al minuto, `drift_delta` in unità.

---

## 11. Knowledge: InfluxDB

Bucket `iot_bucket` (esistente, retention 1 settimana). Measurement nuove; `sensors` (v1) si esaurisce da sola con la retention.

| Measurement | Scrive | Tag | Campi | Tempo |
|---|---|---|---|---|
| `readings` | monitor | `device_id`, `area`, `unit_id`, `type`, `kind` (`sensor`/`derived`), `unit`, `quality` | `value` (float), `sim_time` (string) | `timestamp` del dato |
| `actuator_states` | monitor | `device_id`, `area`, `unit_id`, `type` | una colonna per chiave di stato (`mode`, `setpoint`, `level`, `position`, `soc_pct`, …), `power_w` | `timestamp` dello stato |
| `device_health` | monitor | `device_id`, `area`, `unit_id`, `type`, `status` | `details` (string) | momento del cambio |
| `scenario_events` | **Node-RED** (da `Complex/scenarios`) | `scenario`, `target`, `scenario_id` | `action` (`start`/`stop`), `params` (JSON string) | momento dell'evento |

Volume stimato: ~45 punti/s, circa 4 milioni al giorno. Scrittura a blocchi (500 punti o 1 s).

Esempio: CO₂ validata dell'appartamento A-2-1 nell'ultima ora.
```flux
from(bucket: "iot_bucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "readings" and r._field == "value")
  |> filter(fn: (r) => r.device_id == "A-2-1.co2" and r.quality == "ok")
```

---

## 12. Gestione degli errori

| Situazione | Comportamento |
|---|---|
| Broker irraggiungibile | Riconnessione automatica (attesa crescente fino a 30 s), nuova iscrizione in `on_connect`. Il simulatore **continua a simulare**; al ritorno ripubblica model, clock, stati e scenari retained |
| InfluxDB irraggiungibile | Il monitor accoda fino a `influx_buffer_max` punti e riprova; oltre, scarta i più vecchi e lo segnala su `Complex/status/monitor` |
| Comando non valido | Ack `rejected` con `reason` |
| Comando per un dispositivo inesistente | Ack `rejected` con `reason: "dispositivo sconosciuto"` |
| Messaggio malformato su `control` | Ignorato e registrato nel log |
| `complex.json` non valido | Il simulatore esce con codice ≠ 0 e un messaggio che indica il campo errato |
| Riavvio del simulatore | Riparte all'ora reale a ×1 con lo stato fisico iniziale, **nessuno scenario attivo** (svuota `Complex/scenarios`) |
| Riavvio del monitor | Riceve `Complex/model` retained e riparte; lo stato di salute riparte da `ok` |

---

## 13. Test

### 13.1 Test automatici (pytest, scritti prima del codice)
- **`simulator`**:
  - espansione del modello (32 appartamenti, ID, adiacenze, override, errori di configurazione);
  - fisica: finestra aperta → la CO₂ scende; HVAC → la temperatura raggiunge il set-point; VMC accesa → l'incendio cresce più in fretta; valvola chiusa → la fuga di gas si ferma; calcoli stabili con Δt = 60 s;
  - comandi: validi → ack `ok`, non validi → `rejected`;
  - guasti: `no_ack`, `no_effect`, `stuck`, `drift`, `offline`.
- **`monitor`**:
  - controlli con sequenze sintetiche: impossibile, bloccato, `rest_value`, deriva, deriva sospesa con fumo, spento, isteresi, caduta del simulatore;
  - derivati: somme, bilancio, `partial`.

### 13.2 Test end-to-end
Uno script avvia lo stack, avvia gli scenari via MQTT e verifica i topic:
- `sensor_fault` `stuck` su `A-2-1.co2` → `stuck` su `health` entro ~70 s;
- `fire` su `A-2-1` → fumo su `monitored` e propagazione;
- `actuator_fault` `no_ack` → nessun ack.

Lo script misura il **tempo di rilevamento** (KPI della proposta) confrontando `Complex/scenarios` con `Complex/health`.

### 13.3 Riproducibilità
Con lo stesso `seed` e la stessa sequenza di comandi, la simulazione produce gli stessi valori.

---

## 14. Migrazione in 5 tappe

Durante le tappe 1–3 la v1 (`City/…`) continua a funzionare in parallelo.

| Tappa | Contenuto | Requisiti | Risultato verificabile |
|---|---|---|---|
| 1 | `simulator` base: `complex.json`, model, clock, environment, physics, occupancy, sensori `raw`, `Complex/model`, `Complex/clock`, controllo dell'orologio | R1–R5 | 414 sensori pubblicano su `Complex/raw/#` con valori plausibili |
| 2 | Attuatori, `cmd`/`ack`/`state`, scenari, guasti, `Complex/scenarios` | R6, R7 | Un comando manuale via MQTT cambia la fisica: **ciclo chiuso** |
| 3 | Servizio `monitor`: validazione, salute, derivati, InfluxDB | R8 | Il guasto iniettato compare su `health`; dati in `readings` |
| 4 | Adeguamento (vedi sotto); rimozione di `sensors/` e dei topic `City/…` | R9 | Lo stack completo funziona solo su `Complex/…` |
| 5 | Aggiornamento di `docs/MONITOR.md` e del README | — | Documentazione allineata |

**Adeguamento minimo della tappa 4:**
- **Analyzer:** legge `Complex/monitored/#` (solo `kind: "sensor"`, ignora `suspect` nei controlli di soglia); ragiona per appartamento invece che per location; soglie di partenza per i nuovi tipi: temperatura 28 °C, umidità 70%, CO₂ 1000 ppm, rumore 70 dB, fumo 5%, gas 10% LEL, CO 35 ppm, PM10 50, PM2.5 25, vento 50 km/h, pioggia 20 mm/h, sismico 4 Mw; alert su `Complex/alerts/<area>/<unità>/<tipo>`; configurazione su `Complex/config/…` (ex `City/update/thresholds`, `policies`, `rules/…`).
- **Planner/Executor:** mapping verso i nuovi attuatori; comandi su `Complex/cmd/…` e ack su `Complex/ack/…`; interpretazione di `rejected`.
- **Node-RED:** rimozione del salvataggio di `City/data/#` (ora lo fa il monitor); alert Telegram da `Complex/alerts/#`; nuovo flow `Complex/scenarios` → `scenario_events`; pagina `/policy-admin` sui nuovi topic `Complex/config/…`.
- **UI:** rimozione della gestione delle location e degli scenari "Smart City"; comandi per l'orologio (velocità, salto), avvio e arresto dei 14 scenari con scelta del target, iniezione di guasti, elenco degli scenari attivi.
- **Grafana:** nuova dashboard sulle measurement `readings`, `actuator_states`, `device_health`, `scenario_events` (panoramica dei 4 palazzi, dettaglio per appartamento, energia, salute dei dispositivi, scenari come annotazioni).
- **docker-compose:** servizi `simulator` e `monitor` al posto di `sensors`; `config/` montata in sola lettura.

---

## 15. Requisiti e loro copertura

| # | Requisito | Sezioni |
|---|---|---|
| R1 | Modello del complesso | 4, 5 |
| R2 | Nuova gerarchia dei topic | 7 |
| R3 | Sensori interni | 6.1, 8.3, 8.4 |
| R4 | Sensori esterni nel parco | 6.1, 8.2 |
| R5 | Modello fisico e ora simulata | 8 |
| R6 | Stato degli attuatori | 6.2, 7 |
| R7 | Comandi, ack, guasti degli attuatori | 7, 8.6 |
| R8 | Salute dei sensori | 10 |
| R9 | Adeguamento dei consumatori | 14 |
