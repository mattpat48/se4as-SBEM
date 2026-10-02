import { frameRate, shadowInterval } from './renderPolicy';

test('idle graphics save work while navigation remains responsive in both profiles', () => {
  expect(frameRate(false, false, false)).toBe(30);
  expect(frameRate(false, true, false)).toBe(60);
  expect(frameRate(false, false, true)).toBe(60);
  expect(frameRate(true, false, false)).toBe(15);
  expect(frameRate(true, true, false)).toBe(30);
  expect(frameRate(true, false, true)).toBe(30);
  expect(shadowInterval(true)).toBeGreaterThan(shadowInterval(false));
});
