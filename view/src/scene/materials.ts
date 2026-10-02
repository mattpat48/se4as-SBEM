// Shared materials, one set for normal and one for faded buildings. Their colours
// follow the current palette (applyPalette), so the day → night blend is cheap.
import * as THREE from 'three';
import { DAY, type Palette } from '../domain/palette';

export type FurnitureRole = 'furniture' | 'fabric' | 'wood' | 'metal';
export type Role = 'ground' | 'grass' | 'path' | 'road' | 'wall' | 'core' | 'plinth' | 'slab' | 'glass' | 'trunk' | 'leaf' | FurnitureRole;
const ROLES: Role[] = ['ground', 'grass', 'path', 'road', 'wall', 'core', 'plinth', 'slab', 'glass', 'trunk', 'leaf', 'furniture', 'fabric', 'wood', 'metal'];
const FURNITURE_ROLES: readonly Role[] = ['furniture', 'fabric', 'wood', 'metal'];

function make(faded: boolean): Record<Role, THREE.MeshStandardMaterial> {
  const out = {} as Record<Role, THREE.MeshStandardMaterial>;
  for (const r of ROLES) {
    out[r] = new THREE.MeshStandardMaterial({
      roughness: r === 'glass' ? 0.15 : r === 'road' ? 0.95 : 0.85,
      metalness: r === 'glass' ? 0.3 : 0,
      flatShading: r === 'leaf',
      transparent: faded,
      opacity: faded ? 0.25 : 1,
      depthWrite: !faded,
    });
  }
  return out;
}

export const MATERIALS = { normal: make(false), faded: make(true) };

export function mat(role: Role, faded = false): THREE.MeshStandardMaterial {
  return (faded ? MATERIALS.faded : MATERIALS.normal)[role];
}

export function applyPalette(p: Palette): void {
  for (const set of [MATERIALS.normal, MATERIALS.faded])
    for (const r of ROLES) {
      set[r].color.set(p[r]);
      if (FURNITURE_ROLES.includes(r)) {
        set[r].emissive.set(p[r]);
        set[r].emissiveIntensity = p.furnitureEmission;
      }
    }
}

applyPalette(DAY);

/** Fixed-colour materials that do not follow the palette. */
const fixed = new Map<string, THREE.Material>();
export function fixedMat(key: string, build: () => THREE.Material): THREE.Material {
  let m = fixed.get(key);
  if (!m) { m = build(); fixed.set(key, m); }
  return m;
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const UNIT_BOX_EDGES = new THREE.EdgesGeometry(UNIT_BOX);

/** Cyan outlines of the digital-twin night style (prototype "twin": edges on); Lighting sets the opacity. */
export const TWIN_EDGES = new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0, depthWrite: false });
