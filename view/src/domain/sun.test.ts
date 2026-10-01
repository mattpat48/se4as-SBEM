import { LAQUILA, nightFactor, romeOffsetHours, sunPosition } from './sun';

const maxElev = (y: number, m: number, d: number) => {
  let best = { elevationDeg: -90, azimuthDeg: 0 };
  for (let min = 0; min < 24 * 60; min++) {
    const p = sunPosition(Date.UTC(y, m - 1, d, 0, min));
    if (p.elevationDeg > best.elevationDeg) best = p;
  }
  return best;
};

test('summer and winter solstice at noon', () => {
  const s = maxElev(2026, 6, 21), w = maxElev(2026, 12, 21);
  expect(s.elevationDeg).toBeGreaterThan(70); expect(s.elevationDeg).toBeLessThan(72);
  expect(w.elevationDeg).toBeGreaterThan(23); expect(w.elevationDeg).toBeLessThan(25.5);
  expect(Math.abs(s.azimuthDeg - 180)).toBeLessThan(3);
});

test('night and morning', () => {
  expect(sunPosition(Date.UTC(2026, 8, 30, 2, 0)).elevationDeg).toBeLessThan(0);
  const morning = sunPosition(Date.UTC(2026, 8, 30, 9, 0));
  expect(morning.elevationDeg).toBeGreaterThan(0);
  expect(morning.azimuthDeg).toBeGreaterThan(90); expect(morning.azimuthDeg).toBeLessThan(180);   // south-east
});

test('sun is finite on 2027-01-15', () => {
  for (let h = 0; h < 24; h++) expect(Number.isFinite(sunPosition(Date.UTC(2027, 0, 15, h)).elevationDeg)).toBe(true);
});

test('Rome offset: CEST between the last Sundays of March and October', () => {
  expect([romeOffsetHours(Date.UTC(2026, 2, 28, 12)), romeOffsetHours(Date.UTC(2026, 2, 30, 12)),
          romeOffsetHours(Date.UTC(2026, 9, 24, 12)), romeOffsetHours(Date.UTC(2026, 9, 26, 12))]).toEqual([1, 2, 2, 1]);
});

test('night factor', () => {
  expect([nightFactor(-6), nightFactor(6), nightFactor(0), nightFactor(-20), nightFactor(40)]).toEqual([1, 0, 0.5, 1, 0]);
  expect(LAQUILA).toEqual({ lat: 42.35, lon: 13.40 });
});
