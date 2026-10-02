// Labels follow what the eye can see (view spec §8.4): a label hides when an opaque part of a
// building stands between the camera and its anchor.
import * as THREE from 'three';

/** Surfaces this close to the anchor (the wall a sensor hangs on) never hide its label. */
export const ANCHOR_MARGIN_M = 0.3;

/** Opaque, visible, non-instanced meshes: ghost floors, faded buildings and glass do not hide. */
export function isOccluder(o: THREE.Object3D): boolean {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.some((m) => m.transparent || m.opacity < 1)) return false;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Whether something opaque among `occluders` (searched recursively) lies between `eye` and `anchor`. */
export function labelOccluded(ray: THREE.Raycaster, eye: THREE.Vector3, anchor: THREE.Vector3,
  occluders: THREE.Object3D[]): boolean {
  const dir = anchor.clone().sub(eye);
  const distance = dir.length();
  if (distance <= ANCHOR_MARGIN_M) return false;
  ray.set(eye, dir.divideScalar(distance));
  ray.near = 0;
  ray.far = distance - ANCHOR_MARGIN_M;
  // Reject invisible/instanced/glazed objects before raycasting, not after expensive hits.
  const opaque: THREE.Object3D[] = [];
  for (const root of occluders) root.traverse((o) => { if (isOccluder(o)) opaque.push(o); });
  return ray.intersectObjects(opaque, false).length > 0;
}

const ORTHO_BACK_M = 400;

/** Where the sight line to `anchor` starts: the camera, or straight back along the view in 2D. */
export function labelEye(camera: THREE.Camera, anchor: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  if (!(camera as THREE.OrthographicCamera).isOrthographicCamera) return out.copy(camera.position);
  return camera.getWorldDirection(out).multiplyScalar(-ORTHO_BACK_M).add(anchor);
}

const FACADE_OUT_M = 0.35;

/**
 * The middle of each side of a unit's volume, just outside it: an apartment label shows while one
 * of its facades is in sight (its centre, inside the volume, is hidden even by the floor above).
 */
export function facadePoints(box: THREE.Box3): THREE.Vector3[] {
  const c = box.getCenter(new THREE.Vector3());
  return [
    new THREE.Vector3(box.min.x - FACADE_OUT_M, c.y, c.z), new THREE.Vector3(box.max.x + FACADE_OUT_M, c.y, c.z),
    new THREE.Vector3(c.x, c.y, box.min.z - FACADE_OUT_M), new THREE.Vector3(c.x, c.y, box.max.z + FACADE_OUT_M),
  ];
}
