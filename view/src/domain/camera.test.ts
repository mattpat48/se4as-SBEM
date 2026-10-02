import fixtureModel from '../test/fixtures/model.json';
import { CAMERA_LIMITS, MINIMAP_EXTENT_M, MINIMAP_SIZE_PX, focusOnBuilding, minimapMarker, minimapToWorld } from './camera';
import { buildComplexLayout } from './layout';
import type { ComplexModelMsg } from './messages';

const L = buildComplexLayout(fixtureModel as unknown as ComplexModelMsg);

test('focus on building A from the park side', () => {
  const A = L.buildings.find((b) => b.id === 'A')!;
  const f = focusOnBuilding(A);
  expect(f.target.x).toBeCloseTo(0); expect(f.target.y).toBeCloseTo(7.0); expect(f.target.z).toBeCloseTo(-45);
  expect(f.position.x).toBeCloseTo(0); expect(f.position.y).toBeCloseTo(47); expect(f.position.z).toBeCloseTo(15);
});

test('focus on building B looks from the west', () => {
  const f = focusOnBuilding(L.buildings.find((b) => b.id === 'B')!);
  expect(f.position.x).toBeCloseTo(50 - 60); expect(f.position.z).toBeCloseTo(0);
});

test('minimap to world, north up', () => {
  expect(minimapToWorld(0, 0, 200, 92)).toEqual({ x: -92, z: -92 });
  expect(minimapToWorld(100, 100, 200, 92)).toEqual({ x: 0, z: 0 });
  expect(minimapToWorld(200, 200, 200, 92)).toEqual({ x: 92, z: 92 });
  expect([MINIMAP_SIZE_PX, MINIMAP_EXTENT_M]).toEqual([200, 92]);
  expect(CAMERA_LIMITS).toEqual({ minDistance: 2, maxDistance: 350, maxPolarAngle: Math.PI * 0.47 });
});

test('the minimap dot marks the framed point; the wedge starts at the camera and points at it', () => {
  const m = minimapMarker({ x: 72, z: -63 }, { x: 0, z: 0 }, 0.3);
  expect(m.dot).toEqual({ x: 0, z: 0 });
  expect(m.wedge.x).toBe(72);
  expect(m.wedge.z).toBe(-63);
  expect(m.wedge.yaw).toBeCloseTo(Math.atan2(-72, 63));
});

test('straight above the framed point (2D) the wedge keeps the camera heading', () => {
  const m = minimapMarker({ x: 5, z: 5 }, { x: 5, z: 5 }, 1.2);
  expect(m.dot).toEqual({ x: 5, z: 5 });
  expect(m.wedge.yaw).toBe(1.2);
});
