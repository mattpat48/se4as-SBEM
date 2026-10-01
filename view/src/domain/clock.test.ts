import { clockFromMessage, formatClockLabel, formatSimTime, parseSimTime, simNowMs, simParts } from './clock';

test('parse and format naive sim time', () => {
  expect(parseSimTime('2026-09-30T21:15:00')).toBe(Date.UTC(2026, 8, 30, 21, 15, 0));
  expect(parseSimTime('ieri')).toBeNull();
  expect(parseSimTime('2026-13-40T99:00:00')).toBeNull();
  expect(formatSimTime(Date.UTC(2027, 0, 15, 8, 0, 0))).toBe('2027-01-15T08:00:00');
});

test('advances locally at ×60', () => {
  const c = { simMs: Date.UTC(2026, 8, 30, 21, 0, 0), speed: 60, receivedAtMs: 1000 };
  expect(simNowMs(c, 2000)).toBe(c.simMs + 60_000);
  expect(simNowMs({ ...c, speed: 1 }, 2000)).toBe(c.simMs + 1000);
});

test('earlier sim_time replaces state', () => {
  const later = clockFromMessage({ sim_time: '2026-09-30T21:00:00', speed: 60, timestamp: 1 }, 0)!;
  const jumped = clockFromMessage({ sim_time: '2027-01-15T08:00:00', speed: 1, timestamp: 2 }, 5000)!;
  expect(simNowMs(jumped, 6000)).toBe(Date.UTC(2027, 0, 15, 8, 0, 1));
  expect(simNowMs(jumped, 6000)).not.toBe(simNowMs(later, 6000));
});

test('invalid clock message', () => {
  expect(clockFromMessage({ sim_time: 'x', speed: 1, timestamp: 1 }, 0)).toBeNull();
});

test('simParts', () => {
  expect(simParts(Date.UTC(2026, 8, 30, 21, 15, 7)))
    .toEqual({ year: 2026, month: 9, day: 30, hour: 21, minute: 15, second: 7, weekday: 3 });
});

test('top bar label in Italian', () => {
  expect(formatClockLabel(Date.UTC(2026, 8, 30, 21, 15, 42), 60)).toBe('mer 30 set · 21:15 · ×60');
  expect(formatClockLabel(Date.UTC(2027, 0, 3, 8, 5, 0), 1)).toBe('dom 3 gen · 08:05 · ×1');
});
