// People silhouettes (view spec §7.5): apartments of the cut floor from `occupancy`, and the
// stairwell's people on its stairs. Only with a cut floor (always the case in 2D).
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { peopleCount, peopleSlots, stairSlots } from '../domain/people';
import { PLINTH_M } from '../domain/plan';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { planLocal } from './geom';
import { fixedMat } from './materials';
import { personGeometry } from './personGeometry';

const MAX_PEOPLE = 400;
const REFRESH_S = 0.5;

export function People({ layout }: { layout: ComplexLayout }) {
  const geometry = useMemo(personGeometry, []);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const acc = useRef(REFRESH_S);
  const byId = useMemo(() => new Map(layout.buildings.map((b) => [b.id, b])), [layout]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) }), []);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < REFRESH_S || !mesh.current) return;
    acc.current = 0;
    const floor = useUiStore.getState().floor;
    const readings = useLiveStore.getState().readings;
    let n = 0;
    const put = (bId: string, u: number, v: number, f: number, mirrored: boolean) => {
      const b = byId.get(bId);
      if (!b || n >= MAX_PEOPLE) return;
      const [lx, lz] = planLocal(b, u, v, mirrored);
      const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
      tmp.p.set(b.center.x + lx * c + lz * s, PLINTH_M + f * b.floorHeight + .12, b.center.z - lx * s + lz * c);
      tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotationY + (mirrored ? Math.PI : 0));
      mesh.current!.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    };
    if (floor !== null) {
      for (const a of layout.apartments) {
        if (useUiStore.getState().firstPersonUnit && a.id !== useUiStore.getState().firstPersonUnit) continue;
        if (a.floor !== floor || !byId.get(a.building)?.supportsPlan) continue;
        const occ = readings.get(`${a.id}.occupancy`)?.last ?? 0;
        for (const slot of peopleSlots(a.id, peopleCount(occ))) put(a.building, slot.u, slot.v, a.floor, a.mirrored);
      }
      for (const b of useUiStore.getState().firstPersonUnit ? [] : layout.buildings) {
        const occ = readings.get(`${b.id}-S.occupancy`)?.last ?? 0;
        for (const slot of stairSlots(peopleCount(occ))) {
          if (Math.min(slot.floorOffset, b.floors - 1) === floor) put(b.id, slot.u, slot.v, floor, false);
        }
      }
    }
    mesh.current.count = n;
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, fixedMat('resident', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: '#283b48', emissiveIntensity: .12 })), MAX_PEOPLE]}
      dispose={null} castShadow frustumCulled={false} />
  );
}
