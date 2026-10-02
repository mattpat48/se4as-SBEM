import { STAIR_RISE_M, STAIR_STEPS, stairTread } from './stairs';
import { STAIRS } from './plan';
import { stairSlots } from './people';

test('the flight has nine 0.18 m steps rising towards side 2 (lower v)', () => {
  expect(STAIR_STEPS).toBe(9);
  expect(STAIR_RISE_M).toBe(0.18);
  expect(stairTread(13, STAIRS.v1 - 0.01)).toBeCloseTo(0.18);
  expect(stairTread(13, STAIRS.v0 + 0.01)).toBeCloseTo(9 * 0.18);
  expect(stairTread(13, 2.0)).toBeCloseTo(6 * 0.18);
});

test('off the flight (landing, other rooms) people stand on the floor', () => {
  expect(stairTread(13, 6)).toBe(0);
  expect(stairTread(5, 2)).toBe(0);
  for (const s of stairSlots(8)) expect(stairTread(s.u, s.v)).toBeGreaterThanOrEqual(0);
});
