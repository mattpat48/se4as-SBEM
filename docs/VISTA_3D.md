# VISTA 3D — stato, decisioni e guida d'uso

Questo file traccia **cosa deve fare** la vista 3D del complesso residenziale, **quali decisioni** abbiamo preso e **a che punto siamo**. Si aggiorna a ogni decisione o implementazione. È la "Simulation Model" promessa nella sezione 10 della proposta ([`Smart Building Enviromental Manager.md`](Smart%20Building%20Enviromental%20Manager.md#10-simulation-model)).

**Legenda stato:** ✅ fatto · 🟡 in corso · 📐 progettato (nella specifica, da implementare) · ⬜ da fare · ❓ da decidere

**Specifica tecnica:** ⬜ non ancora scritta (sarà in `docs/superpowers/specs/`). Quando esisterà, se questo file e la specifica non coincidono, **vale la specifica**.

**Ultimo aggiornamento:** 2026-09-30

---

## 0. Dove trovare cosa (guida rapida)

> La vista 3D è in fase di **progettazione** (brainstorming): non c'è ancora codice. Le fonti di dati sotto esistono già perché le produce il simulatore.

| Cerco… | Dove si trova | Disponibile da |
|---|---|---|
| **Posizioni e dimensioni** di palazzi, parco e parcheggio (campi `layout`) | `config/complex.json`; formato nella [specifica Monitor v2, §5](superpowers/specs/2026-09-30-monitor-v2-design.md#5-il-modello-del-complesso-configcomplexjson) | ✅ Simulatore, tappa 1 |
| **Modello completo espanso** (32 appartamenti, vani scala, dispositivi, layout) | Topic MQTT retained `Complex/model` | ✅ Simulatore, tappa 1 |
| **Misure grezze** dei sensori | `Complex/raw/<area>/<unità>/<sensore>` ([specifica Monitor v2, §7](superpowers/specs/2026-09-30-monitor-v2-design.md#7-contratto-mqtt)) | ✅ Simulatore |
| **Stato degli attuatori** (finestre, tapparelle, luci, sirene…) | `Complex/state/<area>/<unità>/<attuatore>` (retained) | ✅ Simulatore |
| **Ora simulata** (giorno/notte) | `Complex/clock` (retained) | ✅ Simulatore |
| **Scenari attivi** | `Complex/scenarios` (retained) | ✅ Simulatore |
| Quali topic può leggere la vista (regola D14) | [MONITOR.md, decisione D14](MONITOR.md#2-decisioni-prese) | — |
| Codice della vista 3D | — | ⬜ |

---

## 1. Obiettivo

Mostrare **in tempo reale**, in un modello 3D del complesso dell'Aquila (4 palazzi intorno al parco, parcheggio con colonnine), come gli edifici **reagiscono alle condizioni ambientali** e come il **manager autonomo si adatta**. Serve soprattutto per la **demo all'esame**, che dura pochi minuti.

La vista è **solo una vista**: nessuna logica di simulazione al suo interno. Legge i dati dal simulatore via MQTT.

---

## 2. Decisioni prese

| # | Data | Decisione | Motivo |
|---|------|-----------|--------|
| V0 | 2026-09-30 | **Punti fermi di partenza**: la vista è separata dal simulatore e non simula nulla; legge da MQTT (`Complex/raw`, `state`, `scenarios`, `clock`, `model`, come consentito dalla D14); geometria generata dal codice a partire dai campi `layout` (nessun modello 3D esterno); stile iniziale "plastico architettonico" con appartamenti colorati come mappa di calore | Già stabilito prima della progettazione di dettaglio |

---

## 3. Domande aperte

- ❓ Cosa deve mostrare (grandezze, attuatori, persone, auto, parco, segnaletica) e cosa invece no
- ❓ Solo da guardare o anche da comandare (orologio, scenari, guasti)? Divisione del lavoro con la UI Streamlit
- ❓ Tecnologia (es. Three.js, React Three Fiber) e dove gira (container statico nello stack)
- ❓ Collegamento del browser a MQTT: listener WebSocket di Mosquitto (porta 9001 esposta ma non configurata) e credenziali (utente in sola lettura?)
- ❓ Prestazioni con 414 sensori e ~41 messaggi al secondo
- ❓ Come renderla efficace nei pochi minuti della demo

### Lacune emerse leggendo il simulatore (da valutare)

- Il simulatore **non pubblica** quante persone sono nel parco dopo un'evacuazione (il conteggio esiste solo internamente, `occupancy.in_park`). Dai sensori `occupancy` si sa quanti sono in casa, ma non si distingue chi è al lavoro da chi è evacuato.
- Le misure arrivano ogni **10 s reali**: con l'orologio a ×60 sono 10 minuti simulati tra un dato e l'altro, quindi senza interpolazione i colori cambierebbero a scatti.
- La UI Streamlit è ancora quella v1 ("Smart City"): oggi orologio e scenari del complesso si comandano solo con `mosquitto_pub`.

---

## 4. Storico modifiche

| Data | Modifica |
|------|----------|
| 2026-09-30 | Creato questo documento; avviata la progettazione |
