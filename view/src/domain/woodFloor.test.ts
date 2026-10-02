import { floorFinish, woodPlanks } from './woodFloor';

test('planks tile the texture exactly, in rows with staggered joints', () => {
  const size = 512;
  const planks = woodPlanks(size, 8, 7);
  const covered = planks.reduce((s, p) => s + p.w * p.h, 0);
  expect(covered).toBe(size * size);
  for (const p of planks) {
    expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= size && p.y + p.h <= size && p.w > 0 && p.h > 0).toBe(true);
    expect(p.tone).toBeGreaterThanOrEqual(0);
    expect(p.tone).toBeLessThanOrEqual(1);
  }
  const joints = (row: number) => planks.filter((p) => p.y === row * size / 8 && p.x > 0).map((p) => p.x);
  expect(joints(0)).not.toEqual(joints(1));
  expect(woodPlanks(size, 8, 7)).toEqual(planks);
});

test('the heat map tints the wood with the data colour; without it the floor is plain wood', () => {
  expect(floorFinish({ heatOn: true, state: 'ok', dataMode: false })).toEqual({ map: 'wood', tint: 'heat' });
  expect(floorFinish({ heatOn: false, state: 'ok', dataMode: false })).toEqual({ map: 'wood', tint: 'wood' });
  expect(floorFinish({ heatOn: false, state: 'stale', dataMode: false })).toEqual({ map: 'wood', tint: 'wood' });
});

test('stale data stays grey and striped, as before', () => {
  expect(floorFinish({ heatOn: true, state: 'stale', dataMode: false })).toEqual({ map: 'stripes', tint: 'heat' });
  expect(floorFinish({ heatOn: true, state: 'stale', dataMode: true })).toEqual({ map: 'stripes', tint: 'heat' });
  expect(floorFinish({ heatOn: true, state: 'missing', dataMode: false })).toEqual({ map: 'wood', tint: 'heat' });
});

test('the data mode keeps the plain "plastico" slab, without wood', () => {
  expect(floorFinish({ heatOn: true, state: 'ok', dataMode: true })).toEqual({ map: 'none', tint: 'heat' });
  expect(floorFinish({ heatOn: false, state: 'ok', dataMode: true })).toEqual({ map: 'none', tint: 'slab' });
});
