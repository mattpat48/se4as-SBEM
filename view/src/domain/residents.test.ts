import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESIDENT_MODELS, residentClip, residentHeight, residentKey, residentModelUrl, residentVariant, residentYaw } from './residents';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
const keys = Array.from({ length: 400 }, (_, i) => residentKey(`A-${1 + (i % 5)}-${1 + (i % 2)}`, i % 12));

test('the variant is stable for an apartment and slot, and always a known model', () => {
  for (const k of keys) {
    expect(residentVariant(k)).toBe(residentVariant(k));
    expect(RESIDENT_MODELS[residentVariant(k)], k).toBeDefined();
  }
  expect(residentKey('A-2-1', 3)).toBe(residentKey('A-2-1', 3));
  expect(residentKey('A-2-1', 3)).not.toBe(residentKey('A-2-2', 3));
  expect(residentKey('A-2-1', 3)).not.toBe(residentKey('A-2-1', 4));
});

test('every variant is used, so the residents look varied', () => {
  expect(new Set(keys.map(residentVariant)).size).toBe(RESIDENT_MODELS.length);
});

test('heights are stable and between 1.60 and 1.80 m', () => {
  for (const k of keys) {
    expect(residentHeight(k)).toBe(residentHeight(k));
    expect(residentHeight(k)).toBeGreaterThanOrEqual(1.6);
    expect(residentHeight(k)).toBeLessThanOrEqual(1.8);
  }
  expect(new Set(keys.map(residentHeight)).size).toBeGreaterThan(10);
});

test('residents idle at home and walk in the stairwell', () => {
  for (const k of keys) {
    expect(['Idle', 'Idle_Neutral']).toContain(residentClip(k, 'home'));
    expect(residentClip(k, 'stairs')).toBe('Walk');
  }
  expect(new Set(keys.map((k) => residentClip(k, 'home'))).size).toBe(2);
});

test('every resident model file exists in public/models', () => {
  for (const m of RESIDENT_MODELS) {
    expect(residentModelUrl(m)).toBe(`/models/people/${m}.glb`);
    expect(existsSync(`${PUBLIC}${residentModelUrl(m)}`), m).toBe(true);
  }
});

test('residents at home face a stable, varied direction; on the stairs they climb towards lower v', () => {
  for (const k of keys) expect(residentYaw(k, 'home')).toBe(residentYaw(k, 'home'));
  expect(new Set(keys.map((k) => residentYaw(k, 'home').toFixed(3))).size).toBeGreaterThan(10);
  expect(residentYaw(keys[0], 'stairs')).toBeCloseTo(Math.PI);
});
