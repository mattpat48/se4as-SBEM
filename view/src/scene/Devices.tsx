// Installed devices (view spec §7.3–§7.4): procedural fixtures with family LEDs, actuators
// as meshes animated from their declared state (0.5 s transitions). Clickable (selectDevice).
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  batteryVisual, blindsCover, displayVisual, elevatorVisual, hvacFlow, lightLevel, parkState, sirenOn, smokeVentOpen,
  stairLightsVisual, valveOpen, ventTurnsPerSecond, windowAngle,
} from '../domain/actuatorVisual';
import type { ApartmentGeom, BuildingGeom, ComplexLayout, Vec3 } from '../domain/layout';
import { LIFT, PLINTH_M, SILL_M, TALL_WINDOW_H_M, WINDOWS, WINDOW_H_M, PLAN_D } from '../domain/plan';
import { floorMode } from '../domain/visibility';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { approach, blink } from './anim';
import { apartmentDevicePose, ROOM_LIGHTS } from '../domain/deviceAppearance';
import { ApartmentSensors } from './ApartmentSensors';
import { DeviceShell } from './DeviceShell';
import { planLocal } from './geom';
import { UNIT_BOX, fixedMat } from './materials';

const stateOf = (deviceId: string) => useLiveStore.getState().states.get(deviceId)?.state ?? {};

const FAMILY: Record<string, string> = {
  temperature: '#22c55e', humidity: '#22c55e', co2: '#22c55e', noise_level: '#22c55e', occupancy: '#22c55e', light: '#22c55e',
  smoke: '#ef4444', gas: '#ef4444', co: '#ef4444', seismic: '#ef4444',
  power: '#eab308', water_flow: '#eab308', gas_flow: '#eab308', pv_power: '#eab308',
};
const OUTDOOR = '#3b82f6';

/** Which floors show their inside: the cut floor, or every floor of the selected building. */
function useInsideVisible() {
  const floor = useUiStore((s) => s.floor);
  const building = useUiStore((s) => s.building);
  return (b: string, f: number) => floor !== null ? f === floor : building === b;
}

// ---------------------------------------------------------------- sensors
const PUCK = new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16);
const RING = new THREE.TorusGeometry(0.17, 0.035, 6, 20).rotateX(Math.PI / 2);

function SensorPucks({ layout }: { layout: ComplexLayout }) {
  const visible = useInsideVisible();
  const puck = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.InstancedMesh>(null);
  const floorOf = useMemo(() => new Map(layout.apartments.map((a) => [a.id, { b: a.building, f: a.floor }])), [layout]);
  const byBuilding = useMemo(() => new Map(layout.buildings.map((b) => [b.id, b])), [layout]);
  const shown = useMemo(() => {
    const out: { id: string; p: Vec3; color: string }[] = [];
    for (const d of layout.devices.values()) {
      if (d.kind !== 'sensor' || !d.position) continue;
      const apt = floorOf.get(d.unitId);
      if (apt && byBuilding.get(apt.b)?.supportsPlan) continue;
      const bId = apt?.b ?? (d.unitId.endsWith('-S') ? d.unitId.slice(0, -2) : byBuilding.has(d.unitId) ? d.unitId : null);
      if (bId) {
        const b = byBuilding.get(bId)!;
        const f = apt?.f ?? Math.min(b.floors, Math.floor((d.position.y - PLINTH_M) / b.floorHeight + 1e-6));
        if (!visible(bId, f) && !(f === b.floors && useUiStore.getState().floor === null)) continue;
      }
      out.push({ id: d.deviceId, p: d.position, color: bId ? FAMILY[d.type] ?? OUTDOOR : OUTDOOR });
    }
    return out;
  }, [layout, floorOf, byBuilding, visible]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), col = new THREE.Color();
    shown.forEach((s, i) => {
      m.makeTranslation(s.p.x, s.p.y, s.p.z);
      puck.current!.setMatrixAt(i, m);
      ring.current!.setMatrixAt(i, m);
      ring.current!.setColorAt(i, col.set(s.color));
    });
    for (const x of [puck.current!, ring.current!]) { x.count = shown.length; x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere(); }
    if (ring.current!.instanceColor) ring.current!.instanceColor.needsUpdate = true;
  }, [shown]);

  const cap = Math.max(1, layout.devices.size);
  const ids = shown.map((s) => s.id);
  return (
    <>
      <instancedMesh ref={puck} args={[PUCK, fixedMat('puck', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 })), cap]}
        userData={{ instanceDevices: ids }} frustumCulled={false} />
      <instancedMesh ref={ring} args={[RING, fixedMat('puckRing', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 })), cap]}
        userData={{ instanceDevices: ids }} frustumCulled={false} />
    </>
  );
}

// ---------------------------------------------------------------- apartment actuators
const sashMat = () => fixedMat('sash', () => new THREE.MeshStandardMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.6, roughness: 0.1 }));
const blindMat = () => fixedMat('blind', () => new THREE.MeshStandardMaterial({ color: '#8a8178', roughness: 0.9 }));
const deviceMat = () => fixedMat('device', () => new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.5 }));
const pipeMat = () => fixedMat('pipe', () => new THREE.MeshStandardMaterial({ color: '#a8a29e', metalness: 0.6, roughness: 0.4 }));
const handleMat = () => fixedMat('handle', () => new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.4 }));

function useEmissive(color: string) {
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.4 }), [color]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Opening sashes and blinds on the windows of one apartment (solid floors). */
export function WindowActuators({ b, apt, immersive = false }: { b: BuildingGeom; apt: ApartmentGeom; immersive?: boolean }) {
  const sashes = useRef<(THREE.Group | null)[]>([]);
  const blinds = useRef<(THREE.Mesh | null)[]>([]);
  const cur = useRef({ angle: 0, cover: 0 });
  const wins = useMemo(() => WINDOWS.filter((w) => w.unit === 'apt1').map((w) => {
    const v = w.side === 1 ? PLAN_D : 0;
    const [xa, z] = planLocal(b, w.u0, v, apt.mirrored);
    const [xb] = planLocal(b, w.u1, v, apt.mirrored);
    const h = w.tall ? TALL_WINDOW_H_M : WINDOW_H_M;
    return { x0: Math.min(xa, xb), w: Math.abs(xb - xa), z, h, y0: PLINTH_M + apt.floor * b.floorHeight + (w.tall ? 0 : SILL_M) };
  }), [b, apt]);

  useFrame((_, dt) => {
    const c = cur.current;
    c.angle = approach(c.angle, windowAngle(stateOf(`${apt.id}.window`)), dt, (70 * Math.PI) / 180);
    c.cover = approach(c.cover, blindsCover(stateOf(`${apt.id}.blinds`)), dt, 1);
    wins.forEach((w, i) => {
      const g = sashes.current[i];
      // The sash swings outwards: inwards it would disappear inside the opaque apartment volume.
      if (g) { g.visible = immersive || c.angle > 0.001; g.rotation.y = -Math.sign(w.z) * c.angle; }
      const bl = blinds.current[i];
      if (bl) {
        bl.visible = c.cover > 0.001;
        bl.scale.set(w.w, Math.max(0.001, w.h * c.cover), 0.08);
        bl.position.set(w.x0 + w.w / 2, w.y0 + w.h - (w.h * c.cover) / 2, w.z + Math.sign(w.z) * 0.12);
      }
    });
  });

  return (
    <group userData={{ deviceId: `${apt.id}.window` }}>
      {wins.map((w, i) => (
        <group key={i} ref={(g) => { sashes.current[i] = g; }} position={[w.x0, w.y0 + w.h / 2, w.z + Math.sign(w.z) * 0.08]} visible={false}>
          <mesh geometry={UNIT_BOX} material={sashMat()} position={[w.w / 2, 0, 0]} scale={[w.w, w.h, 0.05]} />
        </group>
      ))}
      {wins.map((_, i) => (
        <mesh key={`b${i}`} ref={(m) => { blinds.current[i] = m; }} geometry={UNIT_BOX} material={blindMat()} visible={false}
          userData={{ deviceId: `${apt.id}.blinds` }} />
      ))}
    </group>
  );
}

/**
 * Interior devices of one apartment, shown on the cut floor. `realHeights` mounts them as in the
 * first person, as the 3D cut does with its whole walls (V20); the 2D plan keeps them low.
 */
export function InteriorActuators({ b, apt, immersive = false, realHeights = immersive }: {
  b: BuildingGeom; apt: ApartmentGeom; immersive?: boolean; realHeights?: boolean;
}) {
  const y0 = PLINTH_M + apt.floor * b.floorHeight;
  const at = (type: string): [number, number, number] => {
    const pl = apartmentDevicePose(type, realHeights);
    if (!pl) return [0, 0, 0];
    const [x, z] = planLocal(b, pl.u, pl.v, apt.mirrored);
    return [x, y0 + pl.h, z];
  };
  const lampMat = useEmissive('#fde68a');
  const alarmMat = useEmissive('#ef4444');
  const flowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#60a5fa', transparent: true, opacity: 0.8 }), []);
  const displayMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f2937', emissive: '#000000', roughness: 0.3 }), []);
  useLayoutEffect(() => () => { flowMat.dispose(); displayMat.dispose(); }, [flowMat, displayMat]);
  const roomLights = useRef<(THREE.PointLight | null)[]>([]);
  const vent = useRef<THREE.Mesh>(null);
  const handle = useRef<THREE.Mesh>(null);
  const flow = useRef<THREE.Group>(null);
  const cur = useRef({ lamp: 0, handle: 0 });
  const [display, setDisplay] = useState({ visible: false, message: '', color: '#3b82f6' });

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const c = cur.current;
    c.lamp = approach(c.lamp, lightLevel(stateOf(`${apt.id}.lights`)), dt);
    lampMat.emissiveIntensity = 2.5 * c.lamp;
    for (const light of roomLights.current) if (light) light.intensity = 16 * c.lamp;
    alarmMat.emissiveIntensity = sirenOn(stateOf(`${apt.id}.alarm`)) ? 3 * blink(t, 2) : 0;
    if (vent.current) vent.current.rotation.y += 2 * Math.PI * ventTurnsPerSecond(stateOf(`${apt.id}.ventilation`)) * dt;
    c.handle = approach(c.handle, valveOpen(stateOf(`${apt.id}.gas_valve`)) ? 0 : Math.PI / 2, dt, Math.PI / 2);
    if (handle.current) handle.current.rotation.y = c.handle;
    const f = hvacFlow(stateOf(`${apt.id}.hvac`));
    if (flow.current) {
      flow.current.visible = f !== null;
      flowMat.color.set(f === 'heat' ? '#f87171' : '#60a5fa');
      flow.current.children.forEach((p, i) => { p.position.y = -((t * 0.8 + i / 5) % 1) * 0.85; });
    }
    const dv = displayVisual(stateOf(`${apt.id}.resident_display`));
    displayMat.emissive.set(dv.visible ? dv.color : '#000000');
    displayMat.emissiveIntensity = dv.visible ? 1.2 : 0;
    if (dv.visible !== display.visible || dv.message !== display.message || dv.color !== display.color) setDisplay(dv);
  });

  const turn = apt.mirrored ? Math.PI : 0;
  const [kx, kz] = planLocal(b, 10.381, 5.65, apt.mirrored);
  const facing = (type: string) => turn + (apartmentDevicePose(type, realHeights)?.rotationY ?? 0);
  return (
    <group>
      {ROOM_LIGHTS.map((l, i) => {
        const [x, z] = planLocal(b, l.u, l.v, apt.mirrored);
        return <group key={l.room} position={[x, y0 + (realHeights ? l.h : .8), z]} rotation={[0, turn + l.rotationY, 0]} userData={{ deviceId: `${apt.id}.lights` }}>
          <DeviceShell type="light" />
          <mesh geometry={UNIT_BOX} material={lampMat} position={[0, 0, .06]} scale={[.16, .2, .04]} />
          {immersive && <pointLight ref={(p) => { roomLights.current[i] = p; }} position={[0, 0, .3]} intensity={0} distance={8} decay={2} color="#ffe5b6" />}
        </group>;
      })}
      <group position={at('hvac')} rotation={[0, facing('hvac'), 0]} userData={{ deviceId: `${apt.id}.hvac` }}>
        <DeviceShell type="hvac" />
        <group ref={flow} position={[0, -0.2, 0.15]} visible={false}>
          {Array.from({ length: 5 }, (_, i) => <mesh key={i} material={flowMat} position={[(i - 2) * 0.15, 0, 0]}><sphereGeometry args={[0.05, 6, 4]} /></mesh>)}
        </group>
      </group>
      <group position={at('ventilation')} rotation={[0, facing('ventilation'), 0]} userData={{ deviceId: `${apt.id}.ventilation` }}>
        <group rotation={[Math.PI / 2, 0, 0]}>
        <DeviceShell type="ventilation" />
        <mesh ref={vent} material={deviceMat()}>
          <boxGeometry args={[0.34, 0.025, 0.07]} />
          <mesh geometry={UNIT_BOX} material={deviceMat()} scale={[0.07, 0.025, 0.34]} />
        </mesh>
      </group>
      </group>
      <group position={at('gas_valve')} rotation={[0, turn, 0]} userData={{ deviceId: `${apt.id}.gas_valve` }}>
        <mesh material={handleMat()} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.6, 8]} /></mesh>
        <mesh material={pipeMat()}><sphereGeometry args={[0.065, 10, 6]} /></mesh>
        <mesh ref={handle} geometry={UNIT_BOX} material={handleMat()} position={[0, 0.085, 0]} scale={[0.075, 0.04, 0.24]}>
          <mesh geometry={UNIT_BOX} material={pipeMat()} scale={[0.8, 1.2, 0.17]} />
        </mesh>
      </group>
      <group position={at('alarm')} rotation={[0, facing('alarm'), 0]} userData={{ deviceId: `${apt.id}.alarm` }}>
        <group rotation={[Math.PI / 2, 0, 0]}><DeviceShell type="alarm" />
        <mesh material={alarmMat} position={[0.06, 0.065, 0.07]}><sphereGeometry args={[0.075, 12, 8]} /></mesh></group>
      </group>
      <group position={[kx, y0 + (realHeights ? 1.45 : .9), kz]} rotation={[0, turn - Math.PI / 2, 0]} userData={{ deviceId: `${apt.id}.alarm` }}>
        <DeviceShell type="keypad" />
      </group>
      <group position={at('water_flow')} rotation={[0, turn - Math.PI / 2, 0]} userData={{ unitId: apt.id }}>
        <DeviceShell type="meters" />
      </group>
      <group position={at('resident_display')} rotation={[0, turn - Math.PI / 2, 0]} userData={{ deviceId: `${apt.id}.resident_display` }}>
        <DeviceShell type="resident_display" />
        <mesh geometry={UNIT_BOX} material={displayMat} position={[0, 0, 0.02]} scale={[0.25, 0.15, 0.008]} />
        {display.visible && (
          <Html center position={[0, 0.5, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[16, 0]}>
            <div className="label" style={{ background: display.color, color: '#0f172a', borderColor: 'transparent' }}>📟 {display.message}</div>
          </Html>
        )}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- stairwell and building
function StairwellActuators({ b, cutFloor, roofVisible }: { b: BuildingGeom; cutFloor: number | null; roofVisible: boolean }) {
  const id = `${b.id}-S`;
  const lamps = useEmissive('#fde68a');
  const siren = useEmissive('#ef4444');
  const lid = useRef<THREE.Group>(null);
  const cur = useRef({ lid: 0 });
  const floors = cutFloor === null ? [] : [cutFloor];

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const mode = stairLightsVisual(stateOf(`${id}.stair_lights`));
    lamps.emissive.set(mode === 'evacuation' ? '#22c55e' : '#fde68a');
    lamps.color.set(mode === 'evacuation' ? '#22c55e' : '#fde68a');
    lamps.emissiveIntensity = mode === 'off' ? 0 : mode === 'normal' ? 2 : 3 * blink(t, 1.5);
    siren.emissiveIntensity = sirenOn(stateOf(`${id}.evacuation_siren`)) ? 3 * blink(t, 2) : 0;
    cur.current.lid = approach(cur.current.lid, smokeVentOpen(stateOf(`${id}.smoke_vent`)) ? 1 : 0, dt);
    if (lid.current) lid.current.rotation.x = -cur.current.lid * (Math.PI / 3);
  });

  const [lx, lz] = planLocal(b, 10.66, 6.5);
  const [sx, sz] = planLocal(b, 10.65, 7.15);
  const [vx, vz] = planLocal(b, 13, 2.5);
  const roofY = PLINTH_M + b.floors * b.floorHeight + 0.3;
  return (
    <group>
      {floors.map((f) => (
        <group key={f}>
          <group position={[lx, PLINTH_M + f * b.floorHeight + .8, lz]} rotation={[0, Math.PI / 2, 0]} userData={{ deviceId: `${id}.stair_lights` }}>
            <DeviceShell type="light" />
            <mesh geometry={UNIT_BOX} material={lamps} position={[0, 0, .06]} scale={[.16, .2, .04]} />
          </group>
          <group position={[sx, PLINTH_M + f * b.floorHeight + .9, sz]} rotation={[0, Math.PI / 2, 0]} userData={{ deviceId: `${id}.evacuation_siren` }}>
            <mesh geometry={UNIT_BOX} material={deviceMat()} scale={[.26, .28, .08]} />
            <mesh geometry={UNIT_BOX} material={siren} position={[0, .05, .06]} scale={[.18, .07, .05]} />
          </group>
        </group>
      ))}
      {roofVisible && (
        <group position={[vx, roofY, vz - 0.6]} userData={{ deviceId: `${id}.smoke_vent` }}>
          <mesh geometry={UNIT_BOX} material={deviceMat()} position={[0, 0.15, 0.6]} scale={[1.4, 0.3, 1.2]} />
          <group ref={lid} position={[0, 0.32, 0]}>
            <mesh geometry={UNIT_BOX} material={pipeMat()} position={[0, 0, 0.6]} scale={[1.5, 0.06, 1.3]} />
          </group>
        </group>
      )}
    </group>
  );
}

function BuildingActuators({ b }: { b: BuildingGeom }) {
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1.5 }), []);
  const fill = useMemo(() => new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#16a34a', emissiveIntensity: 0.6 }), []);
  const doors = useRef<[THREE.Mesh | null, THREE.Mesh | null]>([null, null]);
  const bar = useRef<THREE.Mesh>(null);
  const arrow = useRef<THREE.Mesh>(null);
  const cur = useRef({ open: 0 });
  const [dx, dz] = planLocal(b, (LIFT.u0 + LIFT.u1) / 2, LIFT.v1 - 2.4 + 0.02);   // lift doors face the landing (v = 8.5)
  const [bx, bz] = planLocal(b, 14.2, 9);

  useFrame(({ clock }, dt) => {
    const e = elevatorVisual(stateOf(`${b.id}.elevator`));
    lamp.color.set(e.lamp === 'red' ? '#ef4444' : '#22c55e');
    lamp.emissive.set(e.lamp === 'red' ? '#ef4444' : '#22c55e');
    cur.current.open = approach(cur.current.open, e.doorsOpen ? 1 : 0, dt);
    const [l, r] = doors.current;
    if (l) l.position.x = -0.45 - cur.current.open * 0.8;
    if (r) r.position.x = 0.45 + cur.current.open * 0.8;
    const bv = batteryVisual(stateOf(`${b.id}.battery`));
    if (bar.current) { bar.current.scale.y = Math.max(0.01, bv.fill * 1.2); bar.current.position.y = 0.2 + (bv.fill * 1.2) / 2; }
    if (arrow.current) {
      arrow.current.visible = bv.arrow !== null;
      arrow.current.rotation.z = bv.arrow === 'down' ? Math.PI : 0;
      arrow.current.position.y = 1.75 + 0.08 * Math.sin(clock.elapsedTime * 4);
    }
  });

  return (
    <group position={[0, PLINTH_M, 0]}>
      <group position={[dx, 0, dz]} rotation={[0, 0, 0]} userData={{ deviceId: `${b.id}.elevator` }}>
        <mesh ref={(m) => { doors.current[0] = m; }} geometry={UNIT_BOX} material={pipeMat()} position={[-0.45, 1.05, -0.05]} scale={[0.9, 2.1, 0.06]} />
        <mesh ref={(m) => { doors.current[1] = m; }} geometry={UNIT_BOX} material={pipeMat()} position={[0.45, 1.05, -0.05]} scale={[0.9, 2.1, 0.06]} />
        <mesh material={lamp} position={[0, 2.35, -0.05]}><sphereGeometry args={[0.1, 10, 6]} /></mesh>
      </group>
      <group position={[bx, 0, bz]} userData={{ deviceId: `${b.id}.battery` }}>
        <mesh geometry={UNIT_BOX} material={deviceMat()} position={[0, 0.8, 0]} scale={[0.8, 1.6, 0.5]} />
        <mesh ref={bar} geometry={UNIT_BOX} material={fill} position={[0, 0.8, 0.27]} scale={[0.25, 1.2, 0.04]} />
        <mesh ref={arrow} material={fill} position={[0, 1.75, 0.27]}><coneGeometry args={[0.15, 0.3, 8]} /></mesh>
      </group>
    </group>
  );
}

function BuildingDevices({ b, apartments }: { b: BuildingGeom; apartments: ApartmentGeom[] }) {
  const floor = useUiStore((s) => s.floor);
  const building = useUiStore((s) => s.building);
  const plan2d = useUiStore((s) => s.mode === '2d');
  return (
    <group position={[b.center.x, 0, b.center.z]} rotation={[0, b.rotationY, 0]}>
      {/* Sashes and blinds on solid floors, and on the window openings of the 3D cut (V20). */}
      {b.supportsPlan && apartments.filter((a) => floorMode(a.floor, floor) === 'solid' || (a.floor === floor && !plan2d))
        .map((a) => <WindowActuators key={`w${a.id}`} b={b} apt={a} />)}
      {b.supportsPlan && apartments.filter((a) => floor === a.floor).map((a) => <InteriorActuators key={`i${a.id}`} b={b} apt={a} realHeights={!plan2d} />)}
      <StairwellActuators b={b} cutFloor={floor} roofVisible={floor === null} />
      {(floor === 0 || (floor === null && building === b.id)) && <BuildingActuators b={b} />}
    </group>
  );
}

// ---------------------------------------------------------------- park
function ParkActuators({ layout }: { layout: ComplexLayout }) {
  const jets = useRef<THREE.Group>(null);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const signMat = useEmissive('#22c55e');
  const jetMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#bae6fd', transparent: true, opacity: 0.55 }), []);
  const lampOn = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const on = parkState(stateOf('park.irrigation'));
    if (jets.current) {
      jets.current.visible = on;
      jets.current.children.forEach((g, i) => g.children.forEach((p, k) => {
        const ph = (t * 0.9 + k / 6 + i * 0.13) % 1;
        p.position.set(Math.cos(k) * ph * 2.2, 0.3 + Math.sin(ph * Math.PI) * 1.4, Math.sin(k) * ph * 2.2);
      }));
    }
    lampOn.current = approach(lampOn.current, parkState(stateOf('park.park_lights')) ? 1 : 0, dt);
    const lamp = fixedMat('lampOff', () => new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#fde68a', emissiveIntensity: 0 })) as THREE.MeshStandardMaterial;
    lamp.emissiveIntensity = 2 * lampOn.current;
    for (const l of lights.current) if (l) l.intensity = 30 * lampOn.current;
    signMat.emissiveIntensity = parkState(stateOf('park.evacuation_signs')) ? 1.5 + blink(t, 1) : 0;
  });

  return (
    <group>
      <group ref={jets} visible={false} userData={{ deviceId: 'park.irrigation' }}>
        {layout.parkFixtures.irrigation.map((h, i) => (
          <group key={i} position={[h.x, 0, h.z]}>
            {Array.from({ length: 6 }, (_, k) => <mesh key={k} material={jetMat}><sphereGeometry args={[0.09, 6, 4]} /></mesh>)}
          </group>
        ))}
      </group>
      {layout.parkFixtures.lamps.map((p, i) => (
        <group key={i} userData={{ deviceId: 'park.park_lights' }}>
          <pointLight ref={(l) => { lights.current[i] = l; }} position={[p.x, 4, p.z]} color="#fde68a" intensity={0} distance={14} decay={2} />
          <mesh position={[p.x, 2, p.z]} visible={false}><boxGeometry args={[0.6, 4, 0.6]} /></mesh>
        </group>
      ))}
      {layout.parkFixtures.signs.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} userData={{ deviceId: 'park.evacuation_signs' }}>
          <mesh material={pipeMat()} position={[0, 0.9, 0]}><cylinderGeometry args={[0.04, 0.04, 1.8, 6]} /></mesh>
          <mesh geometry={UNIT_BOX} material={signMat} position={[0, 1.9, 0]} scale={[0.8, 0.5, 0.06]} />
        </group>
      ))}
    </group>
  );
}

export function Devices({ layout }: { layout: ComplexLayout }) {
  return (
    <group>
      <SensorPucks layout={layout} />
      <ApartmentSensors layout={layout} />
      {layout.buildings.map((b) => (
        <BuildingDevices key={b.id} b={b} apartments={layout.apartments.filter((a) => a.building === b.id)} />
      ))}
      <ParkActuators layout={layout} />
    </group>
  );
}
