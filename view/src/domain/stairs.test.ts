import {
  CORE_SLAB_M, DOWN_HALF, FLIGHT_STEPS, MID_LANDING, STAIR_DIVIDER, TREAD_M, UP_HALF, stairRise, stairSteps, stairTread,
} from './stairs';
import { STAIRS } from './plan';
import { stairSlots } from './people';

const rise = 3.2 / 18;

test('two flights of nine steps share the stair rectangle with a mid landing (V21)', () => {
  expect(FLIGHT_STEPS).toBe(9);
  expect(TREAD_M).toBe(0.28);
  expect(stairRise(3.2)).toBeCloseTo(0.1778, 4);
  expect(MID_LANDING).toEqual({ u0: STAIRS.u0, u1: STAIRS.u1, v0: STAIRS.v0, v1: expect.closeTo(1.98, 6) });
  expect(UP_HALF.u0).toBeGreaterThan(STAIR_DIVIDER.u1 - 1e-9);
  expect(DOWN_HALF.u1).toBeLessThan(STAIR_DIVIDER.u0 + 1e-9);
});

test('the up flight rises from the landing, the down flight arrives at the next floor', () => {
  expect(stairTread(14, STAIRS.v1 - 0.01)).toBeCloseTo(CORE_SLAB_M + rise);
  expect(stairTread(14, 2.0)).toBeCloseTo(CORE_SLAB_M + 9 * rise);
  expect(stairTread(12, 1.0)).toBeCloseTo(CORE_SLAB_M + 9 * rise);    // mid landing
  expect(stairTread(12, 2.0)).toBeCloseTo(CORE_SLAB_M + 10 * rise);
  expect(stairTread(12, STAIRS.v1 - 0.01)).toBeCloseTo(CORE_SLAB_M + 3.2);
});

test('the steps list has 18 treads plus the mid landing, in the stair rectangle', () => {
  const steps = stairSteps(3.2);
  expect(steps).toHaveLength(19);
  for (const s of steps) {
    expect(s.u0).toBeGreaterThanOrEqual(STAIRS.u0);
    expect(s.u1).toBeLessThanOrEqual(STAIRS.u1);
    expect(s.v0).toBeGreaterThanOrEqual(STAIRS.v0 - 1e-9);
    expect(s.v1).toBeLessThanOrEqual(STAIRS.v1 + 1e-9);
  }
  expect(Math.max(...steps.map((s) => s.top))).toBeCloseTo(CORE_SLAB_M + 3.2);
});

test('off the flights (landing, other rooms) the tread is 0', () => {
  expect(stairTread(13, 6)).toBe(0);
  expect(stairTread(5, 2)).toBe(0);
  expect(stairTread(13, 3)).toBe(0);   // the divider between the flights
});

test('stair residents stand on the up flight or the landing', () => {
  const slots = stairSlots(8);
  for (const s of slots.filter((_, i) => i % 2 === 0)) expect(stairTread(s.u, s.v)).toBeGreaterThan(CORE_SLAB_M);
  for (const s of slots.filter((_, i) => i % 2 === 1)) expect(stairTread(s.u, s.v)).toBe(0);
});
