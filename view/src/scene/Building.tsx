// A building: plinth, floors (solid / cut / ghost), windows, roof with PV, canopy.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ApartmentGeom, BuildingGeom } from '../domain/layout';
import { DAY } from '../domain/palette';
import {
  ANDRONE, LIFT, PARAPET_M, PLAN_D, PLAN_W, PLINTH_M, SILL_M, TALL_WINDOW_H_M, WINDOW_H_M, WINDOWS,
} from '../domain/plan';
import { buildingMode, floorMode } from '../domain/visibility';
import { useUiStore } from '../store/ui';
import type { ThreeEvent } from '@react-three/fiber';
import { buildingDoors } from '../domain/doors';
import { Doors } from './Doors';
import { Floor } from './Floor';
import { planBox, planLocal, planWall } from './geom';
import { UNIT_BOX, fixedMat, mat } from './materials';
import { registerUnit, unregisterUnit } from './registry';

interface WindowInstance { unitId: string; matrix: THREE.Matrix4 }

function windowInstances(b: BuildingGeom, floors: number[], apartments: ApartmentGeom[], stairwellId: string): WindowInstance[] {
  if (!b.supportsPlan) return [];
  const out: WindowInstance[] = [];
  const pos = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const f of floors) {
    const y0 = PLINTH_M + f * b.floorHeight;
    for (const apt of apartments.filter((a) => a.floor === f)) {
      for (const w of WINDOWS) {
        if (w.unit === 'core' && (apt.number !== 1 || f === 0)) continue;
        const mirrored = w.unit === 'apt1' && apt.mirrored;
        const v = w.side === 1 ? PLAN_D : 0;
        const [x0, z] = planLocal(b, w.u0, v, mirrored);
        const [x1] = planLocal(b, w.u1, v, mirrored);
        const h = w.tall ? TALL_WINDOW_H_M : WINDOW_H_M;
        const sill = w.tall ? 0 : SILL_M;
        pos.set((x0 + x1) / 2, y0 + sill + h / 2, z + Math.sign(z) * 0.03);
        scale.set(Math.abs(x1 - x0), h, 0.12);
        out.push({ unitId: w.unit === 'core' ? stairwellId : apt.id, matrix: new THREE.Matrix4().compose(pos, q, scale) });
      }
    }
  }
  return out;
}

/** Glass whose emission comes from a per-instance attribute (lit windows at night, heat glow). */
function windowMaterial(faded: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.15, metalness: 0.3, transparent: faded, opacity: faded ? 0.25 : 1, depthWrite: !faded,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 instanceEmissive;\nvarying vec3 vInstanceEmissive;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceEmissive = instanceEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInstanceEmissive;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vInstanceEmissive;');
  };
  return m;
}

function Windows({ b, floors, apartments, stairwellId, faded }: {
  b: BuildingGeom; floors: number[]; apartments: ApartmentGeom[]; stairwellId: string; faded: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const instances = useMemo(() => windowInstances(b, floors, apartments, stairwellId), [b, floors, apartments, stairwellId]);
  const material = useMemo(() => windowMaterial(faded), [faded]);
  const geometry = useMemo(() => {
    const g = UNIT_BOX.clone();
    g.setAttribute('instanceEmissive', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, instances.length) * 3), 3));
    return g;
  }, [instances.length]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || instances.length === 0) return;
    const glass = new THREE.Color(DAY.glass);
    const byUnit = new Map<string, number[]>();
    instances.forEach((w, i) => {
      mesh.setMatrixAt(i, w.matrix);
      mesh.setColorAt(i, glass);
      byUnit.set(w.unitId, [...(byUnit.get(w.unitId) ?? []), i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    for (const [unitId, windowIndices] of byUnit) registerUnit(unitId, { windows: mesh, windowIndices });
    return () => { for (const unitId of byUnit.keys()) unregisterUnit(unitId, { windows: mesh }); };
  }, [instances]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  if (instances.length === 0) return null;
  return (
    <instancedMesh key={instances.length} ref={ref} args={[geometry, material, instances.length]} castShadow={false} receiveShadow
      userData={{ windowUnits: instances.map((w) => w.unitId) }} />
  );
}

const pvMat = () => fixedMat('pv', () => new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.25, metalness: 0.4 }));
const canopyMat = () => fixedMat('canopy', () => new THREE.MeshStandardMaterial({ color: '#57534e', roughness: 0.7 }));

export function Roof({ b, faded }: { b: BuildingGeom; faded: boolean }) {
  const ry = PLINTH_M + b.floors * b.floorHeight;
  const edges: [number, number, number, number][] = [[0, 0, PLAN_W, 0], [0, PLAN_D, PLAN_W, PLAN_D], [0, 0, 0, PLAN_D], [PLAN_W, 0, PLAN_W, PLAN_D]];
  const panels = useMemo(() => {
    const out: { position: [number, number, number] }[] = [];
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;                               // skip the lift column
      for (const v of [3, 8]) {
        const [x, z] = planLocal(b, PLAN_W / 2 + i * 2.7, v);
        out.push({ position: [x, ry + 0.9, z] });
      }
    }
    return out;
  }, [b, ry]);
  return (
    <group>
      <mesh geometry={UNIT_BOX} material={mat('plinth', faded)} {...planBox(b, { u0: 0, u1: PLAN_W, v0: 0, v1: PLAN_D }, ry, 0.3)} castShadow receiveShadow />
      {edges.map((w, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={mat('wall', faded)} {...planWall(b, w, ry, PARAPET_M, 0.25)} castShadow receiveShadow />
      ))}
      {panels.map((p, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={pvMat()} position={p.position} rotation={[-0.35, 0, 0]} scale={[2.2, 0.08, 3.2]} castShadow />
      ))}
      <mesh geometry={UNIT_BOX} material={mat('wall', faded)} {...planBox(b, LIFT, ry, 2.2)} castShadow receiveShadow />
    </group>
  );
}

/** Three steps up the plinth to the park portone (the walker's feet follow a ramp, V21). */
export function PortoneSteps({ b, faded = false }: { b: BuildingGeom; faded?: boolean }) {
  return (
    <group>
      {[0.7, 0.47, 0.23].map((top, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={mat('plinth', faded)} castShadow receiveShadow
          {...planBox(b, { u0: 13.1, u1: 15.4, v0: PLAN_D + i * 0.4, v1: PLAN_D + (i + 1) * 0.4 }, 0, top)} />
      ))}
    </group>
  );
}

/** Canopy over the park exit of the androne. */
export function Canopy({ b }: { b: BuildingGeom }) {
  return <mesh geometry={UNIT_BOX} material={canopyMat()}
    {...planBox(b, { u0: ANDRONE.u0 - 0.3, u1: ANDRONE.u1 + 0.3, v0: PLAN_D, v1: PLAN_D + 1.6 }, PLINTH_M + 2.7, 0.15)} castShadow />;
}

export function Building({ b, apartments }: { b: BuildingGeom; apartments: ApartmentGeom[] }) {
  const selectedFloor = useUiStore((s) => s.floor);
  const selectedBuilding = useUiStore((s) => s.building);
  const faded = buildingMode(b.id, selectedBuilding) === 'faded';
  const floors = useMemo(() => Array.from({ length: b.floors }, (_, f) => f), [b.floors]);
  const solidKey = floors.filter((f) => floorMode(f, selectedFloor) === 'solid').join(',');
  const solidFloors = useMemo(() => (solidKey === '' ? [] : solidKey.split(',').map(Number)), [solidKey]);
  const stairwellId = `${b.id}-S`;
  const portoni = useMemo(() => buildingDoors(b, apartments).filter((d) => d.kind === 'portone'), [b, apartments]);

  return (
    <group position={[b.center.x, 0, b.center.z]} rotation={[0, b.rotationY, 0]} userData={{ buildingId: b.id }}
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); useUiStore.getState().setBuilding(b.id); }}>
      <mesh geometry={UNIT_BOX} material={mat('plinth', faded)} position={[0, PLINTH_M / 2, 0]} scale={[b.width, PLINTH_M, b.depth]} castShadow receiveShadow
        userData={{ unitId: b.id }} />
      {floors.map((f) => (
        <Floor key={f} b={b} floor={f} mode={floorMode(f, selectedFloor)} faded={faded} stairwellId={stairwellId}
          apartments={apartments.filter((a) => a.floor === f)} />
      ))}
      <Windows b={b} floors={solidFloors} apartments={apartments} stairwellId={stairwellId} faded={faded} />
      {selectedFloor === null && <group userData={{ unitId: b.id }}><Roof b={b} faded={faded} /></group>}
      <Canopy b={b} />
      {b.supportsPlan && <PortoneSteps b={b} faded={faded} />}
      <Doors b={b} doors={portoni} />
    </group>
  );
}
