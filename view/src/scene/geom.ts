// Plan metres → local building coordinates (the Building group applies centre and rotation).
import type { BuildingGeom } from '../domain/layout';
import { PLAN_D, PLAN_W, mirror, type PlanRect } from '../domain/plan';

export function planLocal(b: BuildingGeom, u: number, v: number, mirrored = false): [number, number] {
  const [pu, pv] = mirrored ? mirror(u, v) : [u, v];
  return [(pu - PLAN_W / 2) * b.width / PLAN_W, (pv - PLAN_D / 2) * b.depth / PLAN_D];
}

/** Position and scale of a box covering a plan rectangle from height y0 to y0 + h. */
export function planBox(b: BuildingGeom, r: PlanRect, y0: number, h: number, mirrored = false) {
  const [x0, z0] = planLocal(b, r.u0, r.v0, mirrored);
  const [x1, z1] = planLocal(b, r.u1, r.v1, mirrored);
  return {
    position: [(x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2] as [number, number, number],
    scale: [Math.abs(x1 - x0), h, Math.abs(z1 - z0)] as [number, number, number],
  };
}

/** A wall segment [u0, v0, u1, v1] as a thin box. */
export function planWall(b: BuildingGeom, w: [number, number, number, number], y0: number, h: number, thick: number, mirrored = false) {
  const [x0, z0] = planLocal(b, w[0], w[1], mirrored);
  const [x1, z1] = planLocal(b, w[2], w[3], mirrored);
  const len = Math.hypot(x1 - x0, z1 - z0);
  return {
    position: [(x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2] as [number, number, number],
    rotation: [0, -Math.atan2(z1 - z0, x1 - x0), 0] as [number, number, number],
    scale: [len + thick, h, thick] as [number, number, number],
  };
}
