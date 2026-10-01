// People silhouettes (view spec §7.5): apartments of the cut floor from `occupancy`, and the
// stairwell's people on its stairs. Only with a cut floor (always the case in 2D).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { peopleCount, peopleSlots, stairSlots } from '../domain/people';
import { PLINTH_M } from '../domain/plan';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { planLocal } from './geom';
import { fixedMat } from './materials';

const BODY = new THREE.CapsuleGeometry(0.25, 1.2, 4, 10).translate(0, 0.85, 0);   // 1.7 m tall
const MAX_PEOPLE = 400;
const REFRESH_S = 0.5;

export function People({ layout }: { layout: ComplexLayout }) {
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
      tmp.p.set(b.center.x + lx * c + lz * s, PLINTH_M + f * b.floorHeight, b.center.z - lx * s + lz * c);
      mesh.current!.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    };
    if (floor !== null) {
      for (const a of layout.apartments) {
        if (a.floor !== floor || !byId.get(a.building)?.supportsPlan) continue;
        const occ = readings.get(`${a.id}.occupancy`)?.last ?? 0;
        for (const slot of peopleSlots(a.id, peopleCount(occ))) put(a.building, slot.u, slot.v, a.floor, a.mirrored);
      }
      for (const b of layout.buildings) {
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
    <instancedMesh ref={mesh} args={[BODY, fixedMat('person', () => new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.6 })), MAX_PEOPLE]}
      castShadow frustumCulled={false} />
  );
}
