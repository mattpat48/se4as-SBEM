# MONITOR — stato, decisioni e guida d'uso

Questo file traccia **cosa fa oggi** il Monitor, **cosa dovrà fare** nella versione per il progetto MAPE-K (SE4AS) e **quali decisioni** abbiamo preso. Si aggiorna a ogni decisione o implementazione: se lavori su Analyzer, Planner, Node-RED, Grafana o sulla vista 3D, parti da qui per sapere quali dati puoi usare.

**Legenda stato:** ✅ fatto · 🟡 in corso · 📐 progettato (nella specifica, da implementare) · ⬜ da fare · ❓ da decidere

**Specifica tecnica completa della v2:** [`docs/superpowers/specs/2026-09-30-monitor-v2-design.md`](superpowers/specs/2026-09-30-monitor-v2-design.md). È il riferimento ufficiale per nomi, formati e parametri: se questo file e la specifica non coincidono, **vale la specifica**.

**Ultimo aggiornamento:** 2026-09-30

---

## 0. Dove trovare cosa (guida rapida)

> La v2 è **in corso**: il **simulatore** (tappe 1–2) è disponibile; il servizio `monitor` (tappa 3) e l'adeguamento degli altri servizi (tappa 4) sono ancora da fare. Le righe con ✅ sono già utilizzabili; le altre esisteranno dalla tappa indicata (sezione 4.4). Fino alla tappa 4 funziona anche la v1 (sezione 3).

| Cerco… | Dove si trova | Disponibile da |
|---|---|---|
| **Struttura del complesso** (palazzi, piani, appartamenti, vani scala, parco, parcheggio, layout per il 3D) | File `config/complex.json`; formato descritto nella [specifica, §5](superpowers/specs/2026-09-30-monitor-v2-design.md#5-il-modello-del-complesso-configcomplexjson) | ✅ Tappa 1 |
| **Modello completo già espanso** (tutti i 32 appartamenti con profilo, residenti, esposizione, adiacenze e dispositivi) | Topic MQTT retained `Complex/model` | ✅ Tappa 1 |
| **Catalogo dei sensori** (tipo, unità, intervallo valido, rumore, valore di riposo) | Sezione `device_types` di `config/complex.json`; tabella nella [specifica, §6.1](superpowers/specs/2026-09-30-monitor-v2-design.md#61-sensori) e in sintesi nella 4.1 qui sotto | ✅ Tappa 1 |
| **Catalogo degli attuatori** (comandi ammessi, stato iniziale, consumo, se essenziale) | Sezione `device_types` di `config/complex.json`; tabella nella [specifica, §6.2](superpowers/specs/2026-09-30-monitor-v2-design.md#62-attuatori) e in sintesi nella 4.2 qui sotto | ✅ Tappa 2 |
| **Formato degli ID** (`A-2-1`, `A-S`, `A-2-1.co2`…) | [Specifica, §4](superpowers/specs/2026-09-30-monitor-v2-design.md#4-identificativi) | — |
| **Elenco dei topic MQTT** e chi li pubblica | [Specifica, §7.2](superpowers/specs/2026-09-30-monitor-v2-design.md#72-topic) e riepilogo nella 4.5 qui sotto | ✅ `raw`, `state`, `cmd`, `ack`, `clock`, `control`, `scenarios`, `status/simulator`; `monitored` e `health` dalla tappa 3 |
| **Esempi di messaggi JSON** (misure, stati, comandi, ack, salute, orologio, scenari) | [Specifica, §7.3](superpowers/specs/2026-09-30-monitor-v2-design.md#73-messaggi) | ✅ quelli del simulatore; `monitored` e `health` dalla tappa 3 |
| **Parametri della fisica** (costanti di tempo, CO₂, incendio, orari delle persone…) | Sezione `physics` di `config/complex.json`; valori di default nella [specifica, §8](superpowers/specs/2026-09-30-monitor-v2-design.md#8-modello-fisico-environmentpy-physicspy-occupancypy) | ✅ Tappa 1 |
| **Scenari** (nomi, target, parametri) e come avviarli | [Specifica, §9](superpowers/specs/2026-09-30-monitor-v2-design.md#9-scenari-scenariospy); comando su `Complex/control/scenario`; esempi nella 4.6 qui sotto | ✅ Tappa 2 |
| **Regole di validazione** del Monitor (bloccato, deriva, spento) e loro parametri | Sezione `monitor` di `config/complex.json`; regole nella [specifica, §10](superpowers/specs/2026-09-30-monitor-v2-design.md#10-monitor) | Tappa 3 |
| **Dati storici in InfluxDB** (measurement, tag, campi, query di esempio) | [Specifica, §11](superpowers/specs/2026-09-30-monitor-v2-design.md#11-knowledge-influxdb) | Tappa 3 |
| **Codice del simulatore** | Cartella `simulator/` (test in `simulator/tests/`, prova end-to-end in `scripts/e2e_simulator.py`) | ✅ Tappe 1–2 |
| **Codice del Monitor** | Cartella `monitor/` | Tappa 3 |
| **Vista 3D** (stato, decisioni, specifica) | [`docs/VISTA_3D.md`](VISTA_3D.md) | In progettazione |
| Monitor **attuale (v1)**: topic `City/…`, measurement `sensors` | Sezione 3 di questo file | Già disponibile |

---

## 1. Ruolo del Monitor nel ciclo MAPE-K

Il Monitor è la fase che **osserva la risorsa gestita** (gli edifici) e rende disponibili le osservazioni alle altre fasi:

- raccoglie le misure dei sensori (ambiente interno, esterno, persone);
- raccoglie lo **stato degli attuatori** (HVAC, ventilazione, finestre, luci, allarmi), senza il quale non si possono valutare le azioni del Planner;
- scarta o segnala i dati non validi e i sensori guasti o spenti;
- pubblica tutto su MQTT e lo rende persistente nella Knowledge (InfluxDB).

Chi lo usa: **Analyzer** (in diretta via MQTT), **Planner** (storico da InfluxDB), **Grafana** e la futura **vista 3D**.

---

## 2. Decisioni prese

| # | Data | Decisione | Motivo |
|---|------|-----------|--------|
| D0 | 2026-09-26 | Schema dati corretto: in InfluxDB campo unico `value`, unità come tag, tempo del punto = timestamp del sensore, ID sensore stabili, emergenze graduali | Il vecchio schema mescolava valori e coordinate e rendeva sbagliate le previsioni del Planner (commit `92a1bb9`) |
| D1 | 2026-09-30 | **Dominio: edifici dell'Aquila.** Si lascia la "Smart City" e si passa a uno Smart Building collocato all'Aquila (si tengono coordinate e mappa) | Coerente con la proposta concordata con il docente; ricicla mappa e dashboard |
| D2 | 2026-09-30 | **Scenario: complesso residenziale di 4 palazzi con un parco al centro.** I palazzi sono completamente smart (sensori interni); il parco ospita i sensori esterni comuni | Scenario leggibile e adatto alla futura vista 3D (4 palazzi e il verde al centro) |
| D3 | 2026-09-30 | **Il traffico conta solo come fonte di rumore.** Il sensore `traffic_speed` (velocità e ingorghi) viene eliminato; il traffico diventa rumore esterno che varia con l'ora del giorno | Negli edifici interessa l'impatto acustico, non la viabilità |
| D4 | 2026-09-30 | **L'unità monitorata è l'appartamento.** Ogni palazzo ha 4 piani con 2 appartamenti per piano (8 per palazzo, **32 in totale**), più il **vano scale** come parte comune. I numeri restano modificabili nel file del modello | Corrisponde all'architettura della proposta (manager del complesso più manager locali per zona); in 3D ogni appartamento è un blocco leggibile; carico contenuto (circa 300 sensori) |
| D5 | 2026-09-30 | **Elenco dei sensori della v2** (vedi sezione 4.1): 12 per appartamento, 4 per vano scale, fotovoltaico per palazzo, 10 nel parco. **Totale 414 sensori**, circa 41 messaggi al secondo con una misura ogni 10 s | Ogni sensore abilita una decisione del Planner, uno scenario d'emergenza o un KPI |
| D6 | 2026-09-30 | **Il parco diventa una risorsa gestita**: irrigazione comandata dall'umidità del terreno e dalla pioggia; illuminazione pubblica comandata dal sensore di luce (nessun sensore di presenza) | Aggiunge obiettivi di risparmio idrico ed energetico anche all'esterno |
| D7 | 2026-09-30 | **Elenco base degli attuatori** (vedi sezione 4.2): 7 per appartamento, 3 per vano scale, 2 nel parco. **Totale 238 attuatori**; ognuno pubblica il proprio stato e risponde ai comandi con un ack. Possibili aggiunte ancora in valutazione | Ogni attuatore risponde ad almeno un sensore della D5 |
| D8 | 2026-09-30 | **Attuatori aggiuntivi**: pannello avvisi per i residenti (per appartamento), ascensore e batteria di accumulo (per palazzo), segnaletica d'evacuazione verso il parco, colonnine di ricarica auto. **Totale 283 attuatori** | Coinvolgono i residenti, rendono più ricca l'ottimizzazione energetica con il fotovoltaico e danno al parco il ruolo di punto di raccolta dopo un sisma |
| D9 | 2026-09-30 | **Il complesso ha un parcheggio condominiale** con 4 colonnine di ricarica (una per palazzo) | Serve per le colonnine della D8; sarà visibile anche nella vista 3D |
| D10 | 2026-09-30 | **Orologio simulato separato.** Le misure mantengono il **tempo reale** (timestamp, InfluxDB, Grafana invariati); il modello fisico (giorno/notte, sole, temperatura esterna, orari di occupazione) segue un'**ora simulata** pubblicata su un proprio topic. Dalla UI si regolano la velocità (×1 … ×60) e il salto a un'ora precisa | In una demo di pochi minuti si vede l'intero ciclo della giornata senza rompere storico, grafici e finestre temporali di Analyzer e Planner |
| D11 | 2026-09-30 | **Scenari simulabili** (vedi sezione 4.3): 4 emergenze (incendio, fuga di gas, monossido, terremoto) e 4 situazioni di stress (ondata di calore, picco di inquinamento, picco di consumi, temporale). I vecchi scenari "Smart City" (alluvione, incidente stradale…) vengono eliminati | Coprono le tre priorità della proposta: sicurezza, comfort, energia |
| D12 | 2026-09-30 | **Scenari aggiuntivi**: guasto di un sensore, guasto di un attuatore, blackout della rete, emergenze concatenate, ondata di freddo, giornata di sole con surplus (sezione 4.3). **Totale 14 scenari**. Scartati per ora: festa, casa vuota, sciame sismico, siccità | Mettono alla prova il manager autonomo stesso (dati inaffidabili, attuatori guasti, risorse scarse, conflitti tra obiettivi) oltre all'edificio |
| D13 | 2026-09-30 | **Due servizi separati.** `simulator` = la **risorsa gestita** (complesso, fisica, sensori, attuatori, orologio, scenari, guasti); `monitor` = la **fase M del MAPE-K** (raccoglie, valida, rileva sensori guasti o spenti, calcola i valori derivati, salva nella Knowledge). Node-RED resta per Telegram e per la pagina di amministrazione | Separazione netta tra risorsa gestita e manager autonomo; il guasto di un sensore diventa un test vero (il simulatore mente, il Monitor se ne accorge); la vista 3D si collega al simulatore senza toccare il Monitor |
| D14 | 2026-09-30 | **Regola d'oro del contratto MQTT**: il manager (Analyzer, Planner) legge solo `Complex/monitored/…` e `Complex/health/…` e scrive solo `Complex/cmd/…`; può leggere anche `Complex/model` e `Complex/clock`. `Complex/raw`, `Complex/state` e `Complex/scenarios` gli sono vietati | Separazione netta tra risorsa gestita e manager; `Complex/scenarios` resta la verità di riferimento per misurare i KPI di rilevamento |
| D15 | 2026-09-30 | **La struttura del complesso non si modifica a runtime**: si cambia `config/complex.json` e si riavvia il simulatore. A runtime si cambiano solo orologio, scenari, guasti, soglie e policy | In un edificio reale palazzi e appartamenti non compaiono dal nulla; semplifica tutti i componenti |
| D16 | 2026-09-30 | **Riscaldamento con caldaia a gas, raffrescamento elettrico** (pompa di calore) | Dà senso al consumo di gas d'inverno e una causa fisica allo scenario del monossido |
| D17 | 2026-09-30 | **Principio di sicurezza del Monitor**: nel dubbio un dato si inoltra come `suspect`, non si scarta; il controllo di deriva si sospende se fumo, gas o CO confermano un'emergenza reale | Un'emergenza vera non deve mai essere scambiata per un guasto del sensore |
| D18 | 2026-09-30 | **Nuove measurement InfluxDB**: `readings`, `actuator_states`, `device_health` (scritte dal Monitor), `scenario_events` (scritta da Node-RED). La vecchia `sensors` si esaurisce con la retention | Dati v2 separati da quelli v1; la verità degli scenari salvata per i KPI |
| D19 | 2026-09-30 | **Al riavvio il simulatore riparte pulito**: ora reale, velocità ×1, nessuno scenario attivo | Evita che un'emergenza si riattivi da sola dopo un riavvio, come succede con la v1 |

---

## 3. Cosa fa oggi il Monitor (v1, ancora "Smart City")

> ⚠️ Questa è la versione attuale e funzionante, ma verrà sostituita dalla v2 (sezione 4). Usala per sviluppare, sapendo che topic e sensori cambieranno.

### Componenti
| Pezzo | File | Ruolo |
|-------|------|-------|
| Simulatore sensori | `sensors/main.py` | Genera le misure ogni 10 s e le pubblica su MQTT |
| Definizioni | `datastructure.py` | Formato del messaggio (`SensorData`), tipi di sensore, soglie di default, preset delle location |
| Persistenza | flow Node-RED "JSON Parser" (`nodered/data/flows.json`) | Scrive ogni misura in InfluxDB |

### Come si configura (a runtime, dalla UI http://localhost:8501)
All'avvio non esiste nessun sensore (`LOCATIONS = []`). La UI pubblica messaggi **retained**, che il broker riconsegna anche dopo un riavvio:

| Topic | Contenuto | Effetto sul Monitor |
|-------|-----------|---------------------|
| `City/update/locations` | `{"locations": [...], "location_coords": {...}}` | Crea o elimina i sensori per ogni location |
| `City/update/config` | `{"sensor_params": [...], "sensors_per_type": n}` | Cambia i tipi di sensore e quanti per tipo |
| `City/emergency` | `{"type", "location", "active", "effects": {tipo: valore}}` | Porta gradualmente i sensori di quella location verso i valori dell'emergenza |

Con `RESTORE_SESSION=false` i messaggi retained vengono ignorati.

### Cosa produce
**Topic MQTT:** `City/data/<location>/<tipo>`, per esempio `City/data/Piazza del Duomo/co2`

**Messaggio:**
```json
{"sensorid": "piazza_del_duomo-co2-1", "value": 812.4, "timestamp": 1790437626.9,
 "type": "co2", "unit": "ppm", "lat": 42.3498, "lon": 13.3996}
```
- `sensorid` è stabile: `<location in minuscolo>-<tipo>-<n>`
- `timestamp` è in secondi epoch (UTC)

**InfluxDB** (bucket `iot_bucket`), measurement `sensors`:
- tag: `sensorid`, `location`, `type`, `unit`
- campi: `value`, `lat`, `lon`
- tempo del punto: il `timestamp` del sensore

Esempio di query (ultimi 10 minuti di CO₂ in una location):
```flux
from(bucket: "iot_bucket")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "sensors" and r._field == "value")
  |> filter(fn: (r) => r.type == "co2" and r.location == "Piazza del Duomo")
```

### Sensori v1
temperatura (°C), umidità (%), CO₂ (ppm), velocità traffico (km/h), rumore (dB), sismico (Mw), pioggia (mm/h).
- **Valori normali:** variazione casuale con picchi occasionali (10% di probabilità).
- **Sismico:** modello a eventi (92% rumore di fondo, piccole probabilità di scosse).
- **Emergenza:** ogni ciclo il valore si avvicina del 20% all'obiettivo e rientra gradualmente quando finisce. Il terremoto invece è istantaneo.

### Limiti noti della v1
- ❌ I valori non reagiscono alle azioni degli attuatori: **il ciclo MAPE-K non è chiuso**.
- ❌ Lo stato degli attuatori non viene monitorato.
- ❌ Mancano la gerarchia edificio/piano e i sensori di occupazione, luce, fumo ed energia.
- ❌ Non si controlla la salute dei sensori (nessun heartbeat o Last Will, nessun guasto simulabile).

---

## 4. Obiettivo: Monitor v2 (complesso residenziale)

### Requisiti

| # | Requisito | Stato |
|---|-----------|-------|
| R1 | **Modello del complesso** (Knowledge statica): `config/complex.json` con palazzi, piani, appartamenti, vani scala, parco, parcheggio, adiacenze, dispositivi; espanso e pubblicato su `Complex/model`. Default: 4 palazzi × 4 piani × 2 appartamenti (D4), parcheggio con 4 colonnine (D9). Specifica §4–5 | ✅ |
| R2 | **Nuova gerarchia dei topic** `Complex/<livello>/<area>/<unità>/<dispositivo>` al posto di `City/…`. Specifica §7 | ✅ |
| R3 | **Sensori interni** (appartamenti, vani scala, palazzo): elenco in 4.1 (D5). Specifica §6.1, §8.3–8.4 | ✅ |
| R4 | **Sensori esterni nel parco**: elenco in 4.1 (D5). Specifica §6.1, §8.2 | ✅ |
| R5 | **Modello fisico** (segue l'ora simulata, D10): grandezze collegate tra loro (persone → CO₂, calore e rumore; esterno → interno; ciclo giorno/notte; occupazione con orari da residenza). Emergenze fisiche, per esempio fuoco che produce fumo e calore e si estende alle unità vicine. Specifica §8 | ✅ |
| R6 | **Stato degli attuatori pubblicato** come dato monitorato: elenco in 4.2 (D7, D8). Specifica §6.2, §7 | ✅ |
| R7 | **Ricezione dei comandi e risposta con ack**: il simulatore applica i comandi del Planner al modello fisico e **chiude il ciclo**. Deve poter simulare attuatori guasti (scenario `actuator_fault`). Specifica §7, §8.6 | ✅ |
| R8 | **Salute dei sensori** (nel servizio `monitor`): scarto dei valori impossibili; rilevamento di sensori bloccati, in deriva e spenti (timeout); Last Will per servizio (`simulator`, `monitor`); guasti iniettabili dalla UI. Specifica §10 | 📐 |
| R9 | **Adeguamento di chi consuma i dati**: flow Node-RED, Analyzer, Planner, Grafana, UI. Specifica §14 | 📐 |

### 4.1 Sensori della v2 (D5)

**Appartamento: 12 sensori × 32 appartamenti = 384**

| Tipo (`type`) | Unità | A cosa serve |
|---|---|---|
| `temperature` | °C | Comfort, HVAC, rischio incendio |
| `humidity` | % | Comfort, rischio incendio (aria secca) |
| `co2` | ppm | Qualità dell'aria, ventilazione |
| `noise_level` | dB | Comfort acustico, anomalie |
| `occupancy` | persone | Efficienza: non scaldare o illuminare case vuote |
| `light` | lux | Luci e tapparelle |
| `smoke` | % oscuramento | Rilevazione diretta dell'incendio |
| `gas` | % LEL (soglia di esplosività del metano) | Scenario fuga di gas |
| `co` | ppm | Monossido di carbonio (caldaia difettosa) |
| `power` | W | Consumo elettrico, KPI energetico |
| `water_flow` | L/min | Consumo d'acqua, KPI |
| `gas_flow` | m³/h | Consumo di gas, KPI |

**Vano scale: 4 sensori × 4 palazzi = 16**

`temperature`, `smoke`, `light`, `occupancy` (persone in transito). Servono a sapere se le scale sono sicure per l'evacuazione.

**Palazzo: 1 sensore × 4 palazzi = 4**

| Tipo | Unità | A cosa serve |
|---|---|---|
| `pv_power` | W | Produzione fotovoltaica sul tetto; usare il surplus (es. pre-raffrescare quando c'è sole) |

Il consumo totale del palazzo **non** è un sensore: è la somma dei `power` degli appartamenti, calcolata dall'Analyzer.

**Parco (stazione esterna comune): 10 sensori**

| Tipo | Unità | A cosa serve |
|---|---|---|
| `temperature` | °C | Temperatura esterna, dispersione termica degli edifici |
| `humidity` | % | Umidità esterna |
| `rain_level` | mm/h | Chiudere le finestre, sospendere l'irrigazione |
| `wind_speed` | km/h | Non aprire finestre e tapparelle con vento forte |
| `light` | lux | Luce naturale; accensione dell'illuminazione del parco |
| `noise_level` | dB | Rumore esterno, traffico compreso (D3) |
| `seismic` | Mw | Terremoto: colpisce tutto il complesso |
| `pm10` | µg/m³ | Non ventilare con aria esterna inquinata |
| `pm2_5` | µg/m³ | Come sopra, particolato fine |
| `soil_moisture` | % | Irrigazione del parco solo se il terreno è secco |

**Considerati e scartati (D5):** pressione atmosferica, accelerometro strutturale per palazzo, stato di porte tagliafuoco e ascensore, sensore di allagamento, presenza di persone nel parco. Si possono riprendere in futuro come estensioni.

### 4.2 Attuatori della v2 (D7, D8)

Formato dei comandi: la colonna "Comandi / stato" riporta le chiavi JSON da usare in `Complex/cmd/…`. Valori di default, consumi e carichi essenziali sono nella [specifica, §6.2](superpowers/specs/2026-09-30-monitor-v2-design.md#62-attuatori).

Ogni attuatore **riceve comandi** dal Planner/Executor, **applica l'effetto** al modello fisico, **risponde con un ack** e **pubblica il proprio stato** (che fa parte del monitoraggio).

**Appartamento: 8 attuatori × 32 = 256**

| Attuatore | Comandi / stato | Reagisce a |
|---|---|---|
| `hvac` | `mode`: `off`/`heat`/`cool`; `setpoint`: 16–30 °C (`heat` usa la caldaia a gas, D16) | temperatura, occupazione, fotovoltaico |
| `ventilation` (VMC) | `level`: 0–3 | CO₂, CO, PM esterno, fumo |
| `window` | `position`: `open`/`closed` | CO₂, gas, pioggia, vento, PM, rumore |
| `blinds` (tapparelle) | `position`: 0–100 (% aperte) | luce, temperatura (schermare il sole) |
| `lights` | `level`: 0–100 | luce, occupazione |
| `gas_valve` | `position`: `open`/`closed` | gas, CO, incendio |
| `alarm` | `siren`: `on`/`off` | fumo, gas, CO |
| `resident_display` (D8) | `message` + `level`: `info`/`warning`/`danger`, oppure `clear` | tutti: avvisi ai residenti ("apri la finestra", "evacuare dalle scale") |

**Vano scale: 3 attuatori × 4 = 12**

| Attuatore | Comandi / stato | Reagisce a |
|---|---|---|
| `stair_lights` | `mode`: `off`/`normal`/`evacuation` | luce, persone in transito, emergenze |
| `smoke_vent` (evacuatore di fumo) | `position`: `open`/`closed` | fumo nelle scale |
| `evacuation_siren` | `siren`: `on`/`off` | emergenze del palazzo, sisma |

**Palazzo: 2 attuatori × 4 = 8** (D8)

| Attuatore | Comandi / stato | Reagisce a |
|---|---|---|
| `elevator` | `mode`: `normal`/`recall` (torna al piano terra e si blocca) | incendio, sisma |
| `battery` (accumulo condominiale) | `mode`: `charge`/`discharge`/`idle`; stato pubblicato: `soc_pct`, `power_w` | `pv_power`, consumi del palazzo |

**Parco: 3 attuatori**

| Attuatore | Comandi / stato | Reagisce a |
|---|---|---|
| `irrigation` | `state`: `on`/`off` | umidità del terreno, pioggia |
| `park_lights` | `state`: `on`/`off` | luce |
| `evacuation_signs` (D8) | `state`: `on`/`off`: segnaletica luminosa che guida al parco come punto di raccolta | sisma, emergenze |

**Parcheggio: 4 colonnine** (D8, D9)

| Attuatore | Comandi / stato | Reagisce a |
|---|---|---|
| `ev_charger` | `mode`: `charge`/`pause`; `max_power_w`; stato pubblicato: `car_connected`, `power_w`, `energy_needed_kwh` | `pv_power`, batteria, consumi del palazzo |

### 4.3 Scenari simulabili (D11)

Uno scenario è una **variazione dei parametri del modello fisico** avviata dalla UI (sostituisce l'attuale `City/emergency`). Il Monitor ne simula gli effetti fisici; **non** decide le contromisure, che spettano a Analyzer e Planner. La colonna "reazione attesa" serve per verificare il Planner.

**Emergenze (sicurezza)**

| Scenario | Effetto nel modello | Reazione attesa |
|---|---|---|
| `fire` — incendio in un appartamento | Salgono calore, fumo, CO e CO₂; si estende agli appartamenti adiacenti e il fumo entra nel vano scale | Sirena, gas chiuso, VMC spenta, evacuatore di fumo aperto, ascensore a terra, segnaletica verso il parco, avvisi sui pannelli |
| `gas_leak` — fuga di gas | Il metano (% LEL) sale nell'appartamento | Valvola gas chiusa, finestre aperte, allarme, avviso |
| `co_poisoning` — monossido da caldaia | Il CO sale lentamente | Gas chiuso, VMC al massimo, finestre aperte, allarme |
| `earthquake` — terremoto | Evento sismico nel parco, coinvolge tutti i palazzi | Gas chiuso ovunque, ascensori a terra, sirene, evacuazione verso il parco |

**Situazioni di stress (comfort ed energia)**

| Scenario | Effetto nel modello | Reazione attesa |
|---|---|---|
| `heatwave` — ondata di calore | Temperatura esterna molto alta per più giorni simulati | Tapparelle giù di giorno, clima nelle ore di sole, batteria per la sera |
| `pollution` — picco di inquinamento | PM10 e PM2.5 alti all'esterno | Finestre chiuse, VMC senza aria esterna, avviso ai residenti |
| `power_peak` — picco di consumi | Tutti in casa la sera, consumi alti | Carichi coperti dalla batteria, colonnine in pausa |
| `storm` — temporale | Pioggia e vento forti | Finestre chiuse, irrigazione sospesa, tapparelle protette |

**Guasti e robustezza del manager (D12)**

| Scenario | Effetto nel modello | Reazione attesa |
|---|---|---|
| `sensor_fault` — guasto di un sensore | Un sensore scelto va in deriva, resta bloccato su un valore o smette di pubblicare | Il Monitor segnala il sensore come non affidabile o offline (R8); il Planner non agisce su quel dato |
| `actuator_fault` — guasto di un attuatore | Un attuatore non risponde (nessun ack) oppure conferma ma non produce effetto | L'Executor ritenta; il Planner, vedendo che la misura non cambia, sceglie un'alternativa (es. finestre invece dell'HVAC) |
| `blackout` — blackout della rete | Manca la corrente esterna; resta solo la batteria | Solo i servizi essenziali restano alimentati (luci scale, sirene, ascensore); gli altri carichi si spengono |
| `cascade` — emergenze concatenate | Il terremoto provoca una fuga di gas e poi un incendio, anche in palazzi diversi | Il manager del complesso risolve i conflitti (es. finestre aperte per il gas o chiuse per il fumo) secondo le priorità |

**Altre situazioni (D12)**

| Scenario | Effetto nel modello | Reazione attesa |
|---|---|---|
| `cold_wave` — ondata di freddo | Temperatura esterna sotto zero per più giorni simulati | Riscaldamento, gestione dei consumi di gas, irrigazione bloccata per il gelo |
| `solar_surplus` — giornata di sole con surplus | Fotovoltaico al massimo, consumi bassi | Ricarica della batteria e delle auto |

### 4.4 Piano di migrazione (tappe)

Durante le tappe 1–3 la v1 (`City/…`) **continua a funzionare in parallelo**: si può lavorare su Analyzer e Planner senza aspettare.

| Tappa | Contenuto | Requisiti | Risultato verificabile | Stato |
|---|---|---|---|---|
| 1 | `simulator` base: `complex.json`, modello, orologio, esterno, fisica, persone, sensori `raw` | R1–R5 | 414 sensori pubblicano su `Complex/raw/#` con valori plausibili | ✅ |
| 2 | Attuatori, comandi/ack/stato, scenari, guasti | R6, R7 | Un comando manuale via MQTT cambia la fisica: **ciclo chiuso** | ✅ |
| 3 | Servizio `monitor`: validazione, salute, derivati, InfluxDB | R8 | Un guasto iniettato compare su `Complex/health`; dati in `readings` | ⬜ |
| 4 | Adeguamento di Analyzer, Planner/Executor, Node-RED, UI, Grafana; rimozione di `sensors/` e `City/…` | R9 | Lo stack completo funziona solo su `Complex/…` | ⬜ |
| 5 | Aggiornamento di questo file e del README | — | Documentazione allineata | ⬜ |

### 4.5 Design v2 in breve

**Due servizi (D13):**
- `simulator/` è **la risorsa gestita**: il complesso con fisica, persone, sensori e attuatori. Pubblica le misure grezze e lo stato degli attuatori, esegue i comandi e risponde con l'ack.
- `monitor/` è **la fase M del MAPE-K**: valida le misure, rileva sensori guasti, calcola consumi, bilancio energetico e persone presenti, pubblica i dati puliti e li salva in InfluxDB.

**Regola d'oro (D14):** Analyzer e Planner leggono solo `Complex/monitored/…` e `Complex/health/…`, e scrivono solo `Complex/cmd/…`.

**Topic principali** (formato `Complex/<livello>/<area>/<unità>/<dispositivo>`, per esempio `Complex/monitored/A/A-2-1/co2`):

| Topic | Chi lo usa |
|---|---|
| `Complex/monitored/…` | **Analyzer e Planner**: misure validate (`quality`: `ok`/`suspect`), stati degli attuatori, valori derivati (`power_total`, `energy_balance`, `occupancy_total` per palazzo e complesso) |
| `Complex/health/…` | Analyzer, Grafana: salute dei dispositivi (`ok`, `stuck`, `drift`, `offline`, `out_of_range`) |
| `Complex/cmd/…` → `Complex/ack/…` | Executor: comandi agli attuatori e relativo esito (`ok`/`rejected`) |
| `Complex/model`, `Complex/clock` | Tutti: struttura del complesso e ora simulata |
| `Complex/control/clock`, `Complex/control/scenario` | UI: velocità dell'orologio, avvio e arresto di scenari e guasti |
| `Complex/raw/…`, `Complex/state/…`, `Complex/scenarios` | Solo `monitor`, UI, Node-RED e vista 3D (**vietati** ad Analyzer e Planner) |

**InfluxDB (D18):** `readings` (misure validate e derivati), `actuator_states`, `device_health`, `scenario_events`.

La **vista 3D** è un sotto-progetto a parte, tracciato in [`docs/VISTA_3D.md`](VISTA_3D.md) (specifica: [`2026-09-30-vista-3d-design.md`](superpowers/specs/2026-09-30-vista-3d-design.md)). Non contiene logica di simulazione. Si collega al broker via WebSocket (porta 9001) con un utente dedicato `view`, protetto da ACL. Oltre a `raw`, `state`, `scenarios`, `clock` e `model` legge anche `Complex/ack/…` e `Complex/status/…`, e scrive solo su `Complex/cmd/…` (comandi manuali del pannello di debug, con `"issued_by": "debug"`) e su `Complex/control/clock`. Nella fase 1 della vista i campi `layout` dei palazzi passano a 26 m di larghezza e 3,2 m per piano; li usa solo la vista.

### 4.6 Come avviare e provare il simulatore

Il simulatore usa solo il broker: per provarlo bastano `mosquitto` e `simulator` (Node-RED non serve e non va avviato, così non partono messaggi Telegram).

```bash
docker compose up -d --build mosquitto simulator
uv run --no-project --python 3.11 --with 'paho-mqtt>=2,<3' python scripts/e2e_simulator.py
```

Lo script verifica 8 punti (simulatore `online`, 414 sensori su `Complex/raw/#`, controllo dell'orologio, ack `ok` e `rejected`, guasto `no_ack`, incendio che produce fumo, pulizia finale) e termina con codice 0 se passano tutti.

Esempio di comando manuale: avviare un incendio nell'appartamento A-2-1.

```bash
docker exec iot_mosquitto mosquitto_pub -u admin -P adminpassword123 -t Complex/control/scenario -m '{"action":"start","scenario":"fire","target":"A-2-1"}'
```

Altri esempi: `{"speed": 60}` su `Complex/control/clock` accelera l'orologio; `{"cmd_id": "c1", "command": {"position": "open"}}` su `Complex/cmd/A/A-2-1/window` apre la finestra e produce un ack su `Complex/ack/A/A-2-1/window`. I test automatici si lanciano dalla cartella `simulator/`:

```bash
uv run --no-project --python 3.11 --with-requirements requirements.txt --with pytest pytest -q
```

Scelte di dettaglio prese durante l'implementazione, dove la specifica non diceva nulla: nuvolosità 0 quando non piove; vento e intensità della pioggia ridisegnati ogni ora simulata; l'HVAC porta la stanza verso il set-point a 2 °C/h netti anche d'inverno e non lo supera mai; l'aria esterna porta dentro il suo vapore (umidità relativa ricalcolata alla temperatura interna, formula di Magnus); durante lo spegnimento di un incendio la temperatura dell'appartamento torna verso quella esterna con τ = 10 min; `jump_to` accetta solo anni 1900–2200; alla partenza l'ora simulata è quella locale dell'Aquila (fuso `Europe/Rome`); uno scenario resta elencato in `Complex/scenarios` finché non viene fermato, anche se il suo effetto è terminato (terremoto dopo `duration_s`, ondate dopo `days`); un comando con payload non JSON riceve un ack `rejected` con `cmd_id` nullo.

**Da sapere per le demo** (calibrazione della specifica, non modificata): con la VMC al livello 1 di default la CO₂ resta sotto i ~900 ppm, quindi la regola CO₂ → ventilazione scatta solo se prima la VMC viene spenta; lo scenario `co_poisoning` produce CO solo mentre la caldaia è accesa (riscaldamento o docce), quindi con il rate di default (30 ppm/h) è ben visibile solo d'inverno con il riscaldamento acceso, oppure passando un `rate` più alto.

---

## 5. Domande aperte

- ✅ ~~Periodo di campionamento~~: 10 s di default, modificabile in `complex.json` (`sampling_period_s`)
- ❓ Posizione del complesso sulla mappa dell'Aquila (coordinate)
- ✅ ~~Revisione della specifica scritta~~: approvata il 2026-09-30
- ✅ ~~Revisione del piano di implementazione delle tappe 1–2~~ ([`docs/superpowers/plans/2026-09-30-simulator.md`](superpowers/plans/2026-09-30-simulator.md)): approvato ed eseguito. I piani per la tappa 3 (monitor) e le tappe 4–5 (adeguamento) verranno scritti dopo

---

## 6. Storico modifiche

| Data | Modifica |
|------|----------|
| 2026-09-26 | Corretti 5 bug del Monitor v1 (schema InfluxDB, timestamp, ID stabili, emergenze graduali). Adeguate di conseguenza le query Grafana e il planner; corretto il crash di Node-RED sugli alert JSON |
| 2026-09-30 | Creato questo documento; decisioni D1–D13 |
| 2026-09-30 | Design di dettaglio approvato in 6 sezioni (decisioni D14–D19); scritta la specifica tecnica; aggiunta la guida "Dove trovare cosa", il piano delle tappe e il riepilogo del design |
| 2026-09-30 | Specifica approvata; scritto il piano di implementazione del simulatore (tappe 1–2, 12 task) |
| 2026-09-30 | Tappe 1–2 completate: simulatore del complesso con ciclo chiuso (comandi, ack, scenari, guasti) |
| 2026-09-30 | Progettata la vista 3D (fase 1): contratto di accesso della vista al broker annotato nella 4.5; stato in `docs/VISTA_3D.md` |
