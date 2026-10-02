# Specifica — Prima persona in un mondo continuo (decisione V21)

| | |
|---|---|
| **Stato** | Sezione 1 (architettura) approvata il 2026-10-02; l'utente ha chiesto di procedere direttamente all'implementazione. Le sezioni 2–5 e le proposte segnate con **(A)** sono state **decise in autonomia** e vanno riviste. **Implementata il 2026-10-02** (verifica in `docs/VISTA_3D.md` §3.2) |
| **Documento di stato** | [`docs/VISTA_3D.md`](../../VISTA_3D.md), decisione V21 |
| **Dipende da** | [Specifica della vista 3D](2026-09-30-vista-3d-design.md): §7.1 (coordinate), §7.2 (pianta, muri, arredi), §7.3 (dispositivi), §7.5 (persone), §8 (interfaccia), §9 (errori), §10 (prestazioni) |
| **Piano** | [`docs/superpowers/plans/2026-10-02-prima-persona-mondo-continuo.md`](../plans/2026-10-02-prima-persona-mondo-continuo.md) |

---

## 1. Obiettivo

Oggi la prima persona mostra **un solo appartamento chiuso**, con la porta d'ingresso sbarrata, il parco e il terreno. Con V21 diventa un **mondo continuo**:
- si esce sul balcone (al piano terra, sul patio);
- si aprono e chiudono tutte le porte;
- si scende e si sale per le scale;
- si attraversa l'androne e il parco;
- si entra in un altro palazzo;
- oppure ci si sposta subito altrove con un comando.

Resta **solo scenografia della vista**: porte, scale e camminata non pubblicano nulla su MQTT e non toccano il simulatore (V0, V10).

### 1.1 Decisioni già prese con l'utente
1. Si esce sul **balcone dal soggiorno** (al piano terra è un patio).
2. **Tutte le porte hanno l'anta**: 5 porte interne per appartamento, porta d'ingresso, portafinestra, portoni dell'androne. Si aprono e chiudono con **E** o con un **clic**, con un'animazione. Una porta chiusa blocca il passaggio. Non sono dispositivi MQTT.
3. Si cambia palazzo **a piedi** e con un **comando** nel pannello della prima persona (palazzo, piano, interno).
4. **Approccio B**: è aperto e percorribile **solo il palazzo in cui ti trovi** (tutti i piani, entrambi gli interni, pianerottoli e scale). Gli altri restano volumi pieni. All'aperto sono tutti pieni. Il palazzo si apre quando passi il suo portone.
5. **Camminata più veloce**, e con Shift ancora di più.

### 1.2 Decisioni prese in autonomia (A), da rivedere
| # | Decisione |
|---|---|
| A1 | **Scala a due rampe** con pianerottolo intermedio, nello stesso rettangolo `STAIRS`: 2 × 9 gradini di `floor_height_m / 18` (17,8 cm), pedata 0,28 m. Usata anche nello spaccato 3D e in 2D |
| A2 | **Velocità** 3 m/s, con Shift 6 m/s |
| A3 | **Niente ascensore percorribile**: il vano ascensore è un ostacolo e si usano solo le scale |
| A4 | **Ostacoli all'aperto**: palazzi (con i patii), tronchi degli alberi, fontana, colonnine, pali di lampioni, stazione meteo e cartelli. Lo zoccolo di 0,6 m davanti al portone del parco si supera con **tre gradini** (rampa invisibile nelle collisioni) |
| A5 | **Il portone verso la strada resta chiuso a chiave.** Si apre solo quello verso il parco. Motivo: il vano scale occupa tutto il lato strada del nucleo (`v` 0,5–4,5), quindi dietro quel portone c'è la rampa. Premendo E compare "Portone chiuso: si entra dal parco" |
| A6 | **La posizione corrente segue dove sei** (appartamento, balcone, vano scale, esterno) e aggiorna il pannello. Dispositivi, arredi e residenti si vedono in **tutti** gli appartamenti del palazzo aperto, sempre con al massimo 80 residenti |
| A7 | **Portafinestra di 5,4 m** (`u` 0,6–6,0): la campata `u` 3,2–4,1 diventa una **porta a battente** (scenografia). Le due parti restanti (0,6–3,2 e 4,1–6,0) sono le ante dell'attuatore `window`. La **tapparella** (`blinds`) copre anche la porta: se è abbassata oltre il 20 % la porta non si attraversa ("Tapparella abbassata") |
| A8 | **Minimappa in prima persona**: uno schema SVG dall'alto (palazzi, parco, parcheggio, freccia del camminatore), non un secondo rendering. **Mappa di calore** come oggi: spenta all'ingresso, `H` la riaccende, all'uscita torna com'era |
| A9 | **Porte all'avvio**: le porte interne sono aperte; ingresso, portafinestra e portoni sono chiusi. Lo stato resta per tutta la visita e si azzera all'uscita |

---

## 2. Architettura

### 2.1 Una sola scena
In prima persona non si usa più `ApartmentInterior` (eliminato). Si disegna lo stesso `Complex` della vista 3D:
- **palazzo aperto** (`scene/OpenBuilding.tsx`): tutti i piani come interni. Comprende:
  - **per gli appartamenti:** pavimento in legno, muri interi (`InteriorWalls`), soffitto;
  - **per il nucleo:** solaio forato sopra le scale, muri del nucleo con la finestra delle scale, scala a due rampe, vano ascensore;
  - **all'esterno:** balconi o patii, fascia di 0,3 m tra i piani sulla facciata, tetto, pensilina, gradini e porte;
- **altri palazzi**: il `Building` pieno di oggi. In prima persona il filtro per piano e quello per palazzo non contano;
- **esterno**: strade, parco, parcheggio, auto, dispositivi del parco, emergenze. La **pioggia** si vede solo quando sei all'aperto o sul balcone. Le etichette V11 e la minimappa a rendering restano nascoste.

### 2.2 Stato (`store/walk.ts`)
| Campo | Significato |
|---|---|
| `active` | prima persona attiva |
| `openBuilding` | palazzo aperto, oppure `null` (all'aperto con tutti i portoni chiusi) |
| `place` | dove sei: `{kind:'apartment'|'balcony', unitId}`, `{kind:'stairwell', unitId, floor}` oppure `{kind:'outdoor'}` |
| `doors` | stato delle porte toccate (id → aperta); le altre hanno il default (A9) |
| `notice` | messaggio breve per il pannello (porta chiusa a chiave, tapparella, porta occupata) |
| `heatBefore` | mappa di calore prima dell'ingresso, ripristinata all'uscita |

Le azioni sono `start(aptId)`, `exit()`, `toggleDoor(id)`, `setPlace(place)` e `dismissNotice()`. `ui.firstPersonUnit`, `enterApartment` ed `exitApartment` vengono tolti.

Il **camminatore** (`walker`: `x`, `z`, `feet`, `yaw`, `pitch`) è un oggetto mutabile fuori da React, come `walkInput`, letto e scritto in `useFrame`. È in **coordinate del mondo**. I moduli di dominio lo portano nella pianta di ogni palazzo con la stessa trasformazione di `worldToPlan`.

### 2.3 Quale palazzo è aperto
Regola pura `nextOpenBuilding` in `domain/doors.ts`:
- se apri il **portone del parco** di un palazzo diverso da quello aperto, quel palazzo diventa aperto e il portone del precedente si chiude;
- se chiudi il portone del palazzo aperto **mentre sei all'aperto**, nessun palazzo resta aperto;
- `start(aptId)` (ingresso o comando di salto) apre il palazzo dell'appartamento.

Il cambio avviene mentre l'anta si apre (0,6 s), non a metà passo.

---

## 3. Livelli e collisioni (moduli puri, `domain/`)

### 3.1 Scala a due rampe (`domain/stairs.ts`)
- Rettangolo `STAIRS` (`u` 11–15, `v` 0,5–4,5). Alzata `fh/18`, pedata 0,28 m.
- **Rampa di salita** sulla metà `u` 13,05–15: dal pianerottolo (`v` = 4,5) verso `v` = 1,98, con 9 gradini.
- **Pianerottolo intermedio**: `u` 11–15, `v` 0,5–1,98, a metà piano.
- **Rampa di arrivo** sulla metà `u` 11–12,95: da `v` = 1,98 a 4,5, con 9 gradini, fino al pianerottolo del piano sopra.
- Divisorio di 0,1 m in `u` 12,95–13,05, da `v` 1,98 a 4,5.
- Quote delle pedate: `0,1 + k · fh/18` sopra il piano (0,1 m è la soletta del nucleo), con k da 1 a 18.
- `stairSteps(fh)` restituisce i 19 rettangoli (18 gradini più il pianerottolo) con la loro quota. `stairTread(u, v, fh)` dà la quota sotto un punto di pianta. La rampa di un piano esiste per i piani da 0 a `floors − 2`.
- Al piano terra la metà di arrivo è un **sottoscala chiuso**. All'ultimo piano la metà di salita ha una **ringhiera** (niente accesso al tetto).

### 3.2 Il mondo percorribile (`domain/walkWorld.ts`)
Il mondo è fatto di **superfici** (rettangoli orizzontali o rampe, con quota) e **ostacoli** (scatole con un intervallo di quote, oppure cerchi).

- **Palazzo aperto**, per ogni piano, in metri di pianta:
  - **superfici:**
    - pavimenti dei due interni a +0,12 m;
    - nucleo a +0,1 m, **escluso** il rettangolo delle scale;
    - balconi e patii alla quota del piano;
    - gradini e pianerottoli intermedi;
  - **ostacoli:**
    - muri interni dei due interni (allargati di 0,1 m come oggi);
    - perimetro degli appartamenti, con i soli varchi di porte e porta-balcone (le finestre sono muro);
    - ringhiere dei balconi;
    - arredi (esclusi i tappeti);
    - muri del nucleo;
    - vano ascensore e divisorio della scala.
- **Palazzo pieno**: una scatola per l'impronta (26 × 12 m), più i due patii.
- **Esterno**:
  - **superfici:** terreno a quota 0 entro ±98 m, prato del parco a 0,2 m, **rampa di soglia** davanti al portone del parco (`u` 13,1–15,4, `v` 12–13,2, da 0,7 a 0 m), disegnata come tre gradini;
  - **ostacoli:** cerchi per tronchi (0,25 · scala), fontana (3,4 m), colonnine (0,3 m), pali (0,12 m), stazione meteo e cartelli.
- **Porte**: una porta chiusa (apertura < 0,6) è una scatola sul suo varco.

**Regole di movimento** (`domain/walk.ts`):
- Il camminatore è un cerchio di 0,18 m.
- **Altezza dei piedi**: la superficie **più alta** tra quelle sotto il centro che stanno entro ±0,4 m dai piedi. Così si salgono gradini e soglie, e non si cade da un balcone né in un vano.
- **Bloccato** se non c'è nessuna superficie in quella fascia, oppure se un ostacolo interseca il cerchio e la fascia del corpo, cioè da piedi + 0,4 a piedi + 1,7 m.
- Lo spostamento si fa a passi da 0,06 m, separando i due assi (scivolamento lungo i muri). Non si attraversa nessun muro neanche a 6 m/s con un fotogramma da 0,05 s.

### 3.3 Dove sei (`domain/whereabouts.ts`)
`locate(layout, openBuilding, walker)`:
- dentro l'impronta del palazzo aperto:
  - `u` < 10,5 → interno 1;
  - `u` > 15,5 → interno 2;
  - altrimenti vano scale;
- fuori dall'impronta, dentro un balcone (o patio) → balcone;
- altrimenti esterno.

Il **piano** si ricava dai piedi: `round((feet − 0,6 − 0,1) / fh)`, limitato ai piani esistenti. `placeLabel` dà il testo del pannello ("A-2-1", "Balcone di A-2-1", "Vano scale A · piano 2", "All'aperto").

---

## 4. Porte (`domain/doors.ts`, `scene/Doors.tsx`)

### 4.1 Catalogo
Coordinate di pianta dell'interno 1; l'interno 2 è ruotato di 180° come il resto della pianta (§7.2 della specifica della vista).

| id | Muro | Varco | Cardine | Si apre verso |
|---|---|---|---|---|
| `<apt>:living` | `v` = 6,5 | `u` 4,5–5,4 | 4,5 | soggiorno (+`v`) |
| `<apt>:bedroom` | `v` = 6,5 | `u` 8,0–8,9 | 8,9 | camera (+`v`) |
| `<apt>:bedroom2` | `v` = 4,5 | `u` 2,8–3,7 | 2,8 | camera 2 (−`v`) |
| `<apt>:bath` | `v` = 3 | `u` 4,8–5,7 | 4,8 | bagno (−`v`) |
| `<apt>:bath2` | `v` = 3 | `u` 7,5–8,4 | 7,5 | bagno 2 (−`v`) |
| `<apt>:entry` | `u` = 10,5 | `v` 4,6–5,6 | 4,6 | dentro casa (−`u`) |
| `<apt>:balcony` | `v` = 12 | `u` 3,2–4,1 | 3,2 | soggiorno (−`v`) |
| `<B>:park` | `v` = 12, piano terra | `u` 13,1–15,4, due ante | 13,1 e 15,4 | androne (−`v`) |
| `<B>:street` | `v` = 0, piano terra | `u` 13,1–15,4, due ante, **chiusa a chiave** | — | — |

Ogni palazzo ha quindi 58 porte. Un test controlla che nessuna anta aperta tocchi gli arredi.

### 4.2 Interazione e animazione
- **E**: apre o chiude la porta più vicina entro 1,6 m che sta davanti allo sguardo (entro 60°) e alla stessa quota.
- **Clic** su un'anta entro 3 m: stessa azione. Il clic sulle ante ha la precedenza sui dispositivi.
- **Animazione**: rotazione di 90° attorno al cardine in 0,6 s. Si passa quando l'apertura è almeno 0,6.
- **Non si chiude una porta occupata**: se il cerchio del camminatore tocca il varco, la porta resta aperta.
- **Porta chiusa a chiave**: non si muove e mostra il messaggio.
- **Porta-balcone**: con la tapparella abbassata oltre il 20 % si apre, ma non si passa.

---

## 5. Pannello, comando di salto e minimappa

- **Intestazione**: luogo corrente (`placeLabel`), interruttore dei nomi dei dispositivi e messaggio delle porte.
- **Comando "Vai a…"**: tre menu, Palazzo (solo palazzi con pianta tipo), Piano e Interno, più il pulsante **Vai**. Porta all'ingresso di quell'appartamento, nello stesso punto di oggi (soggiorno, `u` 4,8 `v` 10,5, sguardo verso l'interno), e apre il suo palazzo.
- **Comandi**: come oggi (trascinamento, WASD/frecce e pulsanti a schermo), più "E porte · Shift corre".
- I **nomi dei dispositivi** si vedono solo per l'appartamento in cui ti trovi (Html con `occlude`), per limitare gli elementi HTML.
- **Minimappa** (`ui/WalkMinimap.tsx`, in basso a sinistra, 200 × 200 px): palazzi (quello aperto evidenziato), parco, parcheggio e una freccia con la posizione e la direzione dello sguardo. La freccia si aggiorna con `requestAnimationFrame`, senza rendering di React.
- **Uscita** (`Esc` o "Esci dalla casa"): la vista 3D si centra sul palazzo in cui eri. `2`, `3` e i pulsanti 2D/3D escono dalla prima persona.

---

## 6. Resa nella scena
- **Muri**: `InteriorWalls` con il varco della porta d'ingresso e la campata della porta-balcone (montanti in legno a 3,2 e 4,1). Le geometrie unite sono **condivise** tra palazzi e piani (cache per altezza e varianti).
- **`WindowActuators`**: le ante della portafinestra coprono le due parti fuori dalla porta (`sashSpans` in `domain/doors.ts`). Nel palazzo aperto le ante si vedono sempre, e fanno da vetro.
- **Luci delle stanze**: un gruppo fisso di 6 `pointLight` (`RoomLightPool`), sempre presente in prima persona, si sposta nelle stanze dell'appartamento in cui sei stato per ultimo. Il numero di luci non cambia mai, quindi gli shader non si ricompilano. `InteriorActuators` non crea più luci proprie.
- **Ombre**: il sole segue il camminatore, con un'area d'ombra di 30 m.
- **Spaccato e 2D**: la scala a due rampe sostituisce la rampa simbolica. I residenti del vano scale stanno sulla rampa di salita (`stairSlots`, `stairTread`).
- **Patii**: hanno la stessa ringhiera dei balconi.

---

## 7. Gestione degli errori
| Situazione | Comportamento |
|---|---|
| Punto di partenza bloccato (modello con misure diverse) | Ricerca a spirale di un punto libero entro 3 m; se non c'è, si resta fermi dove si è (ancora nessun movimento possibile) e in console compare un avviso |
| Palazzo senza pianta tipo | Non si apre: il portone non si muove ("Palazzo non visitabile"), non compare nel comando "Vai a…" e all'aperto resta un volume pieno |
| Nuovo `Complex/model` | Uscita dalla prima persona (come oggi) |
| Valori non finiti nel movimento o `dt` enorme | Ignorati; `dt` limitato a 0,05 s |
| Finestra senza focus | Tasti rilasciati (come oggi) |
| Modello 3D esterno mancante | Sparisce solo il suo strato; le collisioni con gli arredi restano (usano gli ingombri) |

---

## 8. Prestazioni
- **Obiettivo**: ≥ 50 fps nel browser integrato, sia dentro il palazzo aperto sia all'aperto.
- Il palazzo aperto ha **8 interni**: lo stesso carico di arredi e dispositivi dello spaccato di oggi (8 interni nei 4 palazzi).
- Il **numero di luci è costante**: 6 lampade delle stanze, 6 lampioni, 4 luci del fuoco e il sole.
- **Collisioni**: circa 500 scatole e 70 cerchi per palazzo aperto, con 10 controlli per fotogramma: trascurabili.
- Il **cambio di palazzo** ricostruisce gli istanziati di arredi e residenti mentre si apre il portone. Le geometrie dei muri sono in cache.

---

## 9. Test
- **`stairs`**: alzata `fh/18`; quote di salita, pianerottolo intermedio e arrivo al piano sopra; 19 elementi.
- **`doors`**:
  - 58 porte per palazzo e interno 2 ruotato (ingresso in `u` = 15,5, `v` 6,4–7,4);
  - ante chiuse e aperte;
  - nessuna anta aperta tocca un arredo;
  - scelta della porta con E (davanti sì, dietro no, oltre 1,6 m no);
  - porta occupata che non si chiude;
  - portone chiuso a chiave;
  - `nextOpenBuilding`;
  - `sashSpans`.
- **`walkWorld` e `walk`**:
  - partenza libera in tutti i 32 appartamenti;
  - porte chiuse che bloccano e porte aperte che lasciano passare;
  - balcone raggiungibile, ringhiera che blocca, tapparella che blocca;
  - salita dal piano 2 al 3 e discesa dal piano 2 all'1;
  - sottoscala e accesso al tetto bloccati;
  - nessun attraversamento a 6 m/s;
  - palazzo pieno, tronco e fontana che bloccano;
  - soglia del portone superata;
  - **percorso completo** da A-2-1 a B-1-2 a piedi, con le porte aperte lungo il tragitto.
- **`whereabouts`**: appartamento, balcone, vano scale ed esterno; piano sulla scala.
- **Store `walk`**: ingresso, uscita con la mappa di calore ripristinata, cambio del palazzo aperto ai portoni, stato delle porte.
- **Verifica nel browser** (`docker compose up -d --build mosquitto simulator view` e `npm run dev`):
  - percorso a piedi tra due palazzi;
  - salto;
  - porte e balcone;
  - fps dentro e fuori;
  - spaccato con la nuova scala.
