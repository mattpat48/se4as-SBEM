# Prima persona in un mondo continuo (V21) — piano di implementazione

> **Per chi esegue:** esecuzione in linea (superpowers:executing-plans), senza sottoagenti. I passi usano le caselle (`- [ ]`). **Niente commit**: li fa l'utente.

**Obiettivo:** la prima persona diventa un mondo continuo: porte apribili, balcone, scala a due rampe, androne, parco, altri palazzi a piedi e comando di salto.

**Architettura:** moduli puri in `view/src/domain/` per scale, porte, mondo percorribile, movimento e posizione; uno store `walk` con il camminatore fuori da React. La scena riusa `Complex`, dove il palazzo aperto è disegnato da `OpenBuilding`.

**Tecnologia:** React Three Fiber, drei, zustand, TypeScript, vitest.

**Specifica:** [`docs/superpowers/specs/2026-10-02-prima-persona-mondo-continuo-design.md`](../specs/2026-10-02-prima-persona-mondo-continuo-design.md)

## Vincoli globali
- Identificatori e commenti in inglese; testi e documentazione in italiano.
- TDD: prima il test che fallisce, poi il codice.
- Si verifica con `cd view && npm test && npm run check`. Nel browser si usano `docker compose up -d --build mosquitto simulator view` e `npm run dev`. **Mai Node-RED.**
- Velocità 3 m/s, 6 m/s con Shift. Raggio del camminatore 0,18 m. Gradino massimo ±0,4 m. Fascia del corpo da piedi + 0,4 a piedi + 1,7 m.
- Porte: 0,6 s per aprirsi del tutto; si passa con apertura ≥ 0,6. E entro 1,6 m e 60°; clic entro 3 m.
- Al massimo 80 residenti; 6 luci delle stanze in un gruppo fisso.

## Punti critici per la revisione
1. Camminatore sulla soglia di una porta mentre la si chiude: la porta deve restare aperta (test in Task 2).
2. Passi lunghi (6 m/s, `dt` 0,05 s) contro muri sottili: nessun attraversamento (test in Task 4).
3. Discesa dalla scala al piano terra verso il sottoscala, e accesso al tetto dall'ultimo piano: entrambi bloccati (Task 4).
4. Portone del parco aperto da fuori mentre è aperto un altro palazzo: deve restare aperto un solo palazzo (Task 2 `nextOpenBuilding`, Task 6 store).
5. Interno 2 ruotato: porte, ante e partenza devono essere coerenti (Task 2 e 4, test sugli interni `-2`).

---

### Task 1: scala a due rampe
**File:** modifica `view/src/domain/stairs.ts`, `stairs.test.ts`, `domain/people.ts` (`stairSlots`), `people.test.ts`.
**Produce:**
- `FLIGHT_STEPS = 9`, `TREAD_M = 0.28`, `CORE_SLAB_M = 0.1`;
- `MID_LANDING: PlanRect` (`u` 11–15, `v` 0,5–1,98), `UP_HALF` (`u` 13,05–15), `DOWN_HALF` (`u` 11–12,95), `STAIR_DIVIDER` (`u` 12,95–13,05, `v` 1,98–4,5);
- `stairRise(fh)`;
- `stairSteps(fh): (PlanRect & { top: number })[]` (19 elementi);
- `stairTread(u, v, fh = 3.2): number`.

- [ ] Test:
  - `stairRise(3.2) ≈ 0.1778`;
  - primo gradino di salita a 0,1 + rise;
  - pianerottolo a 0,1 + 9 · rise;
  - ultimo gradino della rampa di arrivo a 0,1 + 3,2;
  - 19 elementi;
  - fuori dalle scale `stairTread` = 0;
  - `stairSlots` pari sulla rampa di salita (`u` 14, `v` 3,2).
- [ ] Implementa, poi esegui `npx vitest run src/domain/stairs src/domain/people`.

### Task 2: porte
**File:** crea `view/src/domain/doors.ts` e `doors.test.ts`.
**Produce:**
- `DoorSpec { id; building; floor; unitId; kind: 'interior'|'entry'|'balcony'|'portone'; axis: 'u'|'v'; at; a0; a1; leaves: 1|2; hinge: 'a0'|'a1'; swing: 1|-1; locked; defaultOpen }`;
- `buildingDoors(b, apartments): DoorSpec[]`;
- `BALCONY_DOOR = { u0: 3.2, u1: 4.1 }`;
- `sashSpans(w: PlanWindow): [number, number][]`;
- `doorLeaves(d, openness): { hu, hv, eu, ev }[]`;
- `doorBox(d): PlanRect`;
- `isPassable(openness)`;
- `pickDoor(doors, p: { u, v, floor }, yaw: number, maxDist = 1.6): DoorSpec | null` (`yaw` nel sistema della pianta);
- `canClose(d, p, r)`;
- `nextOpenBuilding(current, doorId, nowOpen, outdoors): string | null`;
- `DOOR_OPEN_S = 0.6`.

- [ ] Test:
  - 58 porte per palazzo;
  - ingresso di A-0-2 in `u` = 15,5, `v` 6,4–7,4;
  - anta chiusa lungo il muro e anta aperta perpendicolare;
  - nessuna anta aperta interseca gli arredi (esclusi i tappeti), nell'interno 1 e nell'interno 2;
  - `pickDoor`: davanti sì, dietro no, a 2 m no;
  - `canClose` falso con il camminatore nel varco;
  - `street` chiusa a chiave;
  - `nextOpenBuilding`: A aperto + apertura di `B:park` → B; chiusura di `A:park` all'aperto → null; dentro → A;
  - `sashSpans(portafinestra)` = [[0,6, 3,2], [4,1, 6,0]].
- [ ] Implementa; esegui i test.

### Task 3: mondo percorribile
**File:** crea `view/src/domain/walkWorld.ts` e `walkWorld.test.ts`; sposta `treeSpecs` da `scene/Park.tsx` a `domain/trees.ts`.
**Produce:**
- `Box { u0, u1, v0, v1, y0, y1 }`;
- `Surface { u0, u1, v0, v1, y0, y1?, along?: 'v' }` (rampa lungo `v`);
- `buildingWalk(b, open, floors): { boxes, surfaces }` (in pianta, quote assolute);
- `WalkWorld`;
- `buildWalkWorld(layout, openBuilding): WalkWorld`;
- `surfacesAt(world, x, z): number[]`;
- `blockedAt(world, x, z, feet, r, doorOpenness: (id) => number, blindsCover: (aptId) => number): boolean`.

- [ ] Test:
  - palazzo pieno blocca a quota 0;
  - tronco e fontana bloccano;
  - fuori da ±98 non ci sono superfici;
  - soglia del portone con quote da 0 a 0,7;
  - nel palazzo aperto superficie a 0,72 negli appartamenti del piano terra;
  - foro delle scale senza pavimento.
- [ ] Implementa; esegui i test.

### Task 4: movimento e posizione
**File:** riscrivi `view/src/domain/walk.ts` e `walk.test.ts`; crea `domain/whereabouts.ts` e `whereabouts.test.ts`.
**Produce:**
- `Walker { x, z, feet, yaw, pitch }`;
- `WALK_SPEED = 3`, `RUN_SPEED = 6`, `WALK_EYE_M`, `WALK_RADIUS_M`, `MAX_STEP_M = 0.4`;
- `startPose(layout, aptId): Walker | null`;
- `moveWalker(world, w, dx, dz, env): Walker` (`env` = funzioni di apertura e tapparella);
- `settle(world, w, env): Walker | null`;
- `chooseWalkApartment` (invariata);
- `Place`, `locate(layout, openBuilding, w): Place`, `placeLabel(p): string`, `samePlace(a, b)`.

- [ ] Test:
  - partenza libera in 32 appartamenti;
  - porta interna chiusa blocca, aperta lascia passare;
  - balcone raggiungibile dalla porta aperta; ringhiera blocca; tapparella abbassata blocca;
  - salita dal piano 2 al 3 e discesa dal 2 all'1 (piedi alle quote dei pianerottoli);
  - sottoscala e tetto bloccati;
  - 6 m/s contro un muro senza attraversarlo;
  - percorso A-2-1 → B-1-2 a waypoint, con le porte aperte;
  - `locate`: appartamento, balcone, vano scale (con il piano) ed esterno.
- [ ] Implementa; esegui i test.

### Task 5: store `walk`
**File:** crea `view/src/store/walk.ts` e `walk.test.ts`; modifica `store/ui.ts` (togli `firstPersonUnit`, `enterApartment`, `exitApartment`, `walkHeatBefore`) e `store/model.ts`.
**Produce:**
- `useWalkStore` con `active`, `openBuilding`, `place`, `doors`, `notice`, `heatBefore`, `lightsUnit`, e le azioni `start(aptId)`, `exit()`, `toggleDoor(id)`, `setPlace(p)`, `setNotice(t)`;
- `walker` (oggetto mutabile) e `doorOpenness` (mappa animata, aggiornata dalla scena).

- [ ] Test:
  - `start` apre il palazzo, spegne la mappa di calore, azzera piano e palazzo;
  - `exit` ripristina la mappa di calore e imposta `ui.building`;
  - `toggleDoor('B:park')` cambia il palazzo aperto;
  - `toggleDoor` di una porta chiusa a chiave → `notice`;
  - un nuovo modello fa uscire.
- [ ] Implementa; esegui tutti i test.

### Task 6: scena e interfaccia
**File:**
- crea `scene/OpenBuilding.tsx`, `scene/Doors.tsx`, `scene/StairFlights.tsx`, `ui/WalkMinimap.tsx`;
- modifica `Complex`, `Viewport`, `CameraRig`, `FirstPersonNavigation`, `InteriorWalls`, `domain/interior.ts`, `Floor`, `Building`, `Devices`, `ApartmentSensors`, `Furniture`, `People`, `Hazards`, `Lighting`, `Park`, `App`, `TopBar`, `DebugPanel`, `useShortcuts`, `WalkOverlay` e `styles`;
- elimina `ApartmentInterior.tsx`.

- [ ] `interiorShell(ceiling, { entryOpen, balconyDoor })` con test: montanti a 3,2 e 4,1 e nessun muro nella campata della porta-balcone.
- [ ] `npm run check`, `npm test` e `npm run build`.
- [ ] Verifica nel browser:
  - percorso a piedi tra due palazzi;
  - salto;
  - porte, balcone e scale;
  - spaccato con la nuova scala;
  - fps dentro e fuori (≥ 50).

### Task 7: documentazione
- [ ] `docs/VISTA_3D.md`: V21 implementata, storico, "Dove trovare cosa" e checklist 3.2.
- [ ] Specifica della vista §7.2 (scala a due rampe) e §15 (prima persona fatta).
