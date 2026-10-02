// The walkable world of the first person (V21 §3.2): surfaces to stand on and obstacles, in the
// plan metres of each building (open or solid) and in world metres outdoors. Pure, no rendering.
import { buildingDoors, doorBox, isPassable, type DoorSpec } from './doors';
import { FURNITURE } from './furniture';
import type { BuildingGeom, ComplexLayout } from './layout';
import {
  BALCONY, BALCONY_DOOR, ENTRY_DOOR, INTERIOR_WALLS, LIFT, PLAN_D, PLAN_W, PLINTH_M, mirror, type PlanRect,
} from './plan';
import { CORE_SLAB_M, STAIR_DIVIDER, stairSteps } from './stairs';
import { gardenPlan, type GardenObstacle } from './garden';
import { treeSpecs, trunkRadius } from './trees';

/** Height of the apartment floor slab above the storey (as the furniture and residents use). */
export const APT_SLAB_M = 0.12;
export const RAILING_M = 1.1;
/** The walker's body, above the feet: low steps and thresholds are not obstacles. */
export const BODY_FROM_M = 0.4;
export const BODY_TO_M = 1.7;
export const GROUND_HALF_M = 98;
const FOUNTAIN_R = 3.4;
const PARK_LAWN_M = 0.2;
const PORTONE_RAMP: PlanRect = { u0: 13.1, u1: 15.4, v0: PLAN_D, v1: PLAN_D + 1.2 };

export interface Box extends PlanRect { y0: number; y1: number }
/** Flat at `y`, or a ramp from `y` at v0 to `yEnd` at v1. */
export interface Surface extends PlanRect { y: number; yEnd?: number }
export interface Circle { x: number; z: number; r: number }
export interface BuildingWalk { b: BuildingGeom; open: boolean; boxes: Box[]; surfaces: Surface[]; doors: DoorSpec[]; reach: number }
export interface WalkWorld { outdoorBoxes: GardenObstacle[]; buildings: BuildingWalk[]; circles: Circle[]; lawn: { x0: number; x1: number; z0: number; z1: number } }
/** Live state the walls depend on: door openness (0…1) and the blinds of an apartment (0…1 covered). */
export interface WalkEnv { doorOpenness(door: DoorSpec): number; blindsCover(aptId: string): number }

type Seg = [number, number, number, number];

/** Walls of interno 1 with the door gaps; windows count as wall. */
const APARTMENT_WALLS: Seg[] = [
  ...INTERIOR_WALLS,
  [0, 0, 10.5, 0], [0, 0, 0, PLAN_D],
  [0, PLAN_D, BALCONY_DOOR.u0, PLAN_D], [BALCONY_DOOR.u1, PLAN_D, 10.5, PLAN_D],
  [10.5, 0, 10.5, ENTRY_DOOR.v0], [10.5, ENTRY_DOOR.v1, 10.5, PLAN_D],
];
const RAILINGS: Seg[] = [
  [BALCONY.u0, BALCONY.v1, BALCONY.u1, BALCONY.v1], [BALCONY.u0, BALCONY.v0, BALCONY.u0, BALCONY.v1], [BALCONY.u1, BALCONY.v0, BALCONY.u1, BALCONY.v1],
];
const APT1: PlanRect = { u0: 0, u1: 10.5, v0: 0, v1: PLAN_D };
const LANDING_FLOOR: PlanRect = { u0: 10.5, u1: 15.5, v0: 4.5, v1: PLAN_D };

function segRect([u0, v0, u1, v1]: Seg, half: number): PlanRect {
  return { u0: Math.min(u0, u1) - half, u1: Math.max(u0, u1) + half, v0: Math.min(v0, v1) - half, v1: Math.max(v0, v1) + half };
}
function rotated(r: PlanRect): PlanRect {
  const [u0, v0] = mirror(r.u1, r.v1);
  const [u1, v1] = mirror(r.u0, r.v0);
  return { u0, u1, v0, v1 };
}
const bothInterni = (r: PlanRect): PlanRect[] => [r, rotated(r)];

function solidBuilding(b: BuildingGeom): Pick<BuildingWalk, 'boxes' | 'surfaces'> {
  const top = PLINTH_M + b.floors * b.floorHeight + 2;
  return {
    boxes: [
      { u0: 0, u1: PLAN_W, v0: 0, v1: PLAN_D, y0: 0, y1: top },
      ...bothInterni(BALCONY).map((r) => ({ ...r, y0: 0, y1: PLINTH_M + RAILING_M })),
    ],
    surfaces: [],
  };
}

function openBuilding(b: BuildingGeom): Pick<BuildingWalk, 'boxes' | 'surfaces'> {
  const boxes: Box[] = [], surfaces: Surface[] = [];
  const fh = b.floorHeight;
  const steps = stairSteps(fh);
  for (let f = 0; f < b.floors; f++) {
    const y0 = PLINTH_M + f * fh, y1 = y0 + fh;
    const wall = (r: PlanRect, top = y1) => boxes.push({ ...r, y0, y1: top });
    for (const s of APARTMENT_WALLS) bothInterni(segRect(s, 0.1)).forEach((r) => wall(r));
    for (const s of RAILINGS) bothInterni(segRect(s, 0.05)).forEach((r) => wall(r, y0 + RAILING_M));
    for (const item of FURNITURE) {
      if (item.kind === 'rug' || (item.room === 'balcony' && f === 0)) continue;
      bothInterni(item).forEach((r) => wall(r));
    }
    // Core: the street side is wall (its portone is locked); the park side opens on the ground floor.
    wall(segRect([10.5, 0, 15.5, 0], 0.1));
    if (f === 0) { wall(segRect([10.5, PLAN_D, 13.1, PLAN_D], 0.1)); wall(segRect([15.4, PLAN_D, 15.5, PLAN_D], 0.1)); }
    else wall(segRect([10.5, PLAN_D, 15.5, PLAN_D], 0.1));
    wall(LIFT);
    wall(STAIR_DIVIDER);

    bothInterni(APT1).forEach((r) => surfaces.push({ ...r, y: y0 + APT_SLAB_M }));
    bothInterni(BALCONY).forEach((r) => surfaces.push({ ...r, y: y0 }));
    surfaces.push({ ...LANDING_FLOOR, y: y0 + CORE_SLAB_M });
    if (f < b.floors - 1) for (const s of steps) surfaces.push({ u0: s.u0, u1: s.u1, v0: s.v0, v1: s.v1, y: y0 + s.top });
  }
  return { boxes, surfaces };
}

export function buildingWalk(b: BuildingGeom, open: boolean, doors: DoorSpec[]): BuildingWalk {
  const parts = open && b.supportsPlan ? openBuilding(b) : solidBuilding(b);
  // Outside the park portone: three steps up the plinth, a ramp for the feet.
  parts.surfaces.push({ ...PORTONE_RAMP, y: PLINTH_M + CORE_SLAB_M, yEnd: 0 });
  return { b, open: open && b.supportsPlan, ...parts, doors, reach: Math.hypot(b.width, b.depth) / 2 + 3 };
}

export function buildWalkWorld(layout: ComplexLayout, openBuildingId: string | null): WalkWorld {
  const buildings = layout.buildings.map((b) => buildingWalk(b, b.id === openBuildingId,
    buildingDoors(b, layout.apartments.filter((a) => a.building === b.id))));
  const pole = (p: { x: number; z: number }, r: number): Circle => ({ x: p.x, z: p.z, r });
  const circles: Circle[] = [
    ...treeSpecs(layout).map((t) => pole(t, trunkRadius(t))),
    pole(layout.park.center, FOUNTAIN_R),
    ...layout.chargers.map((c) => pole(c.position, 0.3)),
    ...layout.parkFixtures.lamps.map((p) => pole(p, 0.12)),
    pole(layout.parkFixtures.station, 0.1),
    ...layout.parkFixtures.signs.map((p) => pole(p, 0.06)),
  ];
  const garden = gardenPlan(layout);
  const { center, width, depth } = garden.core;
  return { outdoorBoxes: garden.obstacles, buildings, circles, lawn: { x0: center.x - width / 2, x1: center.x + width / 2, z0: center.z - depth / 2, z1: center.z + depth / 2 } };
}

/** World → unrotated plan metres of a building (same transform as `worldToPlan`). */
export function toPlan(b: BuildingGeom, x: number, z: number): { u: number; v: number } {
  const dx = x - b.center.x, dz = z - b.center.z;
  const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
  return { u: (dx * c - dz * s) * PLAN_W / b.width + PLAN_W / 2, v: (dx * s + dz * c) * PLAN_D / b.depth + PLAN_D / 2 };
}

const contains = (r: PlanRect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
const gap = (r: PlanRect, u: number, v: number) => Math.hypot(Math.max(r.u0 - u, 0, u - r.u1), Math.max(r.v0 - v, 0, v - r.v1));

function surfaceY(s: Surface, v: number): number {
  if (s.yEnd === undefined) return s.y;
  const t = Math.max(0, Math.min(1, (v - s.v0) / (s.v1 - s.v0)));
  return s.y + (s.yEnd - s.y) * t;
}

/** Heights of every walkable surface under a world point. */
export function surfacesAt(world: WalkWorld, x: number, z: number): number[] {
  if (!(Math.abs(x) <= GROUND_HALF_M && Math.abs(z) <= GROUND_HALF_M)) return [];
  const { lawn } = world;
  const out = [x >= lawn.x0 && x <= lawn.x1 && z >= lawn.z0 && z <= lawn.z1 ? PARK_LAWN_M : 0];
  for (const bw of world.buildings) {
    if (Math.hypot(x - bw.b.center.x, z - bw.b.center.z) > bw.reach) continue;
    const { u, v } = toPlan(bw.b, x, z);
    for (const s of bw.surfaces) if (contains(s, u, v)) out.push(surfaceY(s, v));
  }
  return out;
}

/** True when a walker of radius `r` with its feet at `feet` would touch an obstacle there. */
export function blockedAt(world: WalkWorld, x: number, z: number, feet: number, r: number, env: WalkEnv): boolean {
  const lo = feet + BODY_FROM_M, hi = feet + BODY_TO_M;
  const overlaps = (y0: number, y1: number) => y0 < hi && y1 > lo;
  if (overlaps(0, 3)) for (const c of world.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  for (const o of world.outdoorBoxes) {
    if (!overlaps(0, o.height)) continue;
    const dx=x-o.x,dz=z-o.z,c=Math.cos(o.angle),s=Math.sin(o.angle);
    const u=dx*c-dz*s,v=dx*s+dz*c;
    if (Math.hypot(Math.max(Math.abs(u)-o.width/2,0),Math.max(Math.abs(v)-o.depth/2,0)) < r) return true;
  }
  for (const bw of world.buildings) {
    if (Math.hypot(x - bw.b.center.x, z - bw.b.center.z) > bw.reach) continue;
    const { u, v } = toPlan(bw.b, x, z);
    for (const box of bw.boxes) if (overlaps(box.y0, box.y1) && gap(box, u, v) < r) return true;
    for (const d of bw.doors) {
      if (!bw.open && d.kind !== 'portone') continue;
      const y0 = PLINTH_M + d.floor * bw.b.floorHeight;
      if (!overlaps(y0, y0 + bw.b.floorHeight) || gap(doorBox(d), u, v) >= r) continue;
      const shut = d.locked || !isPassable(env.doorOpenness(d));
      const blind = d.kind === 'balcony' && env.blindsCover(d.unitId) > 0.2;
      if (shut || blind) return true;
    }
  }
  return false;
}
