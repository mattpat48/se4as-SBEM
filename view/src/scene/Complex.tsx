// The whole complex: ground, ring road, park, parking, buildings.
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { useWalkStore, walker } from '../store/walk';
import { Building } from './Building';
import { Cars } from './Cars';
import { Devices } from './Devices';
import { UNIT_BOX, mat } from './materials';
import { Park } from './Park';
import { PiazzaDArmi } from './location/PiazzaDArmi';
import { OpenBuilding } from './OpenBuilding';
import { Parking } from './Parking';
import { RoomLightPool } from './RoomLightPool';

const ROADS: [number, number, number, number][] = [[170, 8, 0, -72], [170, 8, 0, 92], [8, 172, -82, 10], [8, 172, 82, 10]];

/** The unit or device under the pointer: instanced windows map instances to units, other meshes carry userData. */
export function pickTarget(e: ThreeEvent<MouseEvent>): { unitId: string; deviceId?: string } | null {
  if (e.object instanceof THREE.InstancedMesh && e.instanceId !== undefined) {
    const units = e.object.userData.windowUnits as string[] | undefined;
    const devices = e.object.userData.instanceDevices as string[] | undefined;
    if (devices?.[e.instanceId]) return { unitId: devices[e.instanceId].split('.')[0], deviceId: devices[e.instanceId] };
    if (units?.[e.instanceId]) return { unitId: units[e.instanceId] };
  }
  for (let o: THREE.Object3D | null = e.object; o; o = o.parent) {
    if (o.userData?.deviceId) return { unitId: String(o.userData.deviceId).split('.')[0], deviceId: o.userData.deviceId };
    if (o.userData?.unitId) return { unitId: o.userData.unitId };
  }
  return null;
}

/** Doors answer a click within this distance of the walker (V21). */
const DOOR_REACH_M = 3;

export function onPick(e: ThreeEvent<MouseEvent>) {
  if (e.delta > 4) return;                        // a drag of the camera, not a click
  const doorId = e.object.userData?.doorId as string | undefined;
  if (doorId) {
    e.stopPropagation();
    const layout = useModelStore.getState().layout;
    const p = e.point;
    if (layout && useWalkStore.getState().active && Math.hypot(p.x - walker.x, p.z - walker.z) <= DOOR_REACH_M
      && Math.abs(p.y - walker.feet - 1) < 2) useWalkStore.getState().toggleDoor(layout, doorId);
    return;
  }
  const t = pickTarget(e);
  if (!t) return;
  e.stopPropagation();
  const ui = useUiStore.getState();
  ui.selectUnit(t.unitId);
  if (t.deviceId) ui.selectDevice(t.deviceId);
}

export function Complex({ layout }: { layout: ComplexLayout }) {
  const walking = useWalkStore((s) => s.active);
  const plan2d = useUiStore((s) => s.mode === '2d');
  const open = useWalkStore((s) => (s.active ? s.openBuilding : null));
  const byBuilding = useMemo(() => new Map(layout.buildings.map((b) => [b.id, layout.apartments.filter((a) => a.building === b.id)])), [layout]);
  return (
    <group onClick={onPick}>
      <group visible={!plan2d}><PiazzaDArmi /></group>
      <mesh geometry={UNIT_BOX} material={mat('ground')} position={[0, -0.5, 0]} scale={[200, 1, 200]} receiveShadow />
      {ROADS.map(([w, d, x, z], i) => (
        <mesh key={i} geometry={UNIT_BOX} material={mat('road')} position={[x, 0.03, z]} scale={[w, 0.06, d]} receiveShadow />
      ))}
      <Park layout={layout} />
      <Parking layout={layout} />
      {layout.buildings.map((b) => (b.id === open && b.supportsPlan
        ? <OpenBuilding key={`open-${b.id}`} layout={layout} b={b} />
        : <Building key={b.id} b={b} apartments={byBuilding.get(b.id)!} />))}
      {walking && <RoomLightPool layout={layout} />}
      <Devices layout={layout} />
      <Cars layout={layout} />
    </group>
  );
}
