// The building the walker is in (V21): every floor drawn as interiors (wooden floors, whole walls,
// ceilings), the core with its pierced slabs, two-flight stairs and lift shaft, balconies, a band
// that closes the facade between floors, the roof and every door. The other buildings stay solid.
import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { buildingDoors } from '../domain/doors';
import { wallHeight } from '../domain/interior';
import { apartmentDevicePose } from '../domain/deviceAppearance';
import type { ApartmentGeom, BuildingGeom, ComplexLayout } from '../domain/layout';
import { DAY } from '../domain/palette';
import { LIFT, PLAN_D, PLAN_W, PLINTH_M, type PlanRect } from '../domain/plan';
import { CORE_SLAB_M } from '../domain/stairs';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { Canopy, PortoneSteps, Roof } from './Building';
import { Doors } from './Doors';
import { Balcony, UnitMesh, liftMat } from './Floor';
import { InteriorWalls } from './InteriorWalls';
import { StairFlights, TopRailing } from './StairFlights';
import { planBox, planLocal, planWall } from './geom';
import { UNIT_BOX, mat } from './materials';

type Seg = [number, number, number, number];
const APT1: PlanRect = { u0: 0, u1: 10.5, v0: 0, v1: PLAN_D };
/** The core slab around the stair well (the ground floor also has a floor under the stairs). */
const CORE_SLABS: PlanRect[] = [
  { u0: 10.5, u1: 15.5, v0: 4.5, v1: PLAN_D }, { u0: 10.5, u1: 11, v0: 0, v1: 4.5 },
  { u0: 15, u1: 15.5, v0: 0, v1: 4.5 }, { u0: 11, u1: 15, v0: 0, v1: 0.5 },
];
const STAIR_WINDOW = { u0: 11.2, u1: 14.8, sill: 0.9, top: 2.4 };
const PORTONE = { u0: 13.1, u1: 15.4, top: 2.5 };
const FACADE: Seg[] = [[0, 0, PLAN_W, 0], [0, PLAN_D, PLAN_W, PLAN_D], [0, 0, 0, PLAN_D], [PLAN_W, 0, PLAN_W, PLAN_D]];

const NAMES: Record<string, string> = {
  temperature: 'Temperatura', humidity: 'Umidità', co2: 'Qualità dell’aria', occupancy: 'Presenza', light: 'Luminosità',
  smoke: 'Rilevatore di fumo', gas: 'Rilevatore di gas', co: 'Monossido di carbonio', noise_level: 'Rumore',
  power: 'Contatore elettrico', water_flow: 'Contatore acqua', gas_flow: 'Contatore gas', hvac: 'Climatizzatore',
  ventilation: 'Ventilazione', gas_valve: 'Valvola gas', alarm: 'Allarme', resident_display: 'Display residenti',
};

/** Device names of the apartment the walker is in, hidden behind walls. */
function InteriorNames({ b, apt, layout }: { b: BuildingGeom; apt: ApartmentGeom; layout: ComplexLayout }) {
  const show = useUiStore((s) => s.showDeviceNames);
  if (!show) return null;
  return <>{[...layout.devices.values()].filter((d) => d.unitId === apt.id).map((d) => {
    const p = apartmentDevicePose(d.type, true);
    if (!p) return null;
    const [x, z] = planLocal(b, p.u + Math.sin(p.rotationY) * 0.18, p.v + Math.cos(p.rotationY) * 0.18, apt.mirrored);
    return <Html key={d.deviceId} position={[x, PLINTH_M + apt.floor * b.floorHeight + p.h + 0.18, z]} center distanceFactor={4} occlude
      style={{ pointerEvents: 'none' }}><span className="interior-device-name">{NAMES[d.type] ?? d.type}</span></Html>;
  })}</>;
}

function Apartment({ b, apt }: { b: BuildingGeom; apt: ApartmentGeom }) {
  const y0 = PLINTH_M + apt.floor * b.floorHeight;
  const ceiling = wallHeight(b.floorHeight);
  return (
    <group>
      <UnitMesh unitId={apt.id} part="floor" color={DAY.slab} faded={false} box={planBox(b, APT1, y0, 0.12, apt.mirrored)} />
      <InteriorWalls b={b} apt={apt} ceiling={ceiling} entryOpen>
        <mesh geometry={UNIT_BOX} material={mat('furniture')} position={[5.25, ceiling + 0.07, 6]} scale={[10.5, 0.14, 12]} castShadow receiveShadow />
      </InteriorWalls>
      <Balcony b={b} y0={y0} mirrored={apt.mirrored} faded={false} patio={apt.floor === 0} />
    </group>
  );
}

function Core({ b, floor }: { b: BuildingGeom; floor: number }) {
  const y0 = PLINTH_M + floor * b.floorHeight, fh = b.floorHeight;
  const wall = (w: Seg, from: number, to: number, key: string) => (
    <mesh key={key} geometry={UNIT_BOX} material={mat('wall')} {...planWall(b, w, y0 + from, to - from, 0.2)} castShadow receiveShadow />
  );
  const street = floor === 0
    ? [wall([10.5, 0, 15.5, 0], 0, fh, 's')]
    : [wall([10.5, 0, STAIR_WINDOW.u0, 0], 0, fh, 's0'), wall([STAIR_WINDOW.u1, 0, 15.5, 0], 0, fh, 's1'),
      wall([STAIR_WINDOW.u0, 0, STAIR_WINDOW.u1, 0], 0, STAIR_WINDOW.sill, 's2'), wall([STAIR_WINDOW.u0, 0, STAIR_WINDOW.u1, 0], STAIR_WINDOW.top, fh, 's3')];
  const park = floor === 0
    ? [wall([10.5, PLAN_D, PORTONE.u0, PLAN_D], 0, fh, 'p0'), wall([PORTONE.u1, PLAN_D, 15.5, PLAN_D], 0, fh, 'p1'),
      wall([PORTONE.u0, PLAN_D, PORTONE.u1, PLAN_D], PORTONE.top, fh, 'p2')]
    : [wall([10.5, PLAN_D, 15.5, PLAN_D], 0, fh, 'p')];
  return (
    <group userData={{ unitId: `${b.id}-S` }}>
      {(floor === 0 ? [...CORE_SLABS, { u0: 11, u1: 15, v0: 0.5, v1: 4.5 }] : CORE_SLABS).map((r, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={mat('slab')} {...planBox(b, r, y0, CORE_SLAB_M)} receiveShadow />
      ))}
      {street}{park}
      {floor > 0 && <mesh geometry={UNIT_BOX} material={mat('glass')}
        {...planBox(b, { u0: STAIR_WINDOW.u0, u1: STAIR_WINDOW.u1, v0: -0.02, v1: 0.02 }, y0 + STAIR_WINDOW.sill, STAIR_WINDOW.top - STAIR_WINDOW.sill)} />}
      <mesh geometry={UNIT_BOX} material={liftMat()} {...planBox(b, LIFT, y0, fh)} castShadow receiveShadow />
      {floor < b.floors - 1 ? <StairFlights b={b} floor={floor} /> : <TopRailing b={b} floor={floor} />}
      {/* The facade band between the 2.9 m walls and the next floor. */}
      {FACADE.map((w, i) => (
        <mesh key={`band-${i}`} geometry={UNIT_BOX} material={mat('wall')} {...planWall(b, w, y0 + wallHeight(fh), fh - wallHeight(fh), 0.2)} castShadow />
      ))}
    </group>
  );
}

export function OpenBuilding({ layout, b }: { layout: ComplexLayout; b: BuildingGeom }) {
  const apartments = useMemo(() => layout.apartments.filter((a) => a.building === b.id), [layout, b]);
  const doors = useMemo(() => buildingDoors(b, apartments), [b, apartments]);
  const floors = useMemo(() => Array.from({ length: b.floors }, (_, f) => f), [b.floors]);
  const place = useWalkStore((s) => s.place);
  const here = place.kind === 'apartment' || place.kind === 'balcony' ? apartments.find((a) => a.id === place.unitId) : undefined;
  return (
    <group position={[b.center.x, 0, b.center.z]} rotation={[0, b.rotationY, 0]} userData={{ buildingId: b.id }}>
      <mesh geometry={UNIT_BOX} material={mat('plinth')} position={[0, PLINTH_M / 2, 0]} scale={[b.width, PLINTH_M, b.depth]} castShadow receiveShadow />
      {floors.map((f) => <Core key={f} b={b} floor={f} />)}
      {apartments.map((apt) => <Apartment key={apt.id} b={b} apt={apt} />)}
      <Roof b={b} faded={false} />
      <Canopy b={b} />
      <PortoneSteps b={b} />
      <Doors b={b} doors={doors} />
      {here && <InteriorNames b={b} apt={here} layout={layout} />}
    </group>
  );
}
