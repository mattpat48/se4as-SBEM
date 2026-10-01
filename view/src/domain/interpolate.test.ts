import { STALE_PERIODS, displayedValue, isStale } from './interpolate';

test('first reading is not interpolated', () => {
  expect(displayedValue({ last: 20, lastAt: 0 }, 5000, 10000)).toBe(20);
});

test('start, middle and end of the interval', () => {
  expect(displayedValue({ last: 20, lastAt: 0, prev: 10 }, 0, 10000)).toBe(10);
  expect(displayedValue({ last: 20, lastAt: 0, prev: 10 }, 5000, 10000)).toBe(15);
  expect(displayedValue({ last: 20, lastAt: 0, prev: 10 }, 20000, 10000)).toBe(20);
});

test('stale after 3 periods', () => {
  expect(STALE_PERIODS).toBe(3);
  expect(isStale(0, 30000, 10000)).toBe(false);
  expect(isStale(0, 30001, 10000)).toBe(true);
});
