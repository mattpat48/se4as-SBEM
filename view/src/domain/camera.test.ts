import fixtureModel from '../test/fixtures/model.json';
import { CAMERA_LIMITS, MINIMAP_EXTENT_M, MINIMAP_SIZE_PX, focusOnBuilding, minimapToWorld } from './camera';
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
