# Crediti dei modelli 3D

Tutti i modelli di questa cartella sono di pubblico dominio (**CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/): si possono usare, modificare e ridistribuire senza obbligo di attribuzione. Li citiamo comunque. Si rigenerano con `scripts/build-models.sh` (decisione V20 in `docs/VISTA_3D.md`).

## `furniture/`: arredi

- **Furniture Kit 2.0** di **Kenney** (www.kenney.nl), CC0.
- Fonte: https://kenney.nl/assets/furniture-kit (file `kenney_furniture-kit.zip`, cartella `Models/GLTF format`).
- I 26 file GLB sono copiati senza modifiche. La vista li adatta agli ingombri di `view/src/domain/furniture.ts` con una scala uniforme.

## `people/`: residenti

- **Ultimate Modular Women** (`woman-*.glb`) e **Ultimate Modular Males** (`man-*.glb`) di **Quaternius** (quaternius.com), CC0.
- Fonti: https://quaternius.com/packs/ultimatemodularwomen.html e https://quaternius.com/packs/ultimatemodularcharacters.html (cartelle Google Drive del pacchetto, file glTF dei singoli personaggi).
- Personaggi usati:

  | File | Personaggio originale |
  |---|---|
  | `woman-casual.glb` | Women / Casual |
  | `woman-formal.glb` | Women / Formal |
  | `woman-suit.glb` | Women / Suit |
  | `woman-worker.glb` | Women / Worker |
  | `man-casual.glb` | Males / Casual_2 |
  | `man-hoodie.glb` | Males / Casual_Hoodie |
  | `man-suit.glb` | Males / Suit |
  | `man-worker.glb` | Males / Worker |

- Modifiche: delle 24 animazioni restano solo `Idle`, `Idle_Neutral` e `Walk`. I file sono convertiti in GLB e compressi con meshopt tramite `@gltf-transform/cli` 4.5.1.
