import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { apartmentDevicePose } from '../domain/deviceAppearance';
import { planToWorld, type ComplexLayout } from '../domain/layout';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { fixedMat, mat } from './materials';

type PartRole = 'body' | 'detail' | 'led';
interface Instance { id: string; matrix: THREE.Matrix4 }
const ENERGY = ['power', 'water_flow', 'gas_flow'];
const SAFETY = ['smoke', 'gas', 'co'];

/** Each type has its own procedural silhouette; all instances share the same geometry. */
function sensorParts(type: string): Map<PartRole, THREE.BufferGeometry> {
  const parts = new Map<PartRole, THREE.BufferGeometry[]>();
  const add = (r: PartRole, g: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    g.translate(x, y, z);
    parts.set(r, [...(parts.get(r) ?? []), g]);
  };
  const box = (r: PartRole, w: number, h: number, d: number, x = 0, y = 0, z = 0) => add(r, new THREE.BoxGeometry(w, h, d), x, y, z);
  const grille = (w: number, y: number, z: number, count = 4) => {
    for (let i = 0; i < count; i++) box('detail', w, 0.006, 0.008, 0, y + i * 0.013, z);
  };
  if (type === 'smoke') {
    add('body', new THREE.CylinderGeometry(0.12, 0.14, 0.06, 20));
    add('detail', new THREE.TorusGeometry(0.105, 0.008, 4, 20).rotateX(Math.PI / 2), 0, 0.03, 0);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      box('detail', 0.018, 0.012, 0.018, Math.cos(a) * 0.115, 0.015, Math.sin(a) * 0.115);
    }
    box('led', 0.018, 0.01, 0.018, 0.06, 0.036, 0);
  } else if (type === 'occupancy') {
    add('body', new THREE.CylinderGeometry(0.095, 0.095, 0.035, 16));
    add('detail', new THREE.SphereGeometry(0.071, 12, 6).scale(1, 0.7, 1), 0, 0.02, 0);
    box('led', 0.013, 0.008, 0.013, 0.079, 0.021, 0);
  } else if (type === 'gas') {
    box('body', 0.22, 0.07, 0.16);
    for (let i = 0; i < 6; i++) box('detail', 0.13, 0.008, 0.008, 0, 0.039, -0.05 + i * 0.018);
    box('led', 0.016, 0.008, 0.016, 0.09, 0.039, 0.05);
  } else if (ENERGY.includes(type)) {
    box('body', 0.2, 0.23, 0.08);
    if (type === 'power') {
      box('detail', 0.14, 0.07, 0.01, 0, 0.035, 0.045);
      for (const x of [-0.045, 0, 0.045]) box('detail', 0.022, 0.035, 0.02, x, -0.065, 0.05);
    } else {
      add('detail', new THREE.CylinderGeometry(0.07, 0.07, 0.015, 16).rotateX(Math.PI / 2), 0, 0, 0.049);
      box('body', 0.007, 0.054, 0.007, 0, 0.017, 0.061);
    }
    box('led', 0.02, 0.012, 0.008, 0.065, 0.085, 0.045);
  } else if (type === 'noise_level') {
    box('body', 0.08, 0.14, 0.03);
    add('detail', new THREE.CapsuleGeometry(0.022, 0.055, 3, 8), 0, 0.01, 0.034);
    grille(0.034, -0.015, 0.056);
    box('led', 0.013, 0.009, 0.008, 0, -0.051, 0.02);
  } else if (type === 'light') {
    box('body', 0.07, 0.09, 0.03);
    add('detail', new THREE.SphereGeometry(0.025, 8, 6), 0, 0.01, 0.018);
    box('led', 0.012, 0.008, 0.008, 0, -0.03, 0.02);
  } else {
    const climate = type === 'temperature' || type === 'humidity';
    box('body', climate ? 0.12 : 0.16, climate ? 0.08 : 0.13, 0.035);
    box('detail', 0.075, 0.035, 0.005, 0, climate ? 0.008 : 0.035, 0.02);
    if (!climate) grille(0.11, -0.044, 0.022);
    else for (const x of [-0.018, 0, 0.018]) box('body', 0.009, 0.016, 0.003, x, 0.008, 0.024);
    box('led', 0.012, 0.008, 0.004, 0.046, -0.028, 0.02);
  }
  const out = new Map<PartRole, THREE.BufferGeometry>();
  for (const [role, geometries] of parts) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!merged) throw new Error(`Cannot merge sensor ${type}`);
    if (['smoke', 'occupancy', 'gas'].includes(type)) merged.rotateX(Math.PI / 2);
    out.set(role, merged);
  }
  return out;
}

function SensorBatch({ type, instances }: { type: string; instances: Instance[] }) {
  const geometry = useMemo(() => sensorParts(type), [type]);
  const refs = useRef(new Map<PartRole, THREE.InstancedMesh>());
  useLayoutEffect(() => () => { geometry.forEach((g) => g.dispose()); }, [geometry]);
  useLayoutEffect(() => {
    for (const mesh of refs.current.values()) {
      instances.forEach((s, i) => mesh.setMatrixAt(i, s.matrix));
      mesh.count = instances.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [instances]);
  const color = ENERGY.includes(type) ? '#eab308' : SAFETY.includes(type) ? '#ef4444' : '#22c55e';
  const led = fixedMat(`sensor-led-${color}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
  return <>{[...geometry].map(([role, g]) => (
    <instancedMesh key={`${role}-${instances.length}`} ref={(m) => { if (m) refs.current.set(role, m); else refs.current.delete(role); }}
      args={[g, role === 'led' ? led : mat(role === 'body' ? 'furniture' : 'metal'), instances.length]}
      dispose={null} userData={{ instanceDevices: instances.map((s) => s.id) }} />
  ))}</>;
}

/** `realHeights`: mounting heights of the first person, also used by the 3D cut with whole walls (V20). */
export function buildSensorBatches(layout: ComplexLayout, floor: number | null, openBuilding: string | null = null,
  realHeights = openBuilding !== null): Map<string, Instance[]> {
  const out = new Map<string, Instance[]>();
  for (const apt of layout.apartments) {
    if (openBuilding ? apt.building !== openBuilding : apt.floor !== floor) continue;
    const b = layout.buildings.find((v) => v.id === apt.building)!;
    if (!b.supportsPlan) continue;
    for (const d of layout.devices.values()) {
      if (d.unitId !== apt.id || d.kind !== 'sensor') continue;
      const pose = apartmentDevicePose(d.type, realHeights);
      if (!pose) continue;
      const p = planToWorld(b, pose.u, pose.v, pose.h, apt.floor, apt.mirrored);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotationY + pose.rotationY + (apt.mirrored ? Math.PI : 0));
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      out.set(d.type, [...(out.get(d.type) ?? []), { id: d.deviceId, matrix }]);
    }
  }
  return out;
}

export function ApartmentSensors({ layout }: { layout: ComplexLayout }) {
  const floor = useUiStore((s) => s.floor);
  const open = useWalkStore((s) => (s.active ? s.openBuilding : null));
  const plan2d = useUiStore((s) => s.mode === '2d');
  const batches = useMemo(() => buildSensorBatches(layout, floor, open, open !== null || !plan2d), [layout, floor, open, plan2d]);
  return <>{[...batches].map(([type, instances]) => <SensorBatch key={type} type={type} instances={instances} />)}</>;
}
