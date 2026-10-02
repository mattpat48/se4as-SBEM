import { personGeometry } from './personGeometry';
test('human figure has separate colours, a realistic height and fits the reserved radius', () => {
  const g=personGeometry(); g.computeBoundingBox();
  expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-.001);
  expect(g.boundingBox!.max.y).toBeLessThanOrEqual(1.71);
  expect(g.boundingBox!.max.y).toBeGreaterThan(1.65);
  expect(Math.max(Math.abs(g.boundingBox!.min.x),g.boundingBox!.max.x)).toBeLessThan(.3);
  expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  g.dispose();
});
