# Specifica — Vista 3D del complesso residenziale (fase 1: mondo fisico)

| | |
|---|---|
| **Stato** | Design approvato sezione per sezione il 2026-09-30, in attesa di revisione della specifica scritta |
| **Progetto** | SE4AS — Smart Building Environmental Manager (MAPE-K), sezione 10 della proposta ("Simulation Model") |
| **Documento di stato** | [`docs/VISTA_3D.md`](../../VISTA_3D.md) (decisioni V0–V18, avanzamento) |
| **Dipende da** | [Specifica Monitor v2](2026-09-30-monitor-v2-design.md): modello del complesso (§5), catalogo dei dispositivi (§6), contratto MQTT `Complex/…` (§7), scenari (§9). Simulatore già implementato (tappe 1–2) |

---

## 1. Obiettivo e perimetro

### 1.1 Obiettivo
Una **vista 3D navigabile nel browser** del complesso residenziale dell'Aquila (4 palazzi intorno al parco, parcheggio con colonnine) che mostra **in tempo reale** come gli edifici reagiscono alle condizioni ambientali. Serve soprattutto per la **demo all'esame**. È **solo una vista**: non contiene logica di simulazione, legge tutto dal broker MQTT.

### 1.2 Dentro il perimetro (fase 1)
- Nuovo servizio **`view`** (cartella `view/`): applicazione React Three Fiber servita da nginx.
- **Due modalità**, 3D e 2D (planimetria), con filtro per palazzo e per piano e spaccato dei piani.
- **Scena generata dal modello** (`Complex/model`): palazzi con pianta tipo e stanze, sensori e attuatori "installati", parco, parcheggio.
- **Dati vivi**: mappa di calore, sovraimpressioni per livello di zoom, scheda di dettaglio, attuatori animati, persone, auto, giorno/notte, meteo, emergenze.
- **Pannello di debug** con due schede: comandi agli attuatori e orologio.
- **Broker**: listener WebSocket, utente MQTT `view`, ACL.
- Ritocco dei campi `layout` dei palazzi in `config/complex.json` (sezione 14).

### 1.3 Fuori dal perimetro
- **Fase 2** (sezione 15): strato leggero del manager (catena MAPE-K), persone evacuate nel parco, prima persona dentro l'appartamento.
- Avvio di **scenari e guasti** dalla vista: restano a `mosquitto_pub` e, in futuro, alla UI Streamlit v2 (V10).
- Qualunque modifica alla fisica del simulatore. **`area_m2` resta 80** (V6).
- Modelli 3D esterni per palazzi, parco, parcheggio e dispositivi: questa geometria è generata dal codice. **Eccezione (V20):** arredi e residenti usano modelli esterni CC0 (§7.2, §7.5; crediti in `view/public/models/CREDITS.md`).

---

## 2. Decisioni di riferimento

Il dettaglio e le motivazioni sono in `docs/VISTA_3D.md`; qui un riepilogo.

| # | Decisione |
|---|---|
| V0 | Vista separata dal simulatore, legge da MQTT, geometria generata dal codice |
| V1 | Fase 1 = mondo fisico; fase 2 = strato leggero del manager |
| V2–V3 | Modalità 2D (planimetria per piano e palazzo) e 3D navigabile con sensori visibili, valori in sovraimpressione e minimappa |
| V4 | Camera da gestionale con spaccato dei piani; prima persona rinviata |
| V5 | Pianta tipo con stanze; interno 2 = interno 1 ruotato di 180°; dispositivi dove starebbero davvero |
| V6 | Palazzo 26 × 12 m, piani da 3,2 m, doppio affaccio, ascensore, androne passante verso il parco, fotovoltaico sul tetto; `area_m2` resta 80 |
| V7 | Cosa si vede: giorno/notte, attuatori, emergenze, meteo, parco, parcheggio, energia, persone |
| V8 | Nella fase 1 gli attuatori cambiano solo con comandi manuali (pannello di debug) |
| V9 | Persone evacuate nel parco rinviate alla fase 2 |
| V10 | Pannello di debug: solo comandi agli attuatori e orologio |
| V11 | Sovraimpressioni per livello di zoom |
| V12 | Disposizione della schermata; mappa di calore a scelta; emergenze sempre in rosso |
| V13 | Stile realistico stilizzato che di notte sfuma in digital twin; modalità dati e mappa di calore disattivabili; minimappa come secondo rendering |
| V14 | React Three Fiber + drei + zustand + mqtt.js + Vite + TypeScript; container `view`; collegamento diretto al broker via WebSocket |
| V15 | Broker: listener WebSocket 9001, utente `view`, ACL (sezione 5) |
| V16 | Dati: orologio avanzato localmente, valori interpolati, stato "non aggiornato", storico breve in memoria (sezione 6) |
| V17 | La scena mostra solo ciò che dicono i dati: gli effetti delle emergenze derivano dai sensori, `Complex/scenarios` serve solo per l'elenco (sezione 7) |
| V18 | Sei tappe T1–T6 e copione della demo (sezioni 12–13) |

---

## 3. Architettura

```
                                   ┌──────────────── browser ────────────────┐
┌──────────────┐  raw, state, model │  view (React Three Fiber)               │
│ simulator    │  clock, scenarios, │                                         │
│ (risorsa     │──── status, ack ──►│  mqtt/ ──► store/ ──► scene/  (3D, 2D)  │
│  gestita)    │                    │                   └─► ui/     (pannelli) │
└──────────────┘                    │  domain/  funzioni pure usate da tutti  │
       ▲  cmd, control/clock        │                                         │
       └────── broker MQTT ◄────────┤  (solo pannello di debug)               │
               Mosquitto            └─────────────────────────────────────────┘
               1883 (servizi)                    ▲ file statici + config.js
               9001 (WebSocket, utente view)     │
                                          container `view` (nginx, :8080)
```

- Il container `view` serve **solo file statici**. È il **browser** a collegarsi al broker, sulla porta WebSocket 9001.
- La vista non parla con il simulatore, con il Monitor né con InfluxDB: tutto passa dal broker.
- **Dipendenze in un solo verso:** `mqtt/` → `store/` → `scene/` e `ui/`. Tutti usano le funzioni pure di `domain/`, che non conosce né React né Three.js. La scena non conosce MQTT.

---

## 4. Struttura del progetto

```
view/
  Dockerfile              build in due fasi: node (npm ci, test, vite build) → nginx:alpine
  nginx.conf              file statici + no-cache su config.js
  docker-entrypoint.d/
    40-config.sh          genera /usr/share/nginx/html/config.js dalle variabili d'ambiente
  package.json · package-lock.json · vite.config.ts · tsconfig.json · index.html
  public/config.js        valori di sviluppo (npm run dev)
  src/
    main.tsx · App.tsx
    config.ts             legge window.__VIEW_CONFIG__ (URL del broker, utente, password)
    domain/               TypeScript puro, testato con vitest
      layout.ts           modello → coordinate: palazzi, piani, stanze, finestre, dispositivi
      plan.ts             pianta tipo (stanze, muri, finestre, balcone) in metri
      placement.ts        tabella tipo di dispositivo → stanza e posizione
      topics.ts           parsing e costruzione dei topic Complex/…
      messages.ts         tipi dei messaggi (specifica Monitor v2 §7.3) e loro validazione
      heat.ts             scale di colore per grandezza, soglie degli effetti, regola delle emergenze
      interpolate.ts      interpolazione tra misure, stato "non aggiornato"
      clock.ts            ora simulata avanzata localmente
      sun.ts              posizione del sole all'Aquila, fattore notte
      lod.ts              scelta delle etichette per distanza
      commands.ts         form e validazione dei comandi dal catalogo
    mqtt/
      client.ts           connessione, iscrizioni, riconnessione, invio dei comandi, attesa degli ack
      dispatch.ts         messaggio MQTT → azione sugli store
    store/
      model.ts            modello del complesso
      live.ts             misure, stati, orologio, scenari, connessione, storico breve
      ui.ts               modalità, selezione, filtri, mappa di calore, pannelli
      commands.ts         registro dei comandi di debug e loro esito
    scene/
      Viewport.tsx        Canvas, camera, rendering principale + minimappa
      CameraRig.tsx       controlli, transizioni 2D↔3D, voli verso un palazzo
      Complex.tsx · Building.tsx · Floor.tsx · Apartment.tsx · Stairwell.tsx · Park.tsx · Parking.tsx
      Devices.tsx         sensori e attuatori (istanze) e loro animazioni
      People.tsx · Cars.tsx
      Lighting.tsx        sole, cielo, fattore notte (stile giorno → notte)
      Weather.tsx         pioggia, vento, nuvole
      Hazards.tsx         fumo, fuoco, gas, sirene, scossa, pulsazione rossa
      Labels.tsx          sovraimpressioni (V11)
      Minimap.tsx
    ui/
      TopBar.tsx · DetailCard.tsx · Sparkline.tsx · Legend.tsx · StatusBanner.tsx
      DebugPanel.tsx      schede Comandi e Orologio
  tests/                  (i test vitest stanno accanto ai moduli: *.test.ts)
```

**Librerie** (versioni fissate nel `package-lock.json`): `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `mqtt` (mqtt.js 5), `vite`, `typescript`, `vitest`. Nessun'altra dipendenza senza motivo.

---

## 5. Broker e sicurezza

### 5.1 Mosquitto
In `mosquitto/config/mosquitto.conf` si aggiungono:

```
listener 9001
protocol websockets
acl_file /mosquitto/config/aclfile
```

`allow_anonymous false` e `password_file` restano globali: valgono per entrambi i listener. La porta 9001 è già pubblicata in `docker-compose.yml`.

### 5.2 Utente `view`
Si aggiunge a `mosquitto/config/passwordfile.txt` con `mosquitto_passwd`. Il file contiene solo password cifrate e resta versionato come oggi. Il comando è riportato in `docs/VISTA_3D.md`. La password va in `.env` come `VIEW_MQTT_PASSWORD`.

### 5.3 ACL (`mosquitto/config/aclfile`)
Con l'ACL attiva, un utente senza righe non può fare nulla: per questo `admin`, usato da tutti gli altri servizi, riceve accesso completo.

```
user admin
topic readwrite #

user view
topic read  Complex/model
topic read  Complex/clock
topic read  Complex/scenarios
topic read  Complex/status/#
topic read  Complex/raw/#
topic read  Complex/state/#
topic read  Complex/ack/#
topic write Complex/cmd/#
topic write Complex/control/clock
```

Rispetto alla D14 del Monitor, la vista legge anche `ack` (esito dei comandi di debug) e `status`; scrive `cmd` (solo con `"issued_by": "debug"`) e `control/clock`. **Non può** scrivere su `Complex/control/scenario` (V10). Nella fase 2 si aggiungeranno `monitored`, `health` e `alerts`.

Le credenziali di `view` sono **leggibili nel browser**: per questo l'utente ha i permessi minimi. È accettabile per una demo in locale.

### 5.4 Configurazione a runtime
All'avvio del container, `40-config.sh` scrive `config.js`:

```js
window.__VIEW_CONFIG__ = { mqttUrl: "ws://localhost:9001", username: "view", password: "…" };
```

a partire da `VIEW_MQTT_URL` (default `ws://localhost:9001`: è l'indirizzo visto **dal browser**, non dalla rete Docker), `VIEW_MQTT_USERNAME` (default `view`) e `VIEW_MQTT_PASSWORD`. nginx serve `config.js` con `Cache-Control: no-store`.

### 5.5 Servizio in `docker-compose.yml`

```yaml
  view:
    build: ./view
    container_name: iot_view
    ports:
      - "8080:80"
    environment:
      - VIEW_MQTT_URL=${VIEW_MQTT_URL}
      - VIEW_MQTT_USERNAME=${VIEW_MQTT_USERNAME}
      - VIEW_MQTT_PASSWORD=${VIEW_MQTT_PASSWORD}
    depends_on:
      - mosquitto
    restart: unless-stopped
    networks:
      - iot_net
```

Per provarla bastano `docker compose up -d --build mosquitto simulator view`: **Node-RED non serve e non va avviato** (inoltra gli allarmi a Telegram).

---

## 6. Dati

### 6.1 Collegamento
mqtt.js su WebSocket con `clientId` = `view-<8 caratteri casuali>`, `clean: true`, `keepalive` 30 s, `reconnectPeriod` 2 s. Iscrizioni: QoS 1 per `model`, `clock`, `scenarios`, `status/#`, `state/#`, `ack/#`; QoS 0 per `raw/#`.

### 6.2 All'avvio
- Grazie ai **messaggi retained** la vista riceve subito `Complex/model`, `Complex/clock`, `Complex/scenarios`, `Complex/status/simulator` e lo **stato di tutti i 283 attuatori**.
- Le misure `raw` non sono retained: ogni sensore resta **"in attesa"** (grigio) fino alla prima misura, al massimo dopo `sampling_period_s` (10 s).
- Senza `Complex/model` la scena non si costruisce: schermata "in attesa del modello del complesso".

### 6.3 Store
| Store | Contenuto |
|---|---|
| `model` | Il modello espanso e l'indice `device_id → unità, area, tipo, kind`. Se arriva un modello diverso (il simulatore è ripartito), la scena si ricostruisce e gli store `live` si svuotano |
| `live` | Per ogni sensore: ultima misura e precedente, con l'istante di arrivo, più uno **storico breve** (anello di 60 valori, 10 minuti a 10 s). Per ogni attuatore: `state`, `power_w`, istante di arrivo. Orologio, scenari attivi, stato del broker (`connecting`/`online`/`offline`) e del simulatore (`online`/`offline`), contatore dei messaggi scartati |
| `ui` | Modalità (3D/2D), palazzo e piano selezionati, unità e dispositivo selezionati, grandezza della mappa di calore, mappa di calore attiva, modalità dati, pannello di debug aperto |
| `commands` | Ultimi 10 comandi di debug con `cmd_id`, comando, esito (`attesa`, `ok`, `rifiutato: motivo`, `nessun ack`) |

Le misure **non** provocano un nuovo rendering di React: `live` è aggiornato fuori da React e la scena lo legge a ogni fotogramma (`useFrame`). I componenti React (scheda, barra) si aggiornano al massimo 2 volte al secondo.

### 6.4 Regole
- **Orologio** (`domain/clock.ts`): ora mostrata = `sim_time` dell'ultimo `Complex/clock` + `speed` × (ora reale − arrivo del messaggio). Ogni nuovo messaggio la riallinea.
- **Interpolazione** (`domain/interpolate.ts`): valore mostrato = precedente + (ultimo − precedente) × clamp((ora − arrivo dell'ultimo) / `sampling_period_s`, 0, 1). Alla prima misura non c'è interpolazione.
- **Stati discreti** (finestra, valvola, sirena…): nessuna interpolazione, ma un'animazione di 0,5 s.
- **"Non aggiornato"**: un sensore senza misure da più di 3 × `sampling_period_s` è mostrato tratteggiato. È solo resa grafica, non un giudizio di salute (quello spetta al Monitor).
- **Messaggi non validi** (non JSON, campi mancanti, dispositivo sconosciuto): scartati e contati; mai un'eccezione non gestita.

### 6.5 Comandi di debug
- Il form si costruisce da `device_types.<tipo>.commands` del modello: `enum` → menu, `min`/`max` (con `integer`) → cursore, `string` → campo di testo, `bool` → casella. Si invia solo un comando valido per il catalogo.
- Invio su `Complex/cmd/<area>/<unità>/<attuatore>`, QoS 1: `{"cmd_id": "<uuid>", "command": {…}, "issued_by": "debug", "timestamp": <epoch s>}`.
- Esito: ack con lo stesso `cmd_id` su `Complex/ack/…` → `ok` oppure `rifiutato: <reason>`; nessun ack entro **5 s** → `nessun ack` (è ciò che produce il guasto `no_ack`).
- Orologio: `{"speed": n}` con n 1…`max_speed`; `{"jump_to": "HH:MM"}` oppure `{"jump_to": "AAAA-MM-GGTHH:MM:SS"}` su `Complex/control/clock`.

---

## 7. La scena

### 7.1 Coordinate e orientamento
- Il modello usa metri con `x_m` verso est e `y_m` verso nord. Nella scena: **X = `x_m`, Z = −`y_m`, Y verso l'alto**.
- **Orientamento di un palazzo:** il lato con il soggiorno dell'interno 1 (il "lato 1" della pianta) guarda l'esposizione `orientation` dell'interno 1 (N/S/E/O), coerente con il sole della fisica. Con i valori di default: A → S, B → O, C → N, D → E, cioè tutti verso il parco. `rotation_deg` viene usato solo come controllo di coerenza (0°/180° = lato lungo est-ovest, 90°/270° = nord-sud); se non concorda, avviso in console.
- **Dimensioni:** `width_m`, `depth_m`, `floor_height_m` dal `layout` del palazzo; numero di piani dal modello. Zoccolo fisso di 0,6 m; parapetto del tetto di 1 m.
- **Parco e parcheggio:** dai `layouts` di `park` e `parking`.
- **Coordinate geografiche per il sole:** `complex.lat`/`lon` se presenti, altrimenti l'Aquila (42,35 N, 13,40 E).

### 7.2 Pianta tipo (`domain/plan.ts`)
Metri della pianta: `u` lungo il lato lungo (0…26), `v` in profondità (0 = lato 2, 12 = lato 1). Se `width_m`/`depth_m` sono diversi da 26 × 12, la pianta si scala in proporzione.

| Elemento | Interno 1 (`u`, `v`) |
|---|---|
| Soggiorno con cucina | 0–6,5 × 6,5–12 (piano cucina lungo `u` = 0,6–1,2, `v` = 8,2–11,6) |
| Camera | 6,5–10,5 × 6,5–12 |
| Camera 2 | 0–4 × 0–4,5 |
| Bagno (caldaia) | 4–6,5 × 0–3 |
| Bagno 2 | 6,5–10,5 × 0–3 |
| Ingresso e disimpegno | il resto di 0–10,5 × 3–6,5 |
| Porta d'ingresso | `u` = 10,5, `v` = 4,6–5,6 |
| Balcone | 0,4–6,2 × 12–13,5 (dal 1° piano; al piano terra un patio) |
| Finestre lato 1 (`v` = 12) | 0,6–6,0 (portafinestra alta 2,4 m), 7,3–9,8 |
| Finestre lato 2 (`v` = 0) | 0,8–3,3; 4,8–5,8; 7,8–9,3 |

- **Interno 2:** la stessa pianta **ruotata di 180°** attorno al centro, cioè (`u`, `v`) → (26 − `u`, 12 − `v`).
- **Vano scale** (`u` 10,5–15,5): scale 11–15 × 0,5–4,5; pianerottolo 10,5–15,5 × 4,5–8,5; ascensore 11–13 × 8,5–10,9; androne 13–15,5 × 8,5–12, aperto verso il lato 1 al piano terra (uscita verso il parco) e verso il lato 2 (ingresso dalla strada). Finestra delle scale sul lato 2 (11,2–14,8) dal 1° piano in su.
- **Finestre:** sill 0,9 m e altezza 1,5 m, salvo le portefinestre.
- **Se il modello ha un numero di appartamenti per piano diverso da 2**, la vista ripiega su blocchi senza stanze, di larghezza uguale, e senza dispositivi installati (solo le etichette).
- **Muri dello spaccato (V20):** nel piano tagliato in 3D i muri sono **interi**, alti `floor_height_m` − 0,3 (2,9 m), sia negli appartamenti sia nel vano scale. Gli appartamenti usano gli stessi muri della prima persona (`domain/interior.ts`): vani delle finestre con davanzale, architrave e telaio, architravi sopra le porte interne e porta d'ingresso aperta. **In 2D** i muri restano tagliati a 1,1 m, come prima, perché la pianta resti leggibile. Ringhiere dei balconi e piani fantasma non cambiano.
- **Arredi (V19, V20):** 33 ingombri per interno in `domain/furniture.ts` (30 al piano terra, senza il balcone), riempiti da modelli del **Kenney Furniture Kit** (CC0) secondo la tabella di `domain/furnitureModels.ts`. La tabella indica per ogni ingombro uno o più pezzi, con modello, verso del fronte (`+u`, `−u`, `+v`, `−v`) ed eventuale altezza massima. La cucina è fatta di 5 pezzi lungo il piano cucina (frigo, cassetti, fornello, mobile, lavello) con il fronte verso `+u`, e la TV sta sopra il suo mobile. Ogni modello si adatta al suo ingombro con **scala uniforme** (mai deformato), girato secondo il verso, centrato e appoggiato sulla soletta di 0,12 m (`scene/modelFit.ts`). La **caldaia** è l'unico pezzo disegnato a codice: il pacchetto non la contiene. Gli arredi si vedono negli appartamenti del piano tagliato e in quello visitato in prima persona, disegnati come istanze; non sono selezionabili. In **modalità dati** hanno un materiale neutro, così il colore resta solo sui dati; nei palazzi sbiaditi sono semitrasparenti.

### 7.3 Posizione dei dispositivi (`domain/placement.ts`)
Altezze in metri dal pavimento; "soffitto" = `floor_height_m` − 0,3. Posizioni per l'interno 1, ruotate per l'interno 2.

La resa grafica monta i dispositivi alle quote di `domain/deviceAppearance.ts`: quelli "a soffitto" stanno in alto sulle pareti. Queste quote valgono nella prima persona e, con i muri interi di V20, anche nello **spaccato 3D**. Solo la **planimetria 2D** li abbassa come in V19: i dispositivi a parete, compresi quelli alti e lo split, a non più di 0,9 m, e le lampade a 0,8 m.

| Dispositivo | Dove | (`u`, `v`, altezza) |
|---|---|---|
| `temperature`, `humidity` | termostato sulla parete del soggiorno | (0,1; 7,2; 1,5), (0,1; 7,6; 1,5) |
| `co2` | parete del soggiorno | (3,2; 6,6; 1,5) |
| `occupancy` | sensore a soffitto del soggiorno | (3,8; 9,6; soffitto) |
| `light` | accanto alla portafinestra | (5,4; 11,8; 1,2) |
| `smoke` | soffitto della cucina | (1,8; 11,0; soffitto) |
| `gas` | sopra la cucina (il metano sale) | (1,0; 8,6; soffitto) |
| `co` | bagno, vicino alla caldaia | (5,8; 0,4; 1,7) |
| `noise_level` | parete della camera | (8,6; 10,8; 1,6) |
| `power`, `water_flow`, `gas_flow` | quadro dei contatori all'ingresso | (10,3; 3,4 / 3,7 / 4,0; 1,4) |
| `hvac` | split sulla parete del soggiorno | (3,0; 6,6; 2,4) |
| `ventilation` | griglia a soffitto del bagno | (4,7; 0,6; soffitto) |
| `window` | **tutte** le finestre dell'appartamento | — |
| `blinds` | **tutte** le finestre dell'appartamento | — |
| `lights` | lampade a soffitto di tutte le stanze e luce nelle finestre | — |
| `gas_valve` | sotto il piano cottura | (1,0; 11,6; 0,5) |
| `alarm` | soffitto del disimpegno | (8,2; 4,1; soffitto) |
| `resident_display` | parete dell'ingresso | (10,3; 5,9; 1,5) |

| Unità | Dispositivo | Dove |
|---|---|---|
| Vano scale | `temperature`, `light`, `occupancy` | parete dell'androne al piano terra |
| | `smoke` | soffitto dell'ultimo piano, vicino all'evacuatore |
| | `stair_lights` | lampade su ogni pianerottolo |
| | `smoke_vent` | botola sul tetto sopra le scale |
| | `evacuation_siren` | lampeggiante su ogni pianerottolo |
| Palazzo | `pv_power` | inverter sul tetto; i pannelli sono la sua forma visibile |
| | `elevator` | cabina nel vano ascensore |
| | `battery` | armadio nell'androne con barra di carica |
| Parco | `temperature`, `humidity`, `rain_level`, `wind_speed`, `light`, `noise_level`, `pm10`, `pm2_5` | stazione meteo su un palo in un angolo del parco (anemometro che gira con `wind_speed`) |
| | `seismic` | cassetta alla base della stazione meteo |
| | `soil_moisture` | sonda nel prato |
| | `irrigation` | 6 irrigatori nei prati |
| | `park_lights` | 6 lampioni lungo i vialetti |
| | `evacuation_signs` | un cartello all'uscita dell'androne di ogni palazzo e uno al punto di raccolta al centro del parco |
| Parcheggio | `ev_charger` | 4 colonnine sul lato del parcheggio verso i palazzi, in ordine di `id` |

Un **sensore** è un piccolo disco bianco con un anello del colore della sua famiglia (ambiente, sicurezza, energia, esterno).

### 7.4 Resa degli attuatori
| Attuatore | Resa |
|---|---|
| `window` | ante ruotate di 70° se `open` (piani pieni e, dalla V20, vani finestra dello spaccato 3D) |
| `blinds` | tapparella abbassata di (100 − `position`) % (piani pieni e spaccato 3D) |
| `lights` | lampade e vetri emissivi proporzionali a `level` (visibili soprattutto di notte) |
| `hvac` | split con un flusso di particelle blu (`cool`) o rosso (`heat`); spento se `off` |
| `ventilation` | griglia che ruota con velocità proporzionale a `level` |
| `gas_valve` | maniglia gialla parallela (aperta) o perpendicolare (chiusa) al tubo |
| `alarm`, `evacuation_siren` | lampeggiante rosso quando `on` |
| `resident_display` | pannello colorato secondo `level` (`info` blu, `warning` giallo, `danger` rosso) con `message` in etichetta |
| `stair_lights` | spente, normali, o `evacuation` (verdi e lampeggianti) |
| `smoke_vent` | botola sollevata se `open` |
| `elevator` | `normal`: cabina al piano terra, porte chiuse, spia verde; `recall`: porte aperte, spia rossa |
| `battery` | barra con `soc_pct`; freccia verso l'alto (`charge`) o verso il basso (`discharge`) |
| `irrigation` | getti d'acqua a particelle quando `on` |
| `park_lights` | lampioni accesi |
| `evacuation_signs` | frecce verdi luminose quando `on` |
| `ev_charger` | auto presente se `car_connected`; LED che pulsa se `power_w` > 0; LED fisso in `pause` |

### 7.5 Persone
- **Appartamento:** tanti residenti quanti indica `occupancy` (arrotondato). Le posizioni sono stabili, scelte con un seme dall'ID dell'appartamento tra punti predefiniti delle stanze (`domain/people.ts`).
- **Vano scale:** tanti residenti sulle scale quanti indica `occupancy` del vano scale. Stanno in piedi sul gradino sotto di loro (`domain/stairs.ts`).
- **Personaggi (V20):** modelli **Quaternius Ultimate Modular** (CC0), 4 donne e 4 uomini già vestiti, animati con `SkeletonUtils.clone` e un `AnimationMixer` ciascuno (`domain/residents.ts`, `scene/People.tsx`). Variante, altezza (tra 1,60 e 1,80 m) e orientamento sono **stabili** per appartamento e posto (hash della chiave). In casa usano `Idle` o `Idle_Neutral` con una fase casuale; nel vano scale `Walk`, verso l'alto della rampa, perché sono persone in transito. Non esistono animazioni da seduti.
- Al massimo **80 residenti** visibili. Le posizioni si aggiornano 2 volte al secondo; le animazioni solo per i residenti inquadrati.
- I residenti si vedono con il piano tagliato, in 2D e nell'appartamento visitato in prima persona.

### 7.6 Giorno e notte (`domain/sun.ts`, `Lighting.tsx`)
- Posizione del sole (azimut ed elevazione) calcolata dall'ora simulata, fuso `Europe/Rome`, con l'algoritmo approssimato NOAA.
- **Fattore notte** `n` = 1 con elevazione ≤ −6°, 0 con elevazione ≥ +6°, interpolato in mezzo.
- `n` regola l'intensità e il colore del sole, il cielo, la luce ambiente e il passaggio di stile (V13): colori dei materiali dallo stile "realistico" a quello "digital twin", finestre emissive, mappa di calore luminosa. Con `n` = 1 la scena è quella del digital twin.

### 7.7 Meteo (sensori del parco)
- **Pioggia:** particelle con densità proporzionale a `rain_level` (piena a 30 mm/h).
- **Vento:** alberi che ondeggiano con ampiezza proporzionale a `wind_speed` (massima a 80 km/h); l'anemometro gira.
- **Nuvole:** cielo coperto e sole attenuato quando `rain_level` > 0 (il simulatore pone la nuvolosità a 0 quando non piove).

### 7.8 Emergenze
Gli effetti derivano **solo dai sensori e dagli stati**. `Complex/scenarios` serve solo per l'elenco nella barra (V17). Le soglie sono **solo visive** e stanno in `domain/heat.ts`.

| Effetto | Condizione | Resa |
|---|---|---|
| Pulsazione rossa (V12) | `smoke`, `gas` o `co` > `rest_value` del catalogo | L'appartamento pulsa in rosso, con qualunque grandezza scelta e anche con la mappa di calore spenta |
| Fumo | `smoke` > 1 % | Fumo dalle finestre, densità proporzionale fino a 30 %; nel vano scale, fumo lungo le scale |
| Fuoco | `temperature` > 60 °C **e** `smoke` > 10 % | Bagliore arancione tremolante nelle finestre |
| Gas | `gas` > 5 %LEL | Foschia verdastra nell'appartamento (visibile con il piano tagliato) |
| Monossido | `co` > 0 | Icona di pericolo sull'appartamento (il CO è invisibile) |
| Sisma | `seismic` > 3 Mw | Scossa della camera con ampiezza proporzionale a (`seismic` − 3) |
| Allarmi e sirene | stato `on` | Lampeggianti rossi (sezione 7.4) |

### 7.9 Mappa di calore e modalità dati
- **Mappa di calore attiva:** il colore della grandezza scelta tinge i vetri e il pavimento dello spaccato di giorno, e l'intero volume (emissivo) di notte. **Spenta:** nessuna tinta, ma le emergenze pulsano comunque.
- **Pavimento dello spaccato (V20):** listoni di legno generati a codice (`CanvasTexture`, nessuna immagine esterna; posa in `domain/woodFloor.ts`). Con la mappa di calore attiva il legno è **tinto del colore del dato**, e la venatura resta visibile. Con la mappa spenta è solo legno. Con dati non aggiornati è grigio tratteggiato, come prima. In modalità dati il pavimento resta liscio (niente legno), in stile plastico.
- **Modalità dati** (V13): materiali in stile "plastico" (volumi chiari, base neutra), colori solo sui dati; si attiva e disattiva dalla UI. Arredi con un materiale neutro (V20).

---

## 8. Interfaccia

### 8.1 Navigazione
- **Camera** con i controlli di drei: rotazione, zoom e spostamento; distanza 20–350 m; mai sotto il terreno.
- Doppio clic su un palazzo: la camera vola lì in 0,8 s. Clic su un'unità o un dispositivo: selezione.
- **Scorciatoie:** `D` debug, `H` mappa di calore, `M` modalità dati, `2`/`3` per le modalità 2D/3D, `Esc` per deselezionare.

### 8.2 2D e 3D
- Il **2D** è la stessa scena vista dall'alto con una **camera ortografica**, raggiunta con una transizione animata. In 2D si guarda sempre un piano tagliato: di default il piano terra, con parco e parcheggio.
- In 2D si possono spostare la camera e fare zoom, ma non ruotarla (nord in alto).
- In 2D i muri del piano tagliato restano a 1,1 m e i dispositivi alle quote basse di V19 (§7.2, §7.3), come prima di V20.

### 8.3 Filtri
- **Palazzo** (Tutti, A, B, C, D): gli altri palazzi diventano semitrasparenti e la camera si centra sul palazzo scelto.
- **Piano** (Tutti, T, 1, 2, 3): i piani sopra diventano fantasmi (volumi trasparenti con i contorni); il piano scelto è aperto dall'alto e mostra stanze, arredi, dispositivi e persone. In 3D i muri sono interi (2,9 m, V20); in 2D sono tagliati a 1,1 m (§7.2).

### 8.4 Sovraimpressioni (V11, `domain/lod.ts`)
| Distanza camera–oggetto | Cosa si vede |
|---|---|
| > 150 m | Solo colori e icone di pericolo che pulsano |
| 60–150 m | Un'etichetta per appartamento: "A-2-1 · 23.8 °C" (grandezza della mappa di calore) |
| < 60 m, oppure piano tagliato | Le etichette dei dispositivi installati, con il loro valore |

Al massimo **40 etichette** insieme: si scelgono le più vicine tra quelle inquadrate. Le etichette sono elementi HTML ancorati alla scena.

### 8.5 Barra in alto
Nome del complesso · data, ora simulata e velocità · 2D/3D · Palazzo · Piano · grandezza della mappa di calore più l'interruttore · modalità dati · scenari attivi come etichette (per esempio "🔥 fire · A-2-1") · stato del broker e del simulatore.

### 8.6 Scale di colore (`domain/heat.ts`)
| Grandezza | Scala | Default |
|---|---|---|
| Temperatura | 16–30 °C | ✅ |
| CO₂ | 400–2000 ppm | |
| Umidità | 20–80 % | |
| Rumore | 30–80 dB | |
| Luce | 0–1000 lx | |
| Presenze | 0–residenti dell'appartamento | |
| Consumo elettrico | 0–4000 W | |

Scala continua blu → verde → giallo → arancio → rosso. La legenda in basso segue la grandezza scelta.

### 8.7 Scheda di dettaglio (a destra)
- **Appartamento:** ID, profilo, residenti, esposizione; i 12 sensori con valore, unità, freccia di tendenza (confronto con la misura precedente), "in attesa" o "non aggiornato"; gli 8 attuatori con il loro stato.
- **Vano scale, palazzo, parco, colonnina:** i loro dispositivi, con lo stesso formato.
- **Clic su un sensore:** mini grafico dello storico breve (ultimi 10 minuti).
- **Clic su un attuatore:** lo seleziona nel pannello di debug.

### 8.8 Minimappa (in basso a sinistra)
Secondo rendering della scena dall'alto con camera ortografica, 200 × 200 px, con il taglio di piano corrente. Mostra il nord, un'etichetta con palazzo e piano correnti, un **pallino sul punto inquadrato** (il centro della vista) e il **cono della camera**, che parte dalla camera e punta verso il pallino (visibili solo nella minimappa). Un clic inquadra il punto cliccato: la vista vi si centra mantenendo distanza e angolo, e il pallino finisce dove si è cliccato (`minimapMarker` in `domain/camera.ts`).

### 8.9 Pannello di debug (`D`)
Pannello in sovraimpressione, chiuso di default.
- **Comandi:** l'attuatore selezionato, oppure la scelta di unità e attuatore da un menu; form dal catalogo (sezione 6.5); "Invia"; registro degli ultimi 10 comandi con il loro esito; contatore dei messaggi scartati.
- **Orologio:** velocità (cursore 1…`max_speed` e pulsanti ×1, ×10, ×60); salto a ore predefinite (alba 06:30, mezzogiorno 12:00, tramonto 19:00, notte 22:00); salto a data e ora scelte (per esempio un giorno d'inverno).

---

## 9. Gestione degli errori

| Situazione | Comportamento |
|---|---|
| Broker irraggiungibile o credenziali errate | Banner "broker non raggiungibile, riprovo…" (o "credenziali rifiutate"); riconnessione ogni 2 s; scena ferma sull'ultimo stato, desaturata |
| Simulatore `offline` (Last Will) | Banner "simulatore non in linea"; i sensori diventano via via "non aggiornati" |
| Nessun `Complex/model` | Schermata "in attesa del modello del complesso" |
| Nuovo `Complex/model` diverso | Scena ricostruita, `live` svuotato, selezione annullata |
| Messaggio non valido o dispositivo sconosciuto | Scartato e contato (pannello di debug) |
| Comando rifiutato dall'ACL o dal simulatore | Esito "rifiutato" nel registro dei comandi |
| Modello con pianta non supportata | Blocchi senza stanze (sezione 7.2), con i muri tagliati a 1,1 m anche in 3D |
| Modello 3D esterno mancante o non valido (V20) | Sparisce solo il suo strato (arredi o residenti), con un errore in console; il resto della scena continua (`scene/ModelBoundary.tsx`) |
| WebGL non disponibile | Messaggio esplicito al posto della scena |

La vista non deve mai bloccarsi: ogni errore nei gestori dei messaggi viene intercettato e registrato in console.

---

## 10. Prestazioni
- **Obiettivo:** 60 fps su un portatile recente con la scena completa.
- **Istanze** per sensori, finestre, alberi e arredi (una mesh istanziata per ogni parte di ogni modello Kenney, condivisa da tutti gli appartamenti arredati); geometria statica di ogni palazzo unita in poche mesh.
- **Residenti animati** (V20): al massimo 80, e il mixer si aggiorna solo per quelli inquadrati. Misura locale del 2026-10-02 nel browser integrato (800 × 1023 px, dpr 2): circa 100 fps con il piano 2 tagliato e i residenti reali, 52 fps con 80 residenti.
- **Asset esterni** (V20): circa 2,4 MB al primo caricamento (26 arredi ≈ 0,45 MB, 8 personaggi meshopt ≈ 2 MB), precaricati all'avvio; la scena non li aspetta (`Suspense`).
- **Una sola luce con ombre** (il sole), mappa d'ombra 2048 × 2048.
- Risoluzione limitata a 2× e **abbassata automaticamente** se gli fps calano (monitor di prestazioni di drei).
- Le **etichette** sono limitate a 40 (sezione 8.4). Le misure non provocano rendering di React (sezione 6.3).
- Il carico MQTT (circa 41 messaggi al secondo più gli stati) è trascurabile per il browser.

---

## 11. Test

### 11.1 Test automatici (vitest, scritti prima del codice)
- `layout`/`plan`/`placement`:
  - 32 appartamenti e 4 vani scale con le coordinate attese;
  - nessuna sovrapposizione tra palazzi, parco e parcheggio;
  - orientamento: il lato 1 di A guarda a sud, quello di B a ovest, ecc.;
  - ogni dispositivo sta dentro la sua stanza e dentro il palazzo;
  - rotazione di 180° dell'interno 2;
  - ripiego su blocchi con 3 appartamenti per piano.
- `topics`: parsing e costruzione, rifiuto dei topic malformati.
- `messages`: accetta gli esempi della specifica Monitor v2 §7.3 e rifiuta quelli malformati.
- `heat`: estremi e punti intermedi delle scale; regola della pulsazione con `rest_value`.
- `interpolate`: inizio, metà e fine dell'intervallo; soglia "non aggiornato".
- `clock`: avanzamento a ×1 e ×60; riallineamento.
- `sun`: all'Aquila il 21 giugno a mezzogiorno solare l'elevazione è circa 71° (±1°), il 21 dicembre circa 24° (±1°); di notte è negativa; fattore notte agli estremi.
- `lod`: fasce di distanza e limite di 40 etichette.
- `commands`: form dal catalogo per ogni attuatore; validazione di `min`/`max`/`integer`/`enum`.
- **Store e dispatch:** sequenze di messaggi di esempio → stato atteso (modello, misure, stati, orologio, scenari, ack con e senza timeout), con un finto client MQTT.

Anche la build Docker esegue `npm test` e `tsc --noEmit`: se falliscono, l'immagine non si costruisce.

### 11.2 Test end-to-end (`scripts/e2e_view.py`)
Come `scripts/e2e_simulator.py`, contro `docker compose up -d --build mosquitto simulator view`:
1. `http://localhost:8080/` risponde con la pagina e `config.js` contiene l'URL del broker;
2. l'utente `view` si collega via WebSocket (porta 9001) e riceve `Complex/model` e almeno 400 misure `raw` distinte;
3. un comando su `Complex/cmd/…` con `"issued_by": "debug"` riceve l'ack `ok`;
4. una pubblicazione di `view` su `Complex/control/scenario` **non** produce nessuna modifica di `Complex/scenarios` (ACL);
5. `admin` continua a funzionare sulla porta 1883 (i servizi esistenti non sono rotti dall'ACL).

### 11.3 Verifica visiva
Checklist in `docs/VISTA_3D.md` (un punto per ogni riga delle tabelle 7.4 e 7.8, più 2D/3D, filtri, minimappa e giorno/notte), da ripercorrere a mano alla fine di ogni tappa che tocca la scena.

---

## 12. Tappe

| Tappa | Contenuto | Risultato verificabile |
|---|---|---|
| T1 | Mosquitto (WebSocket, ACL, utente `view`), servizio `view` con nginx e `config.js`, `mqtt/`, store, banner di stato; `domain/topics`, `messages`, `clock` | La pagina mostra "414 sensori · 283 attuatori ricevuti"; e2e punti 1, 2, 5 |
| T2 | `layout` di `complex.json` a 26 m e 3,2 m; `domain/layout`, `plan`, `placement`; scena statica (palazzi V6, stanze, parco, parcheggio), camera, filtri palazzo e piano, 2D/3D, minimappa | Il complesso è navigabile e tagliabile per piano, in 3D e in 2D |
| T3 | Pannello di debug: comandi (`domain/commands`, registro, ack) e orologio | Un comando manuale produce l'ack; il salto alle 22:00 cambia l'ora; e2e punti 3, 4 |
| T4 | Dati vivi: mappa di calore interpolata, scale, legenda, sovraimpressioni per zoom, scheda con storico breve, attuatori animati (7.4), persone, auto | Aprendo una finestra dal debug la si vede aprirsi; i colori seguono le misure |
| T5 | Atmosfera ed emergenze: sole e giorno→notte (B→C), meteo, effetti della 7.8, modalità dati, interruttore della mappa di calore | Un incendio avviato con `mosquitto_pub` si vede nascere e propagarsi; di notte lo stile è il digital twin |
| T6 | Documentazione (`docs/VISTA_3D.md` con checklist visiva, `docs/MONITOR.md` §4.5, README) e prova del copione della demo | Il copione della sezione 13 funziona da capo a fondo |

---

## 13. Copione della demo (fase 1, circa 4 minuti)

Stack: `docker compose up -d --build mosquitto simulator view`, browser su `http://localhost:8080`.

1. **Panoramica** di giorno a ×60, con la mappa di calore sulla temperatura: il sole si muove, le ombre ruotano.
2. **Zoom sul palazzo A**, taglio al 2° piano: stanze, sensori installati con i valori, scheda di A-2-1 con lo storico breve.
3. **Salto alle 21:00** dal debug: il complesso passa al digital twin notturno.
4. **Incendio in A-2-1** avviato da terminale:
   ```bash
   docker exec iot_mosquitto mosquitto_pub -u admin -P adminpassword123 -t Complex/control/scenario -m '{"action":"start","scenario":"fire","target":"A-2-1"}'
   ```
   Fumo dalle finestre, pulsazione rossa, propagazione agli appartamenti vicini, fumo nel vano scale.
5. **Dal debug:** valvola del gas di A-2-1 chiusa ed evacuatore di fumo del vano scale aperto. Si vedono l'ack e il fumo delle scale che si dirada.
6. **Planimetria 2D** piano per piano per vedere fin dove si è esteso.

Nella fase 2 il punto 5 lo farà il manager da solo, e la vista mostrerà anche il perché.

---

## 14. Modifiche fuori da `view/`

| File | Modifica | Tappa |
|---|---|---|
| `mosquitto/config/mosquitto.conf` | Listener 9001 WebSocket, `acl_file` | T1 |
| `mosquitto/config/aclfile` | Nuovo (sezione 5.3) | T1 |
| `mosquitto/config/passwordfile.txt` | Utente `view` | T1 |
| `.env` | `VIEW_MQTT_URL`, `VIEW_MQTT_USERNAME`, `VIEW_MQTT_PASSWORD` | T1 |
| `docker-compose.yml` | Servizio `view` (sezione 5.5) | T1 |
| `scripts/e2e_view.py` | Nuovo (sezione 11.2) | T1, completato in T3 |
| `config/complex.json` | Nei 4 palazzi `layout.width_m` 24 → 26 e `layout.floor_height_m` 3 → 3.2. Nessun altro campo cambia; `area_m2` resta 80 | T2 |
| `docs/superpowers/specs/2026-09-30-monitor-v2-design.md` | Esempio `layout` della §5.1 allineato (26 m, 3,2 m) | T2 |
| `docs/MONITOR.md` | §4.5: la vista legge anche `ack` e `status` e scrive `cmd` (debug) e `control/clock` | ✅ fatto con la specifica |

I campi `layout` sono letti solo da `model.py`, che li pubblica su `Complex/model`: la fisica non cambia. I test del simulatore vanno comunque rieseguiti in T2.

---

## 15. Fase 2 (fuori perimetro, già predisposta)
- **Strato del manager:** nuovi store e componenti che leggono `Complex/monitored/…`, `Complex/health/…` e gli alert dell'Analyzer, con una timeline "rilevamento → piano → comandi → ack" e la distinzione tra comandi `debug` e `planner`. L'ACL di `view` si estende in lettura.
- **Persone evacuate nel parco** (V9): nuovo topic retained del simulatore (per esempio `Complex/sim/people`), vietato al manager.
- **Prima persona** dentro l'appartamento selezionato (V4): la pianta tipo ha già le stanze.
- **Scenari e guasti:** dalla UI Streamlit v2 (tappa 4 del Monitor).

---

## 16. Requisiti e loro copertura

| # | Requisito | Sezioni |
|---|---|---|
| RV1 | Vista separata che legge solo dal broker, senza logica di simulazione | 3, 6, 7.8 |
| RV2 | Scena generata dal modello, con pianta tipo e dispositivi installati | 7.1–7.3 |
| RV3 | Modalità 2D e 3D, filtri per palazzo e piano, spaccato | 8.1–8.3 |
| RV4 | Sovraimpressioni per livello di zoom, scheda di dettaglio, minimappa | 8.4, 8.7, 8.8 |
| RV5 | Mappa di calore a scelta e disattivabile; emergenze sempre visibili | 7.8, 7.9, 8.6 |
| RV6 | Attuatori, persone, auto, parco visibili nel loro stato | 7.4, 7.5 |
| RV7 | Giorno/notte dall'ora simulata con passaggio di stile; meteo | 7.6, 7.7 |
| RV8 | Pannello di debug: comandi agli attuatori e orologio | 6.5, 8.9 |
| RV9 | Accesso al broker con permessi minimi | 5 |
| RV10 | Robustezza, prestazioni, test | 9, 10, 11 |
