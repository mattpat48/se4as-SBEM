// Low-poly procedural furniture, merged by palette role: four draw calls per apartment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Furniture } from '../domain/furniture';
import type { FurnitureRole } from './materials';

export function buildFurnitureGeometries(items: readonly Furniture[]): Map<FurnitureRole, THREE.BufferGeometry> {
  const parts = new Map<FurnitureRole, THREE.BufferGeometry[]>();
  for (const f of items) {
    const w = f.u1 - f.u0, d = f.v1 - f.v0, height = f.h - 0.12;
    // Recipes use a unit envelope. Rotate before stretching to keep every detail inside it.
    const add = (role: FurnitureRole, shape: 'box' | 'round' | 'leaf', x: number, y: number, z: number,
      sx: number, sy: number, sz: number) => {
      const g = shape === 'round' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
        : shape === 'leaf' ? new THREE.SphereGeometry(0.5, 8, 6) : new THREE.BoxGeometry(1, 1, 1);
      g.scale(sx, sy, sz).translate(x, y, z).rotateY(f.rotation ?? 0)
        .scale(w, height, d).translate((f.u0 + f.u1) / 2, 0.12, (f.v0 + f.v1) / 2);
      const bucket = parts.get(role) ?? [];
      bucket.push(g);
      parts.set(role, bucket);
    };
    const box = (r: FurnitureRole, x: number, y: number, z: number, sx: number, sy: number, sz: number) => add(r, 'box', x, y, z, sx, sy, sz);
    const round = (r: FurnitureRole, x: number, y: number, z: number, sx: number, sy: number, sz: number) => add(r, 'round', x, y, z, sx, sy, sz);
    const legs = (top: number) => {
      for (const x of [-0.38, 0.38]) for (const z of [-0.38, 0.38]) box('wood', x, top / 2, z, 0.07, top, 0.07);
    };
    const cabinet = () => {
      box('wood', 0, 0.48, 0, 0.96, 0.88, 0.96);
      box('furniture', 0, 0.96, 0, 1, 0.08, 1);
      for (const x of [-0.25, 0.25]) {
        box('furniture', x, 0.5, -0.487, 0.47, 0.78, 0.026);
        box('metal', x, 0.73, -0.499, 0.16, 0.035, 0.002);
      }
    };
    switch (f.kind) {
      case 'sofa':
        legs(0.2);
        box('fabric', 0, 0.32, 0, 0.98, 0.3, 0.96);
        box('fabric', 0, 0.73, -0.4, 0.98, 0.54, 0.2);
        for (const x of [-0.445, 0.445]) box('fabric', x, 0.6, 0.04, 0.11, 0.4, 0.9);
        for (const x of [-0.21, 0.21]) {
          box('furniture', x, 0.52, 0.09, 0.4, 0.13, 0.69);
          box('fabric', x, 0.73, -0.23, 0.34, 0.28, 0.12);
        }
        break;
      case 'table': case 'desk':
        legs(0.9);
        box('wood', 0, 0.95, 0, 1, 0.1, 1);
        if (f.kind === 'desk') box('furniture', 0.3, 0.68, 0, 0.3, 0.36, 0.88);
        break;
      case 'chair':
        legs(0.53);
        box('fabric', 0, 0.56, 0, 0.98, 0.12, 0.96);
        box('wood', 0, 0.81, -0.43, 0.94, 0.38, 0.12);
        break;
      case 'doubleBed': case 'singleBed':
        box('wood', 0, 0.2, 0, 0.98, 0.27, 0.98);
        box('furniture', 0, 0.42, -0.02, 0.95, 0.22, 0.92);
        box('fabric', 0, 0.55, -0.15, 0.95, 0.08, 0.63);
        box('wood', 0, 0.65, 0.47, 1, 0.7, 0.06);
        for (const x of f.kind === 'doubleBed' ? [-0.24, 0.24] : [0])
          box('furniture', x, 0.59, 0.29, f.kind === 'doubleBed' ? 0.4 : 0.78, 0.14, 0.2);
        break;
      case 'cabinet': cabinet(); break;
      case 'tv':
        box('wood', 0, 0.24, 0, 1, 0.48, 1);
        box('metal', 0, 0.55, 0, 0.08, 0.16, 0.24);
        box('metal', 0, 0.8, 0, 0.9, 0.4, 0.08);
        box('furniture', 0, 0.8, -0.045, 0.84, 0.34, 0.01);
        break;
      case 'rug':
        box('fabric', 0, 0.5, 0, 1, 1, 1);
        for (const z of [-0.43, 0.43]) box('furniture', 0, 0.95, z, 0.94, 0.1, 0.025);
        break;
      case 'plant':
        round('wood', 0, 0.18, 0, 0.54, 0.36, 0.54);
        round('metal', 0, 0.52, 0, 0.06, 0.6, 0.06);
        for (const [x, y, z] of [[-0.23, 0.64, 0], [0.23, 0.74, 0], [0, 0.82, 0.22], [0, 0.72, -0.22]])
          add('fabric', 'leaf', x, y, z, 0.46, 0.36, 0.46);
        break;
      case 'kitchen':
        // Open service niche at the hob end leaves the gas valve visible and accessible.
        box('wood', 0, 0.44, -0.06, 0.96, 0.84, 0.88);
        box('furniture', 0, 0.91, 0, 1, 0.1, 1);
        for (const z of [-0.36, -0.12, 0.12]) {
          box('furniture', 0.487, 0.44, z, 0.026, 0.78, 0.225);
          box('metal', 0.499, 0.72, z, 0.002, 0.025, 0.12);
        }
        box('metal', 0, 0.967, -0.2, 0.75, 0.014, 0.16);
        box('furniture', 0, 0.975, -0.2, 0.56, 0.01, 0.12);
        box('metal', -0.32, 0.985, -0.2, 0.05, 0.03, 0.025);
        box('metal', 0, 0.973, 0.41, 0.8, 0.026, 0.18);
        for (const x of [-0.2, 0.2]) for (const z of [0.37, 0.45]) round('furniture', x, 0.992, z, 0.22, 0.016, 0.06);
        break;
      case 'toilet':
        round('furniture', 0, 0.23, 0.06, 0.64, 0.46, 0.65);
        round('furniture', 0, 0.5, 0.06, 0.9, 0.14, 0.82);
        round('metal', 0, 0.577, 0.08, 0.57, 0.014, 0.56);
        box('furniture', 0, 0.7, -0.38, 0.84, 0.6, 0.22);
        box('metal', 0, 0.96, -0.26, 0.2, 0.035, 0.015);
        break;
      case 'sink':
        box('wood', 0, 0.42, 0, 0.92, 0.72, 0.9);
        box('furniture', 0, 0.82, 0, 1, 0.14, 1);
        round('metal', 0, 0.9, 0.05, 0.67, 0.02, 0.65);
        round('furniture', 0, 0.915, 0.05, 0.5, 0.01, 0.48);
        box('metal', 0, 0.95, -0.33, 0.07, 0.1, 0.07);
        break;
      case 'shower':
        box('furniture', 0, 0.045, 0, 1, 0.09, 1);
        box('metal', 0.25, 0.095, 0.25, 0.1, 0.01, 0.1);
        // Open screen frame is a cutaway glass outline; it does not obscure the floor.
        for (const x of [-0.48, 0.48]) box('metal', x, 0.55, -0.48, 0.035, 0.9, 0.035);
        box('metal', 0, 0.985, -0.48, 0.96, 0.03, 0.035);
        box('metal', -0.48, 0.55, 0, 0.035, 0.035, 0.96);
        break;
      case 'boiler':
        box('furniture', 0, 0.73, 0, 0.96, 0.54, 0.86);
        for (const x of [-0.25, 0.25]) round('metal', x, 0.32, 0, 0.065, 0.3, 0.065);
        box('metal', 0, 0.58, 0.44, 0.5, 0.13, 0.02);
        box('fabric', 0, 0.58, 0.455, 0.3, 0.08, 0.01);
        break;
      case 'coatRack':
        round('wood', 0, 0.04, 0, 0.8, 0.08, 0.8);
        round('metal', 0, 0.52, 0, 0.08, 0.96, 0.08);
        box('wood', 0, 0.82, 0, 0.94, 0.055, 0.07);
        box('wood', 0, 0.92, 0, 0.07, 0.055, 0.94);
        break;
    }
  }
  const merged = new Map<FurnitureRole, THREE.BufferGeometry>();
  for (const [role, geometries] of parts) {
    const g = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    if (!g) throw new Error(`Cannot merge furniture role ${role}`);
    merged.set(role, g);
  }
  return merged;
}
