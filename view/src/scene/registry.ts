// Unit id → the meshes that represent it, so live layers (heat map, hazards) can
// recolour units inside useFrame without React renders.
import type * as THREE from 'three';

export interface UnitParts {
  shells: THREE.Mesh[];
  floor?: THREE.Mesh;
  windowIndices: number[];
  windows?: THREE.InstancedMesh;
}

const units = new Map<string, UnitParts>();

/** Merges the given parts into the unit's entry (floors and windows register separately). */
export function registerUnit(unitId: string, parts: Partial<UnitParts>): void {
  const cur = units.get(unitId) ?? { shells: [], windowIndices: [] };
  units.set(unitId, {
    shells: parts.shells ? [...cur.shells, ...parts.shells] : cur.shells,
    floor: parts.floor ?? cur.floor,
    windowIndices: parts.windowIndices ?? cur.windowIndices,
    windows: parts.windows ?? cur.windows,
  });
}

/** Removes the given parts, or the whole unit when `parts` is omitted. */
export function unregisterUnit(unitId: string, parts?: Partial<UnitParts>): void {
  const cur = units.get(unitId);
  if (!cur) return;
  if (!parts) { units.delete(unitId); return; }
  const next: UnitParts = {
    shells: parts.shells ? cur.shells.filter((m) => !parts.shells!.includes(m)) : cur.shells,
    floor: parts.floor && parts.floor === cur.floor ? undefined : cur.floor,
    windowIndices: parts.windows && parts.windows === cur.windows ? [] : cur.windowIndices,
    windows: parts.windows && parts.windows === cur.windows ? undefined : cur.windows,
  };
  if (next.shells.length === 0 && !next.floor && !next.windows) units.delete(unitId);
  else units.set(unitId, next);
}

export function getUnit(unitId: string): UnitParts | undefined {
  return units.get(unitId);
}

export function registeredUnits(): IterableIterator<[string, UnitParts]> {
  return units.entries();
}
