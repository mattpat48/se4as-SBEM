import { buildComplexLayout, planToWorld, type BuildingGeom } from './layout';
import type { ComplexModelMsg } from './messages';
import { PLINTH_M } from './plan';
import {
  MAX_STEP_M, RUN_SPEED, WALK_SPEED, chooseWalkApartment, moveWalker, settle, standAt, startPose, type Walker,
} from './walk';
import { buildWalkWorld, type WalkEnv, type WalkWorld } from './walkWorld';
import { locate } from './whereabouts';
import model from '../test/fixtures/model.json';

const layout = buildComplexLayout(model as unknown as ComplexModelMsg);
const bld = (id: string) => layout.buildings.find((b) => b.id === id)!;
const A = bld('A'), B = bld('B');
const allOpen: WalkEnv = { doorOpenness: () => 1, blindsCover: () => 0 };
const allClosed: WalkEnv = { doorOpenness: () => 0, blindsCover: () => 0 };
const floorY = (f: number, slab: number) => PLINTH_M + f * 3.2 + slab;

/** Walks in straight 0.3 m steps (6 m/s at 20 fps) towards a plan point of a building. */
function walkTo(world: WalkWorld, w: Walker, b: BuildingGeom, u: number, v: number, env = allOpen): Walker {
  const t = planToWorld(b, u, v, 0, 0, false);
  for (let i = 0; i < 400; i++) {
    const dx = t.x - w.x, dz = t.z - w.z, d = Math.hypot(dx, dz);
    if (d < 0.02) break;
    const k = Math.min(1, 0.3 / d);
    w = moveWalker(world, w, dx * k, dz * k, env);
  }
  return w;
}
const planOf = (b: BuildingGeom, w: Walker) => {
  const dx = w.x - b.center.x, dz = w.z - b.center.z, c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
  return { u: dx * c - dz * s + 13, v: dx * s + dz * c + 6 };
};

test('speeds and step height (V21: 3 m/s, 6 m/s with Shift)', () => {
  expect(WALK_SPEED).toBe(3);
  expect(RUN_SPEED).toBe(6);
  expect(MAX_STEP_M).toBe(0.4);
});

test('the start point is free in all 32 apartments, at their floor', () => {
  for (const apt of layout.apartments) {
    const world = buildWalkWorld(layout, apt.building);
    const w = startPose(layout, apt.id)!;
    expect(w.feet).toBeCloseTo(floorY(apt.floor, 0.12));
    expect(standAt(world, w.x, w.z, w.feet, allClosed), apt.id).toBeCloseTo(w.feet);
    expect(locate(layout, apt.building, w)).toMatchObject({ kind: 'apartment', unitId: apt.id });
  }
  expect(startPose(layout, 'X-9-9')).toBeNull();
});

test('a closed door blocks, an open one lets through', () => {
  const world = buildWalkWorld(layout, 'A');
  const start = startPose(layout, 'A-2-1')!;
  const hall = walkTo(world, walkTo(world, start, A, 4.95, 7.2), A, 4.95, 5.6);
  expect(planOf(A, hall).v).toBeCloseTo(5.6, 1);
  const shut = walkTo(world, walkTo(world, start, A, 4.95, 7.2, allClosed), A, 4.95, 5.6, allClosed);
  expect(planOf(A, shut).v).toBeGreaterThan(6.5);
});

test('walls hold even at 6 m/s with long frames', () => {
  const world = buildWalkWorld(layout, 'A');
  let w = walkTo(world, startPose(layout, 'A-2-1')!, A, 6.0, 9.0);
  for (let i = 0; i < 20; i++) w = moveWalker(world, w, 0.3, 0, allOpen);   // A is not rotated: +x = +u
  expect(planOf(A, w).u).toBeLessThan(6.5 - 0.1 - 0.17);
});

test('the balcony is reached through its door; the railing and a lowered blind stop the walker', () => {
  const world = buildWalkWorld(layout, 'A');
  const inLiving = walkTo(world, startPose(layout, 'A-1-1')!, A, 3.65, 11.0);
  const out = walkTo(world, inLiving, A, 3.65, 12.8);
  expect(locate(layout, 'A', out)).toMatchObject({ kind: 'balcony', unitId: 'A-1-1' });
  expect(out.feet).toBeCloseTo(floorY(1, 0));
  expect(planOf(A, walkTo(world, out, A, 3.65, 15)).v).toBeLessThan(13.5);
  const blinds: WalkEnv = { ...allOpen, blindsCover: () => 0.6 };
  expect(planOf(A, walkTo(world, inLiving, A, 3.65, 12.8, blinds)).v).toBeLessThan(12);
});

test('stairs: up from floor 2 to 3, down from 2 to 1; no basement and no roof', () => {
  const world = buildWalkWorld(layout, 'A');
  const landing = (f: number) => [[4.95, 7.2], [4.95, 5.6], [9.8, 5.1], [12, 5.2]]
    .reduce((w, [u, v]) => walkTo(world, w, A, u, v), startPose(layout, `A-${f}-1`)!);
  let up = landing(2);
  expect(up.feet).toBeCloseTo(floorY(2, 0.1));
  for (const [u, v] of [[14, 4.8], [14, 1.2], [12, 1.2], [12, 4.9]]) up = walkTo(world, up, A, u, v);
  expect(up.feet).toBeCloseTo(floorY(3, 0.1));
  expect(locate(layout, 'A', up)).toMatchObject({ kind: 'stairwell', floor: 3 });
  let down = landing(2);
  for (const [u, v] of [[12, 4.7], [12, 1.2], [14, 1.2], [14, 4.9]]) down = walkTo(world, down, A, u, v);
  expect(down.feet).toBeCloseTo(floorY(1, 0.1));
  const ground = walkTo(world, landing(0), A, 12, 3);
  expect(planOf(A, ground).v).toBeGreaterThan(4.3);
  const top = walkTo(world, walkTo(world, landing(3), A, 14, 4.8), A, 14, 3);
  expect(planOf(A, top).v).toBeGreaterThan(4.3);
});

test('on foot from A-2-1 to B-1-2: stairs, androne, park, the other portone, stairs', () => {
  let world = buildWalkWorld(layout, 'A');
  let w = startPose(layout, 'A-2-1')!;
  const route = (b: BuildingGeom, points: number[][]) => { for (const [u, v] of points) w = walkTo(world, w, b, u, v); };
  route(A, [[4.95, 7.2], [4.95, 5.6], [9.8, 5.1], [11.5, 5.1], [12, 4.7],
    [12, 1.2], [14, 1.2], [14, 4.8], [12, 4.7], [12, 1.2], [14, 1.2], [14, 4.8], [13.6, 11.5], [13.6, 13.6]]);
  expect(locate(layout, 'A', w)).toEqual({ kind: 'outdoor' });
  expect(w.feet).toBeCloseTo(0);
  const corner = (x: number, z: number) => { w = walkTo(world, w, { ...A, center: { x: 0, z: 0 }, rotationY: 0 }, x + 13, z + 6); };
  corner(1.25, -35); corner(38, -35); corner(38, 1.25);
  route(B, [[13.6, 13.6]]);
  world = buildWalkWorld(layout, 'B');   // opening the park portone opens B
  route(B, [[13.6, 11.5], [14, 4.8], [14, 1.2], [12, 1.2], [12, 4.9], [14.5, 6.9], [16.5, 6.9]]);
  expect(locate(layout, 'B', w)).toMatchObject({ kind: 'apartment', unitId: 'B-1-2' });
  expect(w.feet).toBeCloseTo(floorY(1, 0.12));
});

test('settle finds the nearest free spot, or null', () => {
  const world = buildWalkWorld(layout, 'A');
  const inWall = { ...startPose(layout, 'A-2-1')!, ...(() => { const p = planToWorld(A, 6.5, 9, 0, 2, false); return { x: p.x, z: p.z }; })() };
  const free = settle(world, inWall, allOpen)!;
  expect(Math.hypot(free.x - inWall.x, free.z - inWall.z)).toBeLessThan(0.6);
  expect(settle(world, { ...inWall, x: 500 }, allOpen)).toBeNull();
});

test('apartment selection honours the current selection and filters', () => {
  expect(chooseWalkApartment(layout, 'B-2-2', 'A', 1)?.id).toBe('B-2-2');
  expect(chooseWalkApartment(layout, null, 'C', 3)?.id).toBe('C-3-1');
  expect(chooseWalkApartment(layout, null, null, null)?.id).toBe('A-0-1');
  expect(chooseWalkApartment({ ...layout, apartments: [] }, null, null, null)).toBeNull();
});
