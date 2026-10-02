import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT_BOX } from './materials';

export interface BoxTransform {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
}

/** Static repeated pieces become one draw, while the parent keeps its selection metadata. */
export function MergedBoxes({ boxes, material, castShadow = false, receiveShadow = true, userData }: {
  boxes: BoxTransform[]; material: THREE.Material; castShadow?: boolean; receiveShadow?: boolean;
  userData?: Record<string, unknown>;
}) {
  const geometry = useMemo(() => {
    const parts = boxes.map((box) => {
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...box.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rotation ?? [0, 0, 0]))), new THREE.Vector3(...box.scale));
      return UNIT_BOX.clone().applyMatrix4(matrix);
    });
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, [boxes]);
  useLayoutEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry ? <mesh geometry={geometry} material={material} castShadow={castShadow} receiveShadow={receiveShadow} userData={userData} dispose={null} /> : null;
}
