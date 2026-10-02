// Park and street trees (positions shared by the scene and the first-person collisions).
import type { ComplexLayout } from './layout';
import { gardenCore } from './garden';
import { mulberry32 } from './random';

export interface TreeSpec { x: number; z: number; s: number }

/** 26 park trees from mulberry32(11), away from the centre and the paths, plus street trees. */
export function treeSpecs(l: ComplexLayout): TreeSpec[] {
  const { center, width, depth } = gardenCore(l);
  const rnd = mulberry32(11);
  const out: TreeSpec[] = [];
  for (let attempts = 0; out.length < 26 && attempts < 500; attempts++) {
    const e = -27 + rnd() * 54, n = -22 + rnd() * 44, s = 0.75 + rnd() * 0.5;
    if (Math.abs(e) < 3.5 || Math.abs(n) < 3.5 || Math.hypot(e, n) < 13) continue;
    out.push({ x: center.x + e * width / 60, z: center.z - n * depth / 50, s });
  }
  for (const x of [-75, -60, -40, 40, 60, 75]) out.push({ x, z: -64, s: 1 }, { x, z: 84, s: 1 });
  for (const x of [-61, -43, 43, 61]) for (const z of [-53, 51]) out.push({x,z,s:1.2});
  for (const z of [-38,-18,20,40]) out.push({x:-74,z,s:1.15},{x:74,z,s:1.15});
  return out;
}

/** Trunk radius at the base, in metres. */
export function trunkRadius(t: TreeSpec): number {
  return 0.25 * t.s;
}
