// Room lights of the first person (V21): always six point lights, moved into the rooms of the last
// apartment visited and lit from its `lights` state. A constant number of lights never forces the
// shaders to recompile while walking from one apartment to another.
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { lightLevel } from '../domain/actuatorVisual';
import { ROOM_LIGHTS } from '../domain/deviceAppearance';
import { planToWorld, type ComplexLayout } from '../domain/layout';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { approach } from './anim';

const POOL = 6;

export function RoomLightPool({ layout }: { layout: ComplexLayout }) {
  const low = useUiStore((s) => s.lowPerformance);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const level = useRef(0);
  const placed = useRef<string | null>(null);
  useFrame((_, dt) => {
    const { lightsUnit, openBuilding } = useWalkStore.getState();
    const apt = layout.apartments.find((a) => a.id === lightsUnit && a.building === openBuilding);
    const b = layout.buildings.find((x) => x.id === apt?.building);
    const state = apt ? useLiveStore.getState().states.get(`${apt.id}.lights`)?.state ?? {} : {};
    level.current = approach(level.current, apt ? lightLevel(state) : 0, dt);
    if (apt && b && placed.current !== `${apt.id}:${low}`) {
      placed.current = `${apt.id}:${low}`;
      lights.current.forEach((l, i) => {
        const r = ROOM_LIGHTS[(low ? i * 2 : i) % ROOM_LIGHTS.length];
        const p = planToWorld(b, r.u + Math.sin(r.rotationY) * 0.3, r.v + Math.cos(r.rotationY) * 0.3, r.h, apt.floor, apt.mirrored);
        l?.position.set(p.x, p.y, p.z);
      });
    }
    for (const l of lights.current) if (l) l.intensity = 16 * level.current;
  });
  return <>{Array.from({ length: low ? 3 : POOL }, (_, i) => (
    <pointLight key={i} ref={(l) => { lights.current[i] = l; }} intensity={0} distance={8} decay={2} color="#ffe5b6" />
  ))}</>;
}
