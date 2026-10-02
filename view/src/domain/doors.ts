// Swinging doors of the first person (V21): scenery of the view, not MQTT devices. Plan metres of
// the building (interno 2 already rotated by 180°), one leaf or two per doorway.
import type { ApartmentGeom, BuildingGeom } from './layout';
import { DOOR_OPENINGS } from './interior';
import { BALCONY_DOOR, ENTRY_DOOR, PLAN_D, PLAN_W, type PlanRect, type PlanWindow } from './plan';

export type DoorKind = 'interior' | 'entry' | 'balcony' | 'portone';
export interface DoorSpec {
  id: string; building: string; floor: number; unitId: string; kind: DoorKind;
  /** 'u': the wall runs along u at v = at; 'v': along v at u = at. */
  axis: 'u' | 'v'; at: number; a0: number; a1: number;
  leaves: 1 | 2; hinge: 'a0' | 'a1';
  /** Side of the wall the leaves turn towards: sign of the perpendicular coordinate. */
  swing: 1 | -1;
  locked: boolean; defaultOpen: boolean;
}

export { BALCONY_DOOR };
export const DOOR_OPEN_S = 0.6;
const PORTONE = { a0: 13.1, a1: 15.4 };
const WALL_HALF = 0.1;

type LocalDoor = Pick<DoorSpec, 'axis' | 'at' | 'a0' | 'a1' | 'hinge' | 'swing' | 'kind' | 'defaultOpen'> & { name: string };

const ROOM_NAMES = ['living', 'bedroom', 'bedroom2', 'bath', 'bath2'] as const;
const ROOM_DOORS: Pick<LocalDoor, 'hinge' | 'swing'>[] = [
  { hinge: 'a0', swing: 1 }, { hinge: 'a1', swing: 1 }, { hinge: 'a0', swing: -1 }, { hinge: 'a0', swing: -1 }, { hinge: 'a0', swing: -1 },
];

/** The 7 doors of interno 1. */
const APARTMENT_DOORS: LocalDoor[] = [
  ...DOOR_OPENINGS.map((o, i): LocalDoor => ({
    name: ROOM_NAMES[i], kind: 'interior', axis: 'u', at: o.v, a0: o.u0, a1: o.u1, ...ROOM_DOORS[i], defaultOpen: true,
  })),
  { name: 'entry', kind: 'entry', axis: 'v', at: ENTRY_DOOR.u, a0: ENTRY_DOOR.v0, a1: ENTRY_DOOR.v1, hinge: 'a0', swing: -1, defaultOpen: false },
  { name: 'balcony', kind: 'balcony', axis: 'u', at: PLAN_D, a0: BALCONY_DOOR.u0, a1: BALCONY_DOOR.u1, hinge: 'a0', swing: -1, defaultOpen: false },
];

function rotated(d: LocalDoor): LocalDoor {
  const across = d.axis === 'u' ? PLAN_D : PLAN_W;
  const along = d.axis === 'u' ? PLAN_W : PLAN_D;
  return {
    ...d, at: across - d.at, a0: along - d.a1, a1: along - d.a0,
    hinge: d.hinge === 'a0' ? 'a1' : 'a0', swing: d.swing === 1 ? -1 : 1,
  };
}

/** All doors of a building with the typical plan; none without it. */
export function buildingDoors(b: BuildingGeom, apartments: ApartmentGeom[]): DoorSpec[] {
  if (!b.supportsPlan) return [];
  const out: DoorSpec[] = [];
  for (const apt of apartments) {
    for (const local of APARTMENT_DOORS) {
      const { name, ...d } = apt.mirrored ? rotated(local) : local;
      out.push({ ...d, id: `${apt.id}:${name}`, building: b.id, floor: apt.floor, unitId: apt.id, leaves: 1, locked: false });
    }
  }
  const core = { building: b.id, floor: 0, unitId: `${b.id}-S`, kind: 'portone' as const, axis: 'u' as const, ...PORTONE, leaves: 2 as const, hinge: 'a0' as const, defaultOpen: false };
  out.push({ ...core, id: `${b.id}:park`, at: PLAN_D, swing: -1, locked: false });
  // The street side of the core is taken by the stairs: that portone stays locked (V21, A5).
  out.push({ ...core, id: `${b.id}:street`, at: 0, swing: 1, locked: true });
  return out;
}

export interface Leaf { hu: number; hv: number; eu: number; ev: number }

/** Hinge and free end of each leaf for an openness in 0…1 (1 = turned by 90°). */
export function doorLeaves(d: DoorSpec, openness: number): Leaf[] {
  const t = Math.max(0, Math.min(1, openness)) * Math.PI / 2;
  const leaf = (hinge: number, dir: 1 | -1, length: number): Leaf => {
    const along = dir * Math.cos(t) * length, across = d.swing * Math.sin(t) * length;
    return d.axis === 'u'
      ? { hu: hinge, hv: d.at, eu: hinge + along, ev: d.at + across }
      : { hu: d.at, hv: hinge, eu: d.at + across, ev: hinge + along };
  };
  const width = d.a1 - d.a0;
  if (d.leaves === 2) return [leaf(d.a0, 1, width / 2), leaf(d.a1, -1, width / 2)];
  return [d.hinge === 'a0' ? leaf(d.a0, 1, width) : leaf(d.a1, -1, width)];
}

/** The doorway in the wall, as thick as the wall: what a closed door blocks. */
export function doorBox(d: DoorSpec): PlanRect {
  return d.axis === 'u'
    ? { u0: d.a0, u1: d.a1, v0: d.at - WALL_HALF, v1: d.at + WALL_HALF }
    : { u0: d.at - WALL_HALF, u1: d.at + WALL_HALF, v0: d.a0, v1: d.a1 };
}

export function isPassable(openness: number): boolean {
  return openness >= 0.6;
}

export interface PlanPoint { u: number; v: number; floor: number }

function center(d: DoorSpec): { u: number; v: number } {
  const mid = (d.a0 + d.a1) / 2;
  return d.axis === 'u' ? { u: mid, v: d.at } : { u: d.at, v: mid };
}

/** The door to act on with E: on the same floor, within reach and within 60° of the gaze. */
export function pickDoor(doors: DoorSpec[], p: PlanPoint, yaw: number, maxDist = 1.6): DoorSpec | null {
  const fu = Math.sin(yaw), fv = Math.cos(yaw);
  let best: DoorSpec | null = null, bestDist = Infinity;
  for (const d of doors) {
    if (d.floor !== p.floor) continue;
    const c = center(d);
    const du = c.u - p.u, dv = c.v - p.v, dist = Math.hypot(du, dv);
    if (dist > maxDist || dist >= bestDist) continue;
    if (dist > 0.3 && (du * fu + dv * fv) / dist < Math.cos(Math.PI / 3)) continue;
    best = d; bestDist = dist;
  }
  return best;
}

/** False while the walker stands in the doorway or where the leaves sweep. */
export function canClose(d: DoorSpec, p: PlanPoint, radius: number): boolean {
  if (p.floor !== d.floor) return true;
  const depth = (d.a1 - d.a0) / d.leaves;
  const box = doorBox(d);
  const far = d.at + d.swing * depth;
  const r: PlanRect = d.axis === 'u'
    ? { u0: box.u0, u1: box.u1, v0: Math.min(box.v0, far), v1: Math.max(box.v1, far) }
    : { u0: Math.min(box.u0, far), u1: Math.max(box.u1, far), v0: box.v0, v1: box.v1 };
  const gap = Math.hypot(Math.max(r.u0 - p.u, 0, p.u - r.u1), Math.max(r.v0 - p.v, 0, p.v - r.v1));
  return gap >= radius;
}

/** The open building after a door toggles (V21 §2.3): one building at most. */
export function nextOpenBuilding(current: string | null, doorId: string, nowOpen: boolean, outdoors: boolean): string | null {
  const [owner, name] = doorId.split(':');
  if (name !== 'park') return current;
  if (nowOpen) return owner;
  return owner === current && outdoors ? null : current;
}

/** Spans of the `window` sashes in a window: the french window leaves room for the balcony door. */
export function sashSpans(w: PlanWindow): [number, number][] {
  if (!w.tall || w.unit !== 'apt1') return [[w.u0, w.u1]];
  return [[w.u0, BALCONY_DOOR.u0], [BALCONY_DOOR.u1, w.u1]];
}
