// Where each device sits (view spec §7.3). Apartment positions are for interno 1,
// in plan metres, with height from the floor ('ceiling' = floor height − 0.3).
import { ANDRONE, LIFT, PARAPET_M, type RoomId } from './plan';

export type ApartmentPlacement =
  | { room: RoomId; u: number; v: number; h: number | 'ceiling' }
  | { distributed: 'windows' | 'rooms' };

export const APARTMENT_PLACEMENTS: Record<string, ApartmentPlacement> = {
  temperature: { room: 'living', u: 0.1, v: 7.2, h: 1.5 },
  humidity: { room: 'living', u: 0.1, v: 7.6, h: 1.5 },
  co2: { room: 'living', u: 3.2, v: 6.6, h: 1.5 },
  occupancy: { room: 'living', u: 3.8, v: 9.6, h: 'ceiling' },
  light: { room: 'living', u: 5.4, v: 11.8, h: 1.2 },
  smoke: { room: 'living', u: 1.8, v: 11.0, h: 'ceiling' },
  gas: { room: 'living', u: 1.0, v: 8.6, h: 'ceiling' },
  co: { room: 'bath', u: 5.8, v: 0.4, h: 1.7 },
  noise_level: { room: 'bedroom', u: 8.6, v: 10.8, h: 1.6 },
  power: { room: 'hall', u: 10.3, v: 3.4, h: 1.4 },
  water_flow: { room: 'hall', u: 10.3, v: 3.7, h: 1.4 },
  gas_flow: { room: 'hall', u: 10.3, v: 4.0, h: 1.4 },
  hvac: { room: 'living', u: 3.0, v: 6.6, h: 2.4 },
  ventilation: { room: 'bath', u: 4.7, v: 0.6, h: 'ceiling' },
  window: { distributed: 'windows' },
  blinds: { distributed: 'windows' },
  lights: { distributed: 'rooms' },
  gas_valve: { room: 'living', u: 1.0, v: 11.6, h: 0.5 },
  alarm: { room: 'hall', u: 8.2, v: 4.1, h: 'ceiling' },
  resident_display: { room: 'hall', u: 10.3, v: 5.9, h: 1.5 },
};

/** A point in a building: plan (u, v), floor, and height above that floor. */
export interface BuildingPoint { u: number; v: number; floor: number | 'top' | 'roof'; h: number | 'ceiling' }
export type BuildingDistributed = 'landings';

const center = (r: { u0: number; u1: number; v0: number; v1: number }) => ({ u: (r.u0 + r.u1) / 2, v: (r.v0 + r.v1) / 2 });

/** Stairwell devices: point, or distributed over the landings (anchor on the ground floor). */
export function stairwellPlacement(type: string): BuildingPoint & { distributed?: BuildingDistributed } {
  switch (type) {
    case 'smoke': return { u: 13, v: 2.5, floor: 'top', h: 'ceiling' };
    case 'smoke_vent': return { u: 13, v: 2.5, floor: 'roof', h: PARAPET_M };
    case 'stair_lights': return { u: 13, v: 6.5, floor: 0, h: 'ceiling', distributed: 'landings' };
    case 'evacuation_siren': return { u: 11, v: 6.5, floor: 0, h: 2.4, distributed: 'landings' };
    default: return { u: 15.3, v: 10, floor: 0, h: 1.6 };   // temperature, light, occupancy on the androne wall
  }
}

export function buildingPlacement(type: string): BuildingPoint {
  switch (type) {
    case 'pv_power': return { u: 20, v: 6, floor: 'roof', h: 0.4 };
    case 'elevator': return { ...center(LIFT), floor: 0, h: 1.2 };
    case 'battery': return { u: 14.2, v: 9, floor: 0, h: 0.8 };
    default: return { ...center(ANDRONE), floor: 0, h: 1 };
  }
}

/** Park fixtures as (east, north) offsets from the park centre in metres, before scaling. */
export const WEATHER_STATION = { e: 26, n: -21 };          // SE corner, inset 4 m
export const STATION_SENSORS = ['temperature', 'humidity', 'rain_level', 'wind_speed', 'light', 'noise_level', 'pm10', 'pm2_5'];
export const IRRIGATION_HEADS = [{ e: 18, n: 12 }, { e: -18, n: 12 }, { e: 18, n: -12 }, { e: -18, n: -12 }, { e: 0, n: 18 }, { e: 0, n: -18 }];
export const PARK_LAMPS = [{ e: 14, n: 6 }, { e: -14, n: -6 }, { e: 6, n: -14 }, { e: -6, n: 14 }, { e: -24, n: 20 }, { e: 24, n: -20 }];
export const SOIL_PROBE = { e: -10, n: 8 };

/** Park devices: height above ground, or a distributed set of fixtures. */
export function parkPlacement(type: string): { at: { e: number; n: number }; h: number } | { distributed: 'heads' | 'posts' | 'signs' } {
  const i = STATION_SENSORS.indexOf(type);
  if (i >= 0) return { at: WEATHER_STATION, h: 2.0 + 0.3 * i };
  switch (type) {
    case 'seismic': return { at: WEATHER_STATION, h: 0.3 };
    case 'soil_moisture': return { at: SOIL_PROBE, h: 0 };
    case 'irrigation': return { distributed: 'heads' };
    case 'park_lights': return { distributed: 'posts' };
    case 'evacuation_signs': return { distributed: 'signs' };
    default: return { at: { e: 0, n: 0 }, h: 1 };
  }
}

/** Evacuation sign at the park-side exit of the androne (plan coords, ground floor). */
export const ANDRONE_EXIT_SIGN = { u: (ANDRONE.u0 + ANDRONE.u1) / 2, v: 13.2 };
