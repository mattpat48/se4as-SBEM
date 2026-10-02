// One storey of a building in its current mode: solid shells, a cut "dollhouse" floor, or a ghost.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ApartmentGeom, BuildingGeom } from '../domain/layout';
import {
  BALCONY, CORE, CUT_WALL_M, INTERIOR_WALLS, LIFT, PLAN_D, PLAN_W, PLINTH_M, type PlanRect,
} from '../domain/plan';
import { wallHeight } from '../domain/interior';
import type { FloorMode } from '../domain/visibility';
import { useUiStore } from '../store/ui';
import { planBox, planWall } from './geom';
import { DAY } from '../domain/palette';
import { TWIN_EDGES, UNIT_BOX, UNIT_BOX_EDGES, fixedMat, mat } from './materials';
import { InteriorWalls } from './InteriorWalls';
import { registerUnit, unregisterUnit } from './registry';
import { StairFlights, TopRailing } from './StairFlights';

const APT1: PlanRect = { u0: 0, u1: 10.5, v0: 0, v1: PLAN_D };
const APT1_PERIMETER: [number, number, number, number][] = [
  [0, 0, 10.5, 0], [0, PLAN_D, 10.5, PLAN_D], [0, 0, 0, PLAN_D], [10.5, 0, 10.5, 4.6], [10.5, 5.6, 10.5, PLAN_D],
];

interface FloorProps {
  b: BuildingGeom;
  floor: number;
  mode: FloorMode;
  apartments: ApartmentGeom[];
  faded: boolean;
  stairwellId: string;
}

/** The footprint of each apartment on this floor: typical plan, or equal blocks as a fallback. */
function footprints(b: BuildingGeom, apartments: ApartmentGeom[]): { apt: ApartmentGeom; rect: PlanRect; mirrored: boolean }[] {
  const sorted = [...apartments].sort((x, y) => x.number - y.number);
  if (b.supportsPlan) return sorted.map((apt) => ({ apt, rect: APT1, mirrored: apt.mirrored }));
  const w = PLAN_W / Math.max(1, sorted.length);
  return sorted.map((apt, i) => ({ apt, rect: { u0: i * w, u1: (i + 1) * w, v0: 0, v1: PLAN_D }, mirrored: false }));
}

function unitMaterial(color: string, faded: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.85, transparent: faded, opacity: faded ? 0.25 : 1, depthWrite: !faded,
  });
}

/** A mesh with its own material, registered in the unit registry as shell or floor slab. */
export function UnitMesh({ unitId, part, color, faded, box }: {
  unitId: string; part: 'shell' | 'floor'; color: string; faded: boolean;
  box: { position: [number, number, number]; scale: [number, number, number] };
}) {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(() => unitMaterial(color, faded), [color, faded]);
  useLayoutEffect(() => {
    const m = ref.current!;
    const parts = part === 'shell' ? { shells: [m] } : { floor: m };
    registerUnit(unitId, parts);
    return () => unregisterUnit(unitId, parts);
  }, [unitId, part]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  return (
    <mesh ref={ref} geometry={UNIT_BOX} material={material} {...box} castShadow receiveShadow
      userData={{ unitId }}>
      {part === 'shell' && <lineSegments geometry={UNIT_BOX_EDGES} material={TWIN_EDGES} />}
    </mesh>
  );
}

const railMat = () => fixedMat('rail', () => new THREE.MeshStandardMaterial({
  color: '#bfe3f5', transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false,
}));
export const liftMat = () => fixedMat('lift', () => new THREE.MeshStandardMaterial({ color: '#b8c0cc', roughness: 0.6 }));
const ghostMat = () => fixedMat('ghost', () => new THREE.MeshBasicMaterial({
  color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false,
}));
const ghostEdgeMat = () => fixedMat('ghostEdge', () => new THREE.LineBasicMaterial({
  color: '#94a3b8', transparent: true, opacity: 0.35,
}));

/** Balcony slab with its glass railing; on the ground floor a paved patio, railed too (V21). */
export function Balcony({ b, y0, mirrored, faded, patio }: { b: BuildingGeom; y0: number; mirrored: boolean; faded: boolean; patio: boolean }) {
  const { u0, u1, v0, v1 } = BALCONY;
  return (
    <group>
      {patio
        ? <mesh geometry={UNIT_BOX} material={mat('path', faded)} {...planBox(b, BALCONY, y0 - 0.1, 0.1, mirrored)} receiveShadow />
        : <mesh geometry={UNIT_BOX} material={mat('slab', faded)} {...planBox(b, BALCONY, y0 - 0.2, 0.2, mirrored)} castShadow receiveShadow />}
      {([[u0, v1, u1, v1], [u0, v0, u0, v1], [u1, v0, u1, v1]] as [number, number, number, number][]).map((w, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={railMat()} {...planWall(b, w, y0, 1.1, 0.05, mirrored)} />
      ))}
    </group>
  );
}


/** The storey's flights (none at the top floor, which only has a railing) and the lift. */
function Stairs({ b, floor }: { b: BuildingGeom; floor: number }) {
  return (
    <group>
      {floor < b.floors - 1 ? <StairFlights b={b} floor={floor} /> : <TopRailing b={b} floor={floor} />}
      <mesh geometry={UNIT_BOX} material={liftMat()} {...planBox(b, LIFT, PLINTH_M + floor * b.floorHeight, 2.2)} castShadow />
    </group>
  );
}

export function Floor({ b, floor, mode, apartments, faded, stairwellId }: FloorProps) {
  const y0 = PLINTH_M + floor * b.floorHeight;
  const fh = b.floorHeight;
  // Whole walls in the 3D cut (V20); the 2D plan keeps its low cut, as before.
  const plan2d = useUiStore((s) => s.mode === '2d');
  const wallH = plan2d ? CUT_WALL_M : wallHeight(fh);
  const feet = footprints(b, apartments);

  if (mode === 'ghost') {
    const box = planBox(b, { u0: 0, u1: PLAN_W, v0: 0, v1: PLAN_D }, y0, fh);
    return (
      <mesh geometry={UNIT_BOX} material={ghostMat()} {...box}>
        <lineSegments geometry={UNIT_BOX_EDGES} material={ghostEdgeMat()} />
      </mesh>
    );
  }

  if (mode === 'cut') {
    return (
      <group>
        {feet.map(({ apt, rect, mirrored }) => (
          <UnitMesh key={apt.id} unitId={apt.id} part="floor" color={DAY.slab} faded={faded}
            box={planBox(b, rect, y0, 0.12, mirrored)} />
        ))}
        {b.supportsPlan && (
          <>
            <mesh geometry={UNIT_BOX} material={mat('slab', faded)} {...planBox(b, CORE, y0, 0.1)} receiveShadow userData={{ unitId: stairwellId }} />
            {plan2d
              ? feet.flatMap(({ apt, mirrored }) => [...INTERIOR_WALLS, ...APT1_PERIMETER].map((w, i) => (
                <mesh key={`${apt.id}-${i}`} geometry={UNIT_BOX} material={mat('wall', faded)}
                  {...planWall(b, w, y0, wallH, 0.2, mirrored)} castShadow receiveShadow />
              )))
              : feet.map(({ apt }) => (
                <InteriorWalls key={`walls-${apt.id}`} b={b} apt={apt} ceiling={wallH} entryOpen faded={faded} />
              ))}
            {([[10.5, 0, floor === 0 ? 13 : 15.5, 0], [10.5, PLAN_D, floor === 0 ? 13 : 15.5, PLAN_D]] as [number, number, number, number][]).map((w, i) => (
              <mesh key={`core-${i}`} geometry={UNIT_BOX} material={mat('wall', faded)} {...planWall(b, w, y0, wallH, 0.2)} castShadow />
            ))}
            <group userData={{ unitId: stairwellId }}><Stairs b={b} floor={floor} /></group>
            {feet.map(({ apt, mirrored }) => (
              <Balcony key={`bal-${apt.id}`} b={b} y0={y0} mirrored={mirrored} faded={faded} patio={floor === 0} />
            ))}
          </>
        )}
        {!b.supportsPlan && feet.map(({ apt, rect }) => (
          [[rect.u0, 0, rect.u1, 0], [rect.u0, PLAN_D, rect.u1, PLAN_D], [rect.u0, 0, rect.u0, PLAN_D], [rect.u1, 0, rect.u1, PLAN_D]] as [number, number, number, number][]
        ).map((w, i) => (
          // Fallback blocks have no rooms or openings: whole walls would hide their heat-coloured floor.
          <mesh key={`${apt.id}-${i}`} geometry={UNIT_BOX} material={mat('wall', faded)} {...planWall(b, w, y0, CUT_WALL_M, 0.2)} />
        )))}
      </group>
    );
  }

  return (
    <group>
      {feet.map(({ apt, rect, mirrored }) => (
        <UnitMesh key={apt.id} unitId={apt.id} part="shell" color={DAY.wall} faded={faded}
          box={planBox(b, rect, y0, fh, mirrored)} />
      ))}
      {b.supportsPlan && (
        <>
          <mesh geometry={UNIT_BOX} material={mat('core', faded)} {...planBox(b, CORE, y0, fh)} castShadow receiveShadow userData={{ unitId: stairwellId }}>
            <lineSegments geometry={UNIT_BOX_EDGES} material={TWIN_EDGES} />
          </mesh>
          {feet.map(({ apt, mirrored }) => (
            <Balcony key={`bal-${apt.id}`} b={b} y0={y0} mirrored={mirrored} faded={faded} patio={floor === 0} />
          ))}
        </>
      )}
      {floor > 0 && (
        <mesh geometry={UNIT_BOX} material={mat('slab', faded)} position={[0, y0, 0]} scale={[b.width + 0.3, 0.18, b.depth + 0.3]} castShadow receiveShadow />
      )}
    </group>
  );
}
