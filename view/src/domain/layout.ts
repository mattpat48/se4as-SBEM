// Model → scene coordinates (view spec §7.1–§7.3). Scene: X = x_m (east), Z = −y_m, Y up.
import type { ComplexModelMsg, Rect, Unit } from './messages';
import {
  ANDRONE_EXIT_SIGN, APARTMENT_PLACEMENTS, IRRIGATION_HEADS, PARK_LAMPS, buildingPlacement, parkPlacement,
  stairwellPlacement, type BuildingPoint,
} from './placement';
import { PLAN_D, PLAN_W, PLINTH_M, mirror } from './plan';

export interface Vec3 { x: number; y: number; z: number }
export interface BuildingGeom {
  id: string; center: { x: number; z: number }; rotationY: number; width: number; depth: number;
  floorHeight: number; floors: number; supportsPlan: boolean;
}
export interface ApartmentGeom { id: string; building: string; floor: number; number: number; mirrored: boolean }
export interface RectGeom { center: { x: number; z: number }; width: number; depth: number }
export type Distribution = 'windows' | 'rooms' | 'landings' | 'heads' | 'posts' | 'signs';
export interface DevicePlacement {
  deviceId: string; unitId: string; type: string; kind: 'sensor' | 'actuator';
  position: Vec3 | null; distributed?: Distribution;
}
export interface ParkFixtures { station: Vec3; irrigation: Vec3[]; lamps: Vec3[]; signs: Vec3[] }
export interface ComplexLayout {
  buildings: BuildingGeom[]; apartments: ApartmentGeom[]; park: RectGeom; parking: RectGeom;
  chargers: { id: string; position: Vec3 }[]; devices: Map<string, DevicePlacement>;
  parkFixtures: ParkFixtures; warnings: string[];
}

export type Facing = 'N' | 'S' | 'E' | 'O';

export function toScene(x_m: number, y_m: number): { x: number; z: number } {
  return { x: x_m, z: y_m === 0 ? 0 : -y_m };
}

/** Rotation about Y that turns side 1 of the plan (+Z locally) towards the given exposure. */
export function facingRotation(o: Facing): number {
  switch (o) {
    case 'S': return 0;
    case 'N': return Math.PI;
    case 'E': return Math.PI / 2;
    case 'O': return -Math.PI / 2;
  }
}

export function planToWorld(b: BuildingGeom, u: number, v: number, h: number, floor: number, mirrored: boolean): Vec3 {
  const [pu, pv] = mirrored ? mirror(u, v) : [u, v];
  const lx = (pu - PLAN_W / 2) * b.width / PLAN_W;
  const lz = (pv - PLAN_D / 2) * b.depth / PLAN_D;
  const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
  return {
    x: b.center.x + lx * c + lz * s,
    y: PLINTH_M + floor * b.floorHeight + h,
    z: b.center.z - lx * s + lz * c,
  };
}

export function worldToPlan(b: BuildingGeom, p: Vec3, mirrored: boolean): { u: number; v: number; floor: number; h: number } {
  const dx = p.x - b.center.x, dz = p.z - b.center.z;
  const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const u0 = lx * PLAN_W / b.width + PLAN_W / 2, v0 = lz * PLAN_D / b.depth + PLAN_D / 2;
  const [u, v] = mirrored ? mirror(u0, v0) : [u0, v0];
  const rel = p.y - PLINTH_M;
  const floor = Math.floor(rel / b.floorHeight + 1e-6);
  return { u, v, floor, h: rel - floor * b.floorHeight };
}

function rectGeom(r: Rect): RectGeom {
  return { center: toScene(r.x_m, r.y_m), width: r.width_m, depth: r.depth_m };
}

const FACINGS: readonly string[] = ['N', 'S', 'E', 'O'];

function buildingGeoms(m: ComplexModelMsg, warnings: string[]): BuildingGeom[] {
  const apartments = m.units.filter((u) => u.kind === 'apartment');
  return m.units.filter((u) => u.kind === 'building').map((u) => {
    const lay = u.attrs.layout ?? {};
    const floors: number = u.attrs.floors ?? 0;
    const first = apartments.find((a) => a.id === `${u.id}-0-1`);
    const facing = FACINGS.includes(first?.attrs.orientation) ? (first!.attrs.orientation as Facing) : 'S';
    const rotationY = facingRotation(facing);
    const deg = (((lay.rotation_deg ?? 0) % 360) + 360) % 360;
    const alongX = Math.abs(Math.cos(rotationY)) > 0.5;
    if (!((deg === 0 || deg === 180) && alongX) && !((deg === 90 || deg === 270) && !alongX))
      warnings.push(`${u.id}: rotation_deg ${lay.rotation_deg} non coerente con l'esposizione ${facing}`);
    const own = apartments.filter((a) => a.attrs.building === u.id);
    let supportsPlan = floors > 0;
    for (let f = 0; f < floors; f++) {
      const numbers = own.filter((a) => a.attrs.floor === f).map((a) => a.attrs.number).sort();
      if (numbers.length !== 2 || numbers[0] !== 1 || numbers[1] !== 2) supportsPlan = false;
    }
    if (own.some((a) => a.attrs.floor >= floors)) supportsPlan = false;
    if (!supportsPlan) warnings.push(`${u.id}: pianta tipo non applicabile, uso blocchi`);
    return {
      id: u.id, center: toScene(lay.x_m ?? 0, lay.y_m ?? 0), rotationY,
      width: lay.width_m ?? PLAN_W, depth: lay.depth_m ?? PLAN_D, floorHeight: lay.floor_height_m ?? 3.2,
      floors, supportsPlan,
    };
  });
}

function pointInBuilding(b: BuildingGeom, p: BuildingPoint): Vec3 {
  const floor = p.floor === 'top' ? b.floors - 1 : p.floor === 'roof' ? b.floors : p.floor;
  const h = p.h === 'ceiling' ? b.floorHeight - 0.3 : p.h;
  return planToWorld(b, p.u, p.v, h, floor, false);
}

export function buildComplexLayout(m: ComplexModelMsg): ComplexLayout {
  const warnings: string[] = [];
  const buildings = buildingGeoms(m, warnings);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const park = rectGeom(m.layouts.park);
  const parking = rectGeom(m.layouts.parking);
  const devices = new Map<string, DevicePlacement>();
  const kindOf = (type: string) => (m.device_types[type]?.kind === 'actuator' ? 'actuator' : 'sensor') as 'sensor' | 'actuator';
  const put = (u: Unit, type: string, position: Vec3 | null, distributed?: Distribution) => {
    const d: DevicePlacement = { deviceId: `${u.id}.${type}`, unitId: u.id, type, kind: kindOf(type), position };
    if (distributed) d.distributed = distributed;
    devices.set(d.deviceId, d);
  };

  const parkPoint = (at: { e: number; n: number }, h: number): Vec3 => ({
    x: park.center.x + at.e * park.width / 60, y: h, z: park.center.z - at.n * park.depth / 50,
  });
  const parkFixtures: ParkFixtures = {
    station: parkPoint({ e: 26, n: -21 }, 0),
    irrigation: IRRIGATION_HEADS.map((p) => parkPoint(p, 0)),
    lamps: PARK_LAMPS.map((p) => parkPoint(p, 0)),
    signs: [
      ...buildings.map((b) => planToWorld(b, ANDRONE_EXIT_SIGN.u, ANDRONE_EXIT_SIGN.v, 0, 0, false)),
      parkPoint({ e: 0, n: 0 }, 0),
    ],
  };
  parkFixtures.signs.forEach((p) => { p.y = 0; });

  const chargerUnits = m.units.filter((u) => u.kind === 'charger').sort((a, b) => a.id.localeCompare(b.id));
  const chargers = chargerUnits.map((u, i) => ({
    id: u.id,
    position: {
      x: parking.center.x - parking.width / 2 + (i + 0.5) * parking.width / chargerUnits.length,
      y: 0,
      z: parking.center.z - parking.depth / 2 + 2,
    },
  }));

  const apartments: ApartmentGeom[] = [];
  for (const u of m.units) {
    const b = byId.get(u.attrs.building ?? u.id);
    const types = [...u.sensors, ...u.actuators];
    if (u.kind === 'apartment' && b) {
      const apt: ApartmentGeom = { id: u.id, building: b.id, floor: u.attrs.floor, number: u.attrs.number, mirrored: u.attrs.number === 2 };
      apartments.push(apt);
      for (const type of types) {
        const pl = APARTMENT_PLACEMENTS[type];
        if (!b.supportsPlan || !pl) { put(u, type, null); continue; }
        if ('distributed' in pl) {
          const anchor = pl.distributed === 'windows' ? { u: 3.3, v: 12, h: 1.2 } : { u: 3.25, v: 9.25, h: b.floorHeight - 0.3 };
          put(u, type, planToWorld(b, anchor.u, anchor.v, anchor.h, apt.floor, apt.mirrored), pl.distributed);
        } else {
          const h = pl.h === 'ceiling' ? b.floorHeight - 0.3 : pl.h;
          put(u, type, planToWorld(b, pl.u, pl.v, h, apt.floor, apt.mirrored));
        }
      }
    } else if (u.kind === 'stairwell' && b) {
      for (const type of types) {
        const pl = stairwellPlacement(type);
        put(u, type, pointInBuilding(b, pl), pl.distributed);
      }
    } else if (u.kind === 'building' && b) {
      for (const type of types) put(u, type, pointInBuilding(b, buildingPlacement(type)));
    } else if (u.kind === 'park') {
      for (const type of types) {
        const pl = parkPlacement(type);
        if ('distributed' in pl) {
          const set = pl.distributed === 'heads' ? parkFixtures.irrigation : pl.distributed === 'posts' ? parkFixtures.lamps : parkFixtures.signs;
          put(u, type, { ...set[set.length - 1] }, pl.distributed);
        } else {
          put(u, type, parkPoint(pl.at, pl.h));
        }
      }
    } else if (u.kind === 'charger') {
      const c = chargers.find((ch) => ch.id === u.id)!;
      for (const type of types) put(u, type, { ...c.position, y: 1.2 });
    } else {
      for (const type of types) put(u, type, null);
    }
  }

  return { buildings, apartments, park, parking, chargers, devices, parkFixtures, warnings };
}
