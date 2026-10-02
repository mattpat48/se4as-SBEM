// The two-flight stair of one storey (V21): solid up flight, thick treads on the flight that comes
// back above it, mid landing slab, spine wall between the flights; a closed understair on the
// ground floor. Shared by the cut floor and the open building of the first person.
import type { BuildingGeom } from '../domain/layout';
import { PLINTH_M } from '../domain/plan';
import { DOWN_HALF, FLIGHT_STEPS, STAIR_DIVIDER, UP_HALF, stairSteps } from '../domain/stairs';
import { planBox } from './geom';
import { UNIT_BOX, mat } from './materials';
import { MergedBoxes } from './MergedBoxes';

const TREAD_THICK_M = 0.3;

export function StairFlights({ b, floor, faded = false }: { b: BuildingGeom; floor: number; faded?: boolean }) {
  const y0 = PLINTH_M + floor * b.floorHeight;
  const steps = stairSteps(b.floorHeight);
  const landingTop = steps[FLIGHT_STEPS].top;
  return (
    <group>
      <MergedBoxes material={mat('slab', faded)} castShadow={!faded} boxes={steps.map((s, i) => {
        const bottom = i < FLIGHT_STEPS ? 0 : Math.max(0, s.top - (i === FLIGHT_STEPS ? .2 : TREAD_THICK_M));
        return planBox(b, s, y0 + bottom, s.top - bottom);
      })} />
      {floor === 0 && <mesh geometry={UNIT_BOX} material={mat('wall', faded)} {...planBox(b, DOWN_HALF, y0, landingTop)} castShadow receiveShadow />}
      <mesh geometry={UNIT_BOX} material={mat('wall', faded)} {...planBox(b, STAIR_DIVIDER, y0, b.floorHeight)} castShadow receiveShadow />
    </group>
  );
}

/** At the top floor nothing goes up: a railing closes the up half towards the landing. */
export function TopRailing({ b, floor, faded = false }: { b: BuildingGeom; floor: number; faded?: boolean }) {
  const y0 = PLINTH_M + floor * b.floorHeight;
  return <mesh geometry={UNIT_BOX} material={mat('wall', faded)} {...planBox(b, { u0: UP_HALF.u0, u1: UP_HALF.u1, v0: UP_HALF.v1 - 0.05, v1: UP_HALF.v1 + 0.05 }, y0, 1.1)} />;
}
