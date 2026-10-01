// The whole complex: ground, ring road, park, parking, buildings.
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { useUiStore } from '../store/ui';
import { Building } from './Building';
import { Cars } from './Cars';
import { Devices } from './Devices';
import { UNIT_BOX, mat } from './materials';
import { Park } from './Park';
import { Parking } from './Parking';

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

function onPick(e: ThreeEvent<MouseEvent>) {
  if (e.delta > 4) return;                        // a drag of the camera, not a click
  const t = pickTarget(e);
  if (!t) return;
  e.stopPropagation();
  const ui = useUiStore.getState();
  ui.selectUnit(t.unitId);
  if (t.deviceId) ui.selectDevice(t.deviceId);
}

export function Complex({ layout }: { layout: ComplexLayout }) {
  return (
    <group onClick={onPick}>
      <mesh geometry={UNIT_BOX} material={mat('ground')} position={[0, -0.5, 0]} scale={[200, 1, 200]} receiveShadow />
      {ROADS.map(([w, d, x, z], i) => (
        <mesh key={i} geometry={UNIT_BOX} material={mat('road')} position={[x, 0.03, z]} scale={[w, 0.06, d]} receiveShadow />
      ))}
      <Park layout={layout} />
      <Parking layout={layout} />
      {layout.buildings.map((b) => (
        <Building key={b.id} b={b} apartments={layout.apartments.filter((a) => a.building === b.id)} />
      ))}
      <Devices layout={layout} />
      <Cars layout={layout} />
    </group>
  );
}
