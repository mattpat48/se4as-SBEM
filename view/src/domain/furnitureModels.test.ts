import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FURNITURE } from './furniture';
import { FURNITURE_MODEL_FILES, furnitureModelUrl, modelPieces } from './furnitureModels';
import { KITCHEN } from './plan';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

test('every furniture item except the procedural boiler has at least one model piece', () => {
  for (const f of FURNITURE) {
    if (f.kind === 'boiler') expect(modelPieces(f), f.id).toEqual([]);
    else expect(modelPieces(f).length, f.id).toBeGreaterThan(0);
  }
});

test('pieces stay inside the footprint of their furniture item', () => {
  for (const f of FURNITURE) for (const p of modelPieces(f)) {
    expect(p.u0 >= f.u0 - 1e-9 && p.u1 <= f.u1 + 1e-9 && p.v0 >= f.v0 - 1e-9 && p.v1 <= f.v1 + 1e-9, `${f.id}/${p.model}`).toBe(true);
    expect(p.u1 > p.u0 && p.v1 > p.v0, `${f.id}/${p.model}`).toBe(true);
  }
});

test('the kitchen is five pieces along KITCHEN, fronts towards +u, filling the counter', () => {
  const pieces = modelPieces(FURNITURE.find((f) => f.kind === 'kitchen')!);
  expect(pieces.map((p) => p.model)).toEqual(['kitchenFridge', 'kitchenCabinetDrawer', 'kitchenStove', 'kitchenCabinet', 'kitchenSink']);
  expect(pieces.every((p) => p.face === '+u' && p.u0 === KITCHEN.u0 && p.u1 === KITCHEN.u1)).toBe(true);
  expect(pieces[0].v0).toBe(KITCHEN.v0);
  expect(pieces.at(-1)!.v1).toBe(KITCHEN.v1);
  pieces.slice(1).forEach((p, i) => expect(p.v0).toBeCloseTo(pieces[i].v1));
});

test('the television stands on the TV cabinet', () => {
  const pieces = modelPieces(FURNITURE.find((f) => f.kind === 'tv')!);
  expect(pieces.map((p) => [p.model, p.stacked ?? false])).toEqual([['cabinetTelevision', false], ['televisionModern', true]]);
});

test('every referenced model file exists in public/models', () => {
  const used = new Set(FURNITURE.flatMap((f) => modelPieces(f).map((p) => p.model)));
  expect([...used].sort()).toEqual([...FURNITURE_MODEL_FILES].sort());
  for (const m of FURNITURE_MODEL_FILES) {
    expect(furnitureModelUrl(m)).toBe(`/models/furniture/${m}.glb`);
    expect(existsSync(`${PUBLIC}${furnitureModelUrl(m)}`), m).toBe(true);
  }
});
