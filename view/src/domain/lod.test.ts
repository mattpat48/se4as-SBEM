import { MAX_LABELS, lodLevel, pickLabels } from './lod';

test('distance bands', () => {
  expect([lodLevel(200, false), lodLevel(150, false), lodLevel(60, false), lodLevel(59.9, false), lodLevel(500, true)])
    .toEqual(['far', 'mid', 'mid', 'near', 'near']);
  expect(lodLevel(150.1, false)).toBe('far');
});

test('pickLabels keeps the 40 nearest in view', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i, distance: (i * 37) % 100, inView: i % 2 === 0 }));
  const picked = pickLabels(items);
  expect(MAX_LABELS).toBe(40);
  expect(picked.length).toBe(40);
  expect(picked.every((p) => p.inView)).toBe(true);
  for (let i = 1; i < picked.length; i++) expect(picked[i].distance).toBeGreaterThanOrEqual(picked[i - 1].distance);
  expect(pickLabels(items, 3).length).toBe(3);
});

test('pickLabels skips hidden labels and still fills up to the limit with the nearest visible ones', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i, distance: i, inView: true }));
  const checked: number[] = [];
  const picked = pickLabels(items, 3, (it) => { checked.push(it.id); return it.id % 2 === 1; });
  expect(picked.map((p) => p.id)).toEqual([1, 3, 5]);
  expect(checked).toEqual([0, 1, 2, 3, 4, 5]);       // nearest first, stopping once the limit is reached
});
