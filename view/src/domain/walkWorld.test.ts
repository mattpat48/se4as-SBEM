import { buildComplexLayout, planToWorld } from './layout';
import type { ComplexModelMsg } from './messages';
import { treeSpecs, trunkRadius } from './trees';
import { blockedAt, buildWalkWorld, surfacesAt, type WalkEnv } from './walkWorld';
import model from '../test/fixtures/model.json';

const layout = buildComplexLayout(model as unknown as ComplexModelMsg);
const A = layout.buildings.find((b) => b.id === 'A')!;
const closedEnv: WalkEnv = { doorOpenness: () => 0, blindsCover: () => 0 };
const openEnv: WalkEnv = { doorOpenness: () => 1, blindsCover: () => 0 };
const at = (u: number, v: number, floor = 0) => planToWorld(A, u, v, 0, floor, false);

test('outdoors: solid buildings, tree trunks and the fountain block; the ground ends at ±98 m', () => {
  const world = buildWalkWorld(layout, null);
  expect(blockedAt(world, A.center.x, A.center.z, 0, 0.18, closedEnv)).toBe(true);
  const t = treeSpecs(layout)[0];
  expect(blockedAt(world, t.x + trunkRadius(t), t.z, 0.2, 0.18, closedEnv)).toBe(true);
  expect(blockedAt(world, layout.park.center.x + 3, layout.park.center.z, 0.2, 0.18, closedEnv)).toBe(true);
  expect(blockedAt(world, 1.5, -15, 0.2, 0.18, closedEnv)).toBe(false);
  expect(surfacesAt(world, 99, 0)).toEqual([]);
  expect(surfacesAt(world, 60, 60)).toEqual([0]);
  expect(surfacesAt(world, 1.5, -15)).toContain(0.2);
});

test('three steps (a hidden ramp) climb the 0.6 m plinth to the park portone', () => {
  const world = buildWalkWorld(layout, null);
  const out = at(14.25, 13.15), mid = at(14.25, 12.6), door = at(14.25, 12.01);
  expect(Math.max(...surfacesAt(world, out.x, out.z))).toBeLessThan(0.05);
  expect(Math.max(...surfacesAt(world, mid.x, mid.z))).toBeCloseTo(0.35, 1);
  expect(Math.max(...surfacesAt(world, door.x, door.z))).toBeCloseTo(0.7, 1);
});

test('the open building has floors, a stair well without a floor, and closable doors', () => {
  const world = buildWalkWorld(layout, 'A');
  const living = at(4.8, 10.5);
  expect(surfacesAt(world, living.x, living.z)).toContain(0.72);
  const well = at(12, 3);
  expect(surfacesAt(world, well.x, well.z)).not.toContain(0.7);
  const doorway = at(4.95, 6.5, 2);
  const feet = 0.6 + 2 * 3.2 + 0.12;
  expect(blockedAt(world, doorway.x, doorway.z, feet, 0.18, closedEnv)).toBe(true);
  expect(blockedAt(world, doorway.x, doorway.z, feet, 0.18, openEnv)).toBe(false);
  // The interno-2 entry door on the landing, rotated by 180°.
  const entry2 = at(15.5, 6.9, 2);
  expect(blockedAt(world, entry2.x, entry2.z, feet, 0.18, closedEnv)).toBe(true);
  expect(blockedAt(world, entry2.x, entry2.z, feet, 0.18, openEnv)).toBe(false);
});

test('a lowered blind blocks the balcony door even when it is open', () => {
  const world = buildWalkWorld(layout, 'A');
  const p = at(3.65, 12, 1);
  const feet = 0.6 + 3.2 + 0.12;
  expect(blockedAt(world, p.x, p.z, feet, 0.18, openEnv)).toBe(false);
  expect(blockedAt(world, p.x, p.z, feet, 0.18, { ...openEnv, blindsCover: () => 0.5 })).toBe(true);
});

test('the enlarged garden supports the walker, furniture blocks, and entrance ramps stay clear', () => {
  const world = buildWalkWorld(layout, null);
  expect(surfacesAt(world, 35, 32)).toContain(.2);
  // Long sides of the benches follow their rendered rotation, with space in front to pass.
  const bench = world.outdoorBoxes[0];
  expect(blockedAt(world, bench.x, bench.z, .2, .18, closedEnv)).toBe(true);
  const x=bench.x+Math.sin(bench.angle)*2,z=bench.z+Math.cos(bench.angle)*2;
  expect(blockedAt(world, x, z, .2, .18, closedEnv)).toBe(false);
  // The EV parking remains on ground level, outside the raised lawn.
  expect(surfacesAt(world, layout.parking.center.x, layout.parking.center.z)).toEqual([0]);
});
