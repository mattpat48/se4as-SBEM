import { FURNITURE, furnitureForFloor } from '../domain/furniture';
import { buildFurnitureGeometries } from './furnitureGeometry';

test('rendered furniture fits the tested footprint and height, including all details', () => {
  for (const f of [...FURNITURE, ...furnitureForFloor(2, true)]) {
    const geometries = buildFurnitureGeometries([f]);
    expect(geometries.size).toBeGreaterThan(0);
    expect(geometries.size).toBeLessThanOrEqual(4);
    for (const g of geometries.values()) {
      g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      expect(min.x, f.id).toBeGreaterThanOrEqual(f.u0 - 1e-5);
      expect(max.x, f.id).toBeLessThanOrEqual(f.u1 + 1e-5);
      expect(min.z, f.id).toBeGreaterThanOrEqual(f.v0 - 1e-5);
      expect(max.z, f.id).toBeLessThanOrEqual(f.v1 + 1e-5);
      expect(min.y, f.id).toBeGreaterThanOrEqual(0.12 - 1e-5);
      expect(max.y, f.id).toBeLessThanOrEqual(f.h + 1e-5);
      g.dispose();
    }
  }
});

test('a furnished apartment costs only four static material batches', () => {
  const geometries = buildFurnitureGeometries(FURNITURE);
  expect(geometries.size).toBe(4);
  for (const g of geometries.values()) {
    expect(g.getAttribute('position').count).toBeLessThan(40000);
    g.dispose();
  }
});
