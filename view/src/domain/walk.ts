// First-person walking in the world (V21 §3.2): feet follow the highest surface within one step,
// obstacles stop the walker, movement slides along walls. Independent of rendering and input.
import type { ApartmentGeom, ComplexLayout } from './layout';
import { planToWorld } from './layout';
import { APT_SLAB_M, blockedAt, surfacesAt, type WalkEnv, type WalkWorld } from './walkWorld';

/** Position (world metres, feet height) and gaze (world yaw, pitch) of the walker. */
export interface Walker { x: number; z: number; feet: number; yaw: number; pitch: number }

export const WALK_START = { u: 4.8, v: 10.5 };
export const WALK_EYE_M = 1.65;
export const WALK_RADIUS_M = 0.18;
export const WALK_SPEED = 3;
export const RUN_SPEED = 6;
export const MAX_STEP_M = 0.4;
const SUBSTEP_M = 0.06;

/** Feet height to stand at (x, z) from `feet`: the highest surface within one step, else null. */
export function standY(world: WalkWorld, x: number, z: number, feet: number): number | null {
  let best: number | null = null;
  for (const y of surfacesAt(world, x, z)) {
    if (Math.abs(y - feet) <= MAX_STEP_M + 1e-9 && (best === null || y > best)) best = y;
  }
  return best;
}

/** Feet height if the walker can stand at (x, z) coming from `feet`, else null. */
export function standAt(world: WalkWorld, x: number, z: number, feet: number, env: WalkEnv): number | null {
  const y = standY(world, x, z, feet);
  if (y === null || blockedAt(world, x, z, y, WALK_RADIUS_M, env)) return null;
  return y;
}

/** Moves by (dx, dz) in small steps, one axis at a time, so the walker slides along walls. */
export function moveWalker(world: WalkWorld, w: Walker, dx: number, dz: number, env: WalkEnv): Walker {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return w;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SUBSTEP_M));
  const next = { ...w };
  for (let i = 0; i < steps; i++) {
    const ya = standAt(world, next.x + dx / steps, next.z, next.feet, env);
    if (ya !== null) { next.x += dx / steps; next.feet = ya; }
    const yb = standAt(world, next.x, next.z + dz / steps, next.feet, env);
    if (yb !== null) { next.z += dz / steps; next.feet = yb; }
  }
  return next;
}

/** World displacement for held inputs: forward along the gaze, right to its side. */
export function walkDelta(forward: number, right: number, yaw: number, speed: number, dt: number): { dx: number; dz: number } {
  const len = Math.max(1, Math.hypot(forward, right));
  const k = speed * dt / len;
  return { dx: (Math.sin(yaw) * forward - Math.cos(yaw) * right) * k, dz: (Math.cos(yaw) * forward + Math.sin(yaw) * right) * k };
}

/** Where a visit of an apartment begins: in the living room, looking into the flat. */
export function startPose(layout: ComplexLayout, aptId: string): Walker | null {
  const apt = layout.apartments.find((a) => a.id === aptId);
  const b = layout.buildings.find((x) => x.id === apt?.building);
  if (!apt || !b?.supportsPlan) return null;
  const p = planToWorld(b, WALK_START.u, WALK_START.v, APT_SLAB_M, apt.floor, apt.mirrored);
  return { x: p.x, z: p.z, feet: p.y, yaw: -Math.PI / 2 + b.rotationY + (apt.mirrored ? Math.PI : 0), pitch: 0 };
}

/** The nearest spot to stand within 3 m (rings of 0.2 m, 16 directions), or null. */
export function settle(world: WalkWorld, w: Walker, env: WalkEnv): Walker | null {
  for (let r = 0; r <= 3 + 1e-9; r += 0.2) {
    for (let k = 0; k < (r === 0 ? 1 : 16); k++) {
      const a = (k / 16) * 2 * Math.PI;
      const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
      const y = standAt(world, x, z, w.feet, env);
      if (y !== null) return { ...w, x, z, feet: y };
    }
  }
  return null;
}

export function chooseWalkApartment(layout: ComplexLayout, selected: string | null, building: string | null, floor: number | null): ApartmentGeom | null {
  const supported = layout.apartments.filter((a) => layout.buildings.some((b) => b.id === a.building && b.supportsPlan));
  return supported.find((a) => a.id === selected) ?? supported.find((a) => (!building || a.building === building) && (floor === null || a.floor === floor)) ?? null;
}
