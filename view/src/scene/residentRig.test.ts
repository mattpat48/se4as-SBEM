import * as THREE from 'three';
import { releaseResident } from './residentRig';

function skinnedResident() {
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  skeleton.computeBoneTexture();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(skeleton);
  const model = new THREE.Group().add(mesh);
  const root = new THREE.Group().add(model);
  return { root, model, mesh, skeleton };
}

test('releasing a resident frees its own bone texture, detaches it and keeps the shared geometry and material', () => {
  const { root, model, mesh, skeleton } = skinnedResident();
  const parent = new THREE.Group().add(root);
  const mixer = new THREE.AnimationMixer(model);
  let texturesFreed = 0, sharedFreed = 0;
  skeleton.boneTexture!.addEventListener('dispose', () => texturesFreed++);
  mesh.geometry.addEventListener('dispose', () => sharedFreed++);
  (mesh.material as THREE.Material).addEventListener('dispose', () => sharedFreed++);

  releaseResident(root, mixer);

  expect(texturesFreed).toBe(1);
  expect(skeleton.boneTexture).toBeNull();
  expect(sharedFreed).toBe(0);
  expect(root.parent).toBeNull();
  expect(parent.children).toHaveLength(0);
});
