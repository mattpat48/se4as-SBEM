// Door leaves (V21): wooden doors in the apartments, dark double portoni in the androne. Each leaf
// turns about its hinge towards the store's state in DOOR_OPEN_S; the shared `doorOpenness` map
// tells the collisions how far each door is open. Inside a Building group (local metres).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DOOR_OPEN_S, doorLeaves, type DoorSpec } from '../domain/doors';
import type { BuildingGeom } from '../domain/layout';
import { PLINTH_M } from '../domain/plan';
import { CORE_SLAB_M } from '../domain/stairs';
import { APT_SLAB_M } from '../domain/walkWorld';
import { doorOpenness, isDoorOpen, useWalkStore } from '../store/walk';
import { planLocal } from './geom';
import { UNIT_BOX, fixedMat, mat } from './materials';

const LEAF_THICK_M = 0.05;
const portoneMat = () => fixedMat('door', () => new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.3, metalness: 0.2 }));

interface LeafMesh { door: DoorSpec; index: number; y0: number; h: number }

export function Doors({ b, doors }: { b: BuildingGeom; doors: DoorSpec[] }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const leaves = useMemo(() => doors.flatMap((door) => {
    const portone = door.kind === 'portone';
    const y0 = PLINTH_M + door.floor * b.floorHeight + (portone ? CORE_SLAB_M : APT_SLAB_M);
    return doorLeaves(door, 0).map((_, index): LeafMesh => ({ door, index, y0, h: portone ? 2.4 : door.kind === 'balcony' ? 2.25 : 2.0 }));
  }), [b, doors]);
  const shown = useRef(new Map<string, number>());

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const state = useWalkStore.getState().doors;
    leaves.forEach((l, i) => {
      const target = isDoorOpen(state, l.door.id, l.door.defaultOpen) ? 1 : 0;
      const prev = doorOpenness.get(l.door.id) ?? (l.door.defaultOpen ? 1 : 0);
      const now = l.index === 0 ? Math.max(0, Math.min(1, prev + Math.sign(target - prev) * dt / DOOR_OPEN_S)) : prev;
      if (l.index === 0) doorOpenness.set(l.door.id, Math.abs(now - target) < 1e-3 ? target : now);
      const mesh = refs.current[i];
      const value = doorOpenness.get(l.door.id)!;
      if (!mesh || shown.current.get(`${l.door.id}#${l.index}`) === value) return;
      shown.current.set(`${l.door.id}#${l.index}`, value);
      const leaf = doorLeaves(l.door, value)[l.index];
      const [hx, hz] = planLocal(b, leaf.hu, leaf.hv);
      const [ex, ez] = planLocal(b, leaf.eu, leaf.ev);
      mesh.position.set((hx + ex) / 2, l.y0 + l.h / 2, (hz + ez) / 2);
      mesh.rotation.set(0, -Math.atan2(ez - hz, ex - hx), 0);
      mesh.scale.set(Math.hypot(ex - hx, ez - hz) - 0.02, l.h, LEAF_THICK_M);
    });
  });

  return (
    <group>
      {leaves.map((l, i) => (
        <mesh key={`${l.door.id}#${l.index}`} ref={(m) => { refs.current[i] = m; }} geometry={UNIT_BOX}
          material={l.door.kind === 'portone' ? portoneMat() : mat('wood')} castShadow receiveShadow
          userData={{ doorId: l.door.id }} />
      ))}
    </group>
  );
}
