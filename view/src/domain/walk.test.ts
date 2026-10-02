import { canStand, moveWalker, WALK_START, chooseWalkApartment } from './walk';
import { buildComplexLayout } from './layout';
import type { ComplexModelMsg } from './messages';
import model from '../test/fixtures/model.json';

test('entry is clear and apartment selection honours the current selection and filters', () => {
  expect(canStand(WALK_START)).toBe(true);
  const layout = buildComplexLayout(model as unknown as ComplexModelMsg);
  expect(chooseWalkApartment(layout, 'B-2-2', 'A', 1)?.id).toBe('B-2-2');
  expect(chooseWalkApartment(layout, null, 'C', 3)?.id).toBe('C-3-1');
  expect(chooseWalkApartment(layout, null, null, null)?.id).toBe('A-0-1');
  expect(chooseWalkApartment({ ...layout, apartments: [] }, null, null, null)).toBeNull();
});

test('walls, furniture and the apartment perimeter block the walker', () => {
  for (const p of [{ u: 6.5, v: 9 }, { u: 3.2, v: 7.2 }, { u: -1, v: 8 }, { u: 8, v: 12.1 }]) expect(canStand(p)).toBe(false);
  expect(canStand({ u: 4.3, v: 9.5 })).toBe(true); // Rugs do not obstruct walking.
  const p = moveWalker({ u: 6, v: 9 }, 4, 0);
  expect(p.u).toBeLessThan(6.23);
  expect(canStand(p)).toBe(true);
});

test('each 0.9 m door permits passage without tunnelling through walls', () => {
  for (const [u, v] of [[4.95, 6.5], [8.45, 6.5], [3.25, 4.5], [5.25, 3], [7.95, 3]]) {
    const p = moveWalker({ u, v: v - 0.6 }, 0, 1.2);
    expect(p.v).toBeCloseTo(v + 0.6);
    expect(canStand(p)).toBe(true);
  }
});

test('movement slides along a wall and never crosses a bed or outside boundary', () => {
  const p = moveWalker({ u: 6.1, v: 8 }, 2, 1);
  expect(p.v).toBeGreaterThan(8.8);
  expect(p.u).toBeLessThan(6.23);
  const bed = moveWalker({ u: 8, v: 8.9 }, 0, 3);
  expect(bed.v).toBeLessThan(9.4);
  expect(moveWalker({ u: 9, v: 5 }, 30, 0).u).toBeLessThan(10.3);
});

test('the full-height wall boiler cannot be walked through', () => {
  expect(canStand({u:6.1,v:.5})).toBe(false);
});
