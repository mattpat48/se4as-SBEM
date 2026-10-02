// Camera helpers (view spec §8.1, §8.2, §8.8).
import type { BuildingGeom, Vec3 } from './layout';
import { PLINTH_M } from './plan';

export const CAMERA_LIMITS = { minDistance: 2, maxDistance: 350, maxPolarAngle: Math.PI * 0.47 };
export const MINIMAP_SIZE_PX = 200;
export const MINIMAP_EXTENT_M = 92;

const FOCUS_BACK_M = 60;
const FOCUS_UP_M = 40;

/** Look at the building's centre from 60 m out on its side 1 and 40 m up. */
export function focusOnBuilding(b: BuildingGeom): { position: Vec3; target: Vec3 } {
  const target = { x: b.center.x, y: PLINTH_M + b.floors * b.floorHeight / 2, z: b.center.z };
  const dx = Math.sin(b.rotationY), dz = Math.cos(b.rotationY);
  return {
    target,
    position: { x: target.x + FOCUS_BACK_M * dx, y: target.y + FOCUS_UP_M, z: target.z + FOCUS_BACK_M * dz },
  };
}

/** Minimap pixel (origin top-left, north up) → world ground point. */
export function minimapToWorld(px: number, py: number, sizePx: number, extentM: number): { x: number; z: number } {
  return { x: -extentM + (px / sizePx) * 2 * extentM, z: -extentM + (py / sizePx) * 2 * extentM };
}
