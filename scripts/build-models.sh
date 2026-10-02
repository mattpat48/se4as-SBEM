#!/usr/bin/env bash
# Regenerates the 3D view assets (decision V20) from the original CC0 packs:
#   - furniture: Kenney Furniture Kit (GLBs copied as they are);
#   - residents: Quaternius Ultimate Modular Women / Males (glTF -> meshopt-compressed GLB,
#     keeping only the clips the view uses: Idle, Idle_Neutral, Walk).
# Everything is built in a temporary folder and replaces view/public/models only on success.
# Usage: scripts/build-models.sh   (needs curl, unzip, python3, npx)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/view/public/models"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
GLTF_TRANSFORM=(npx -y @gltf-transform/cli@4.5.1)

# Direct link from https://kenney.nl/assets/furniture-kit (it changes with new releases).
KENNEY_ZIP="https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip"
FURNITURE=(
  kitchenFridge kitchenCabinetDrawer kitchenStove kitchenCabinet kitchenSink
  loungeSofa tableCoffee table chairCushion cabinetTelevision televisionModern
  rugRectangle pottedPlant bedDouble bedSingle sideTableDrawers bookcaseClosedDoors
  desk chairDesk shower bathroomSink toilet coatRackStanding rugDoormat chair tableRound
)

# Google Drive file ids of the glTF characters, as "output-name:file-id".
PEOPLE=(
  woman-casual:18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh    # Women/Casual.gltf
  woman-formal:1iayBzVv_zLjuPtaNPouw_auwKlQLLmes    # Women/Formal.gltf
  woman-suit:1GjWtofxjmPku25cXJxHrzLLeUbXw7A_s      # Women/Suit.gltf
  woman-worker:1iwF_fqDErPH9uyol6NmS-MnzGgsZ5ejV    # Women/Worker.gltf
  man-casual:1Jn7kULNmrtqP8BUUL19h8MhbdOnwPFhv      # Men/Casual_2.gltf
  man-hoodie:1em1So1xwwQNfHJYMvzKcXkZllvtxpKP5      # Men/Casual_Hoodie.gltf
  man-suit:1NhXHnGU0zK9hBrT5FoZp8nTz_EmvTPg5        # Men/Suit.gltf
  man-worker:14d8n7IDnnlnGt_uiATnNg3uvi_4dyd9V      # Men/Worker.gltf
)
CLIPS="Idle,Idle_Neutral,Walk"

NEW="$WORK/models"
mkdir -p "$NEW/furniture" "$NEW/people"

echo "Kenney Furniture Kit…"
curl -fsSL "$KENNEY_ZIP" -o "$WORK/kenney.zip"
unzip -q "$WORK/kenney.zip" -d "$WORK/kenney"
for name in "${FURNITURE[@]}"; do
  cp "$WORK/kenney/Models/GLTF format/$name.glb" "$NEW/furniture/"
done

echo "Quaternius Ultimate Modular Women / Men…"
for entry in "${PEOPLE[@]}"; do
  name="${entry%%:*}" id="${entry#*:}"
  curl -fsSL "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t" -o "$WORK/$name.gltf"
  python3 - "$WORK/$name.gltf" "$CLIPS" <<'PY'
import json, sys
path, keep = sys.argv[1], set(sys.argv[2].split(','))
doc = json.load(open(path))
doc['animations'] = [a for a in doc['animations'] if a['name'] in keep]
missing = keep - {a['name'] for a in doc['animations']}
if missing: sys.exit(f'{path}: missing clips {sorted(missing)}')
json.dump(doc, open(path, 'w'))
PY
  "${GLTF_TRANSFORM[@]}" optimize "$WORK/$name.gltf" "$NEW/people/$name.glb" --compress meshopt \
    --simplify false --instance false --flatten false --join false --palette false >/dev/null
done

rm -rf "$OUT/furniture" "$OUT/people"
mv "$NEW/furniture" "$NEW/people" "$OUT/"
du -sh "$OUT/furniture" "$OUT/people"
ls -l "$OUT/people"
