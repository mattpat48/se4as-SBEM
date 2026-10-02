// Visual mounting positions (V20). Telemetry IDs and the original model contract stay intact.
import { APARTMENT_PLACEMENTS } from './placement';
import type { RoomId } from './plan';
export const CUT_DEVICE_CEILING = 1.25; // Stairwell fixtures retain their existing convention.
export interface DevicePose { u: number; v: number; h: number; rotationY: number }
const WALL_MOUNTS: Record<string, DevicePose> = {
  temperature: {u:.123,v:7.2,h:1.5,rotationY:Math.PI/2},
  humidity: {u:.123,v:7.6,h:1.5,rotationY:Math.PI/2},
  co2: {u:3.2,v:6.625,h:1.5,rotationY:0},
  occupancy: {u:6.385,v:9.6,h:2.35,rotationY:-Math.PI/2},
  light: {u:6.17,v:11.883,h:1.2,rotationY:Math.PI},
  smoke: {u:.14,v:11,h:2.65,rotationY:Math.PI/2},
  gas: {u:.14,v:8.6,h:2.6,rotationY:Math.PI/2},
  co: {u:6.38,v:1,h:1.7,rotationY:-Math.PI/2},
  noise_level: {u:6.62,v:10.8,h:1.6,rotationY:Math.PI/2},
  power: {u:10.36,v:3.4,h:1.4,rotationY:-Math.PI/2},
  water_flow: {u:10.36,v:3.7,h:1.4,rotationY:-Math.PI/2},
  gas_flow: {u:10.36,v:4,h:1.4,rotationY:-Math.PI/2},
  hvac: {u:3,v:6.72,h:2.4,rotationY:0},
  ventilation: {u:4.13,v:.6,h:2.4,rotationY:Math.PI/2},
  alarm: {u:9.4,v:6.36,h:2.4,rotationY:Math.PI},
  resident_display: {u:10.381,v:5.9,h:1.5,rotationY:-Math.PI/2},
};
export function apartmentDevicePose(type: string, immersive=false): DevicePose|null {
  const p = APARTMENT_PLACEMENTS[type];
  if (!p || !('room' in p)) return null;
  const wall = WALL_MOUNTS[type];
  if (wall) return {...wall,h:immersive ? wall.h : Math.min(wall.h,.9)};
  return {u:p.u,v:p.v,h:typeof p.h==='number' ? p.h : CUT_DEVICE_CEILING,rotationY:0};
}
export const ROOM_LIGHTS: (DevicePose & {room: RoomId})[] = [
  {room:'living',u:2.2,v:6.66,h:2.1,rotationY:0},
  {room:'bedroom',u:7.1,v:6.66,h:2.1,rotationY:0},
  {room:'bedroom2',u:3.84,v:2.7,h:2.1,rotationY:-Math.PI/2},
  {room:'bath',u:5.95,v:2.84,h:2.1,rotationY:Math.PI},
  {room:'bath2',u:9.5,v:2.84,h:2.1,rotationY:Math.PI},
  {room:'hall',u:7,v:6.34,h:2.1,rotationY:Math.PI},
];
