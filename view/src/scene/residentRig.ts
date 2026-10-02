// Lifetime of one animated resident (V20): what a clone owns and must free when it leaves.
import * as THREE from 'three';

/**
 * Stops the resident's animation and frees what the clone owns: its skeletons and their bone
 * textures. Geometry and materials are shared with the loaded model and stay alive.
 */
export function releaseResident(root: THREE.Object3D, mixer: THREE.AnimationMixer): void {
  mixer.stopAllAction();
  mixer.uncacheRoot(mixer.getRoot());
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((o as THREE.SkinnedMesh).skeleton); });
  for (const s of skeletons) s.dispose();
  root.removeFromParent();
}
