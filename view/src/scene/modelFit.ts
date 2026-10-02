// Fits an external model into a plan footprint (decision V20): uniform scale only, turned to its
// face, centred on the footprint and standing on the 0.12 m slab. Plan frame: x = u, z = v.
import * as THREE from 'three';
import type { Face, ModelPiece } from '../domain/furnitureModels';
import type { ApartmentGeom, BuildingGeom } from '../domain/layout';
import { PLINTH_M } from '../domain/plan';
import { planLocal } from './geom';

export const SLAB_M = 0.12;

/** Yaw turning a model whose front is +z in its file towards the given plan direction. */
export const FACE_YAW: Record<Face, number> = { '+v': 0, '-v': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };

export interface Fit {
  /** Model space → plan frame, in metres. */
  matrix: THREE.Matrix4;
  /** Height of the top of the fitted model. */
  top: number;
}

export function fitModel(bounds: THREE.Box3, piece: ModelPiece, baseY = SLAB_M): Fit {
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const quarter = piece.face === '+u' || piece.face === '-u';
  const [sx, sz] = quarter ? [size.z, size.x] : [size.x, size.z];
  let s = Math.min((piece.u1 - piece.u0) / sx, (piece.v1 - piece.v0) / sz);
  if (piece.maxH !== undefined) s = Math.min(s, piece.maxH / size.y);
  const matrix = new THREE.Matrix4()
    .makeTranslation((piece.u0 + piece.u1) / 2, baseY, (piece.v0 + piece.v1) / 2)
    .multiply(new THREE.Matrix4().makeRotationY(FACE_YAW[piece.face]))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z));
  return { matrix, top: baseY + s * size.y };
}

/** Fits the pieces of one furniture item in order; stacked pieces stand on the previous one. */
export function fitItem(pieces: readonly ModelPiece[], boundsOf: (model: string) => THREE.Box3): (Fit & { piece: ModelPiece })[] {
  const out: (Fit & { piece: ModelPiece })[] = [];
  for (const piece of pieces) {
    const base = piece.stacked && out.length > 0 ? out[out.length - 1].top : SLAB_M;
    out.push({ piece, ...fitModel(boundsOf(piece.model), piece, base) });
  }
  return out;
}

/**
 * Plan frame → world for one apartment. Positions follow the building's plan scale while the
 * models keep their own proportions; interno 2 is interno 1 turned by 180°.
 */
export function apartmentMatrix(b: BuildingGeom, apt: ApartmentGeom, u: number, v: number): THREE.Matrix4 {
  const [x, z] = planLocal(b, u, v, apt.mirrored);
  return new THREE.Matrix4().makeTranslation(b.center.x, 0, b.center.z)
    .multiply(new THREE.Matrix4().makeRotationY(b.rotationY))
    .multiply(new THREE.Matrix4().makeTranslation(x, PLINTH_M + apt.floor * b.floorHeight, z))
    .multiply(new THREE.Matrix4().makeRotationY(apt.mirrored ? Math.PI : 0))
    .multiply(new THREE.Matrix4().makeTranslation(-u, 0, -v));
}
