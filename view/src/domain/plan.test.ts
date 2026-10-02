import { CORE, INTERIOR_WALLS, PLAN_D, PLAN_W, ROOMS, WINDOWS, mirror } from './plan';

test('mirror preserves the park-facing side', () => {
  expect(mirror(0, 0)).toEqual([26, 0]);
  expect(mirror(13, 6)).toEqual([13, 6]);
});

test('rooms of interno 1 stay left of the core', () => {
  for (const r of ROOMS) expect(r.u1).toBeLessThanOrEqual(10.5);
  expect(CORE.u0).toBe(10.5);
});

test('rooms and walls lie inside the plan', () => {
  for (const r of ROOMS) {
    expect(r.u0).toBeGreaterThanOrEqual(0); expect(r.v0).toBeGreaterThanOrEqual(0);
    expect(r.v1).toBeLessThanOrEqual(PLAN_D);
  }
  for (const [u0, v0, u1, v1] of INTERIOR_WALLS) {
    expect(Math.min(u0, u1)).toBeGreaterThanOrEqual(0); expect(Math.max(u0, u1)).toBeLessThanOrEqual(10.5);
    expect(Math.min(v0, v1)).toBeGreaterThanOrEqual(0); expect(Math.max(v0, v1)).toBeLessThanOrEqual(PLAN_D);
  }
});

test('windows from the spec table', () => {
  const side1 = WINDOWS.filter((w) => w.side === 1 && w.unit === 'apt1').map((w) => [w.u0, w.u1, w.tall]);
  expect(side1).toEqual([[0.6, 6.0, true], [7.3, 9.8, false]]);
  expect(WINDOWS.filter((w) => w.side === 2 && w.unit === 'apt1').length).toBe(3);
  expect(WINDOWS.find((w) => w.unit === 'core')).toMatchObject({ side: 2, u0: 11.2, u1: 14.8 });
  expect(PLAN_W).toBe(26);
});
