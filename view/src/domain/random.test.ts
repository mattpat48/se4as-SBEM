import { hashString, mulberry32 } from './random';

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(11), b = mulberry32(11);
  const xs = Array.from({ length: 100 }, () => a());
  expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
  for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
});

test('hashString is stable and spreads ids', () => {
  expect(hashString('A-2-1')).toBe(hashString('A-2-1'));
  expect(hashString('A-2-1')).not.toBe(hashString('A-2-2'));
});
