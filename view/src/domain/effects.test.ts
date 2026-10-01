import { SHAKE_M_PER_MW, coWarning, gasHaze, isCloudy, isFire, rainDensity, shakeAmplitude, smokeDensity, windSway } from './effects';

test('smoke, fire, gas, CO thresholds', () => {
  expect([smokeDensity(0), smokeDensity(1), smokeDensity(15.5), smokeDensity(30), smokeDensity(80)]).toEqual([0, 0, 0.5, 1, 1]);
  expect([isFire(61, 11), isFire(61, 10), isFire(60, 50)]).toEqual([true, false, false]);
  expect([gasHaze(5), gasHaze(5.1)]).toEqual([false, true]);
  expect([coWarning(0), coWarning(0.1)]).toEqual([false, true]);
});

test('earthquake shake', () => {
  expect(SHAKE_M_PER_MW).toBe(0.15);
  expect([shakeAmplitude(2.5), shakeAmplitude(5.8)]).toEqual([0, expect.closeTo(0.42, 5)]);
});

test('weather', () => {
  expect([rainDensity(15), rainDensity(60), windSway(40), windSway(200)]).toEqual([0.5, 1, 0.5, 1]);
  expect([rainDensity(-1), windSway(0)]).toEqual([0, 0]);
  expect([isCloudy(0), isCloudy(0.2)]).toEqual([false, true]);
});
