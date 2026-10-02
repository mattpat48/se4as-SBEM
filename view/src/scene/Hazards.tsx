// Emergencies from the sensors only (view spec §7.8, V17): smoke puffs from the windows (and up
// the stairwell), flickering fire light, greenish gas haze on the cut floor, a "☠ CO" badge.
// The red pulse stays in HeatPainter; siren flashers are in Devices.
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { coWarning, gasHaze, isFire, smokeDensity } from '../domain/effects';
import { planToWorld, type ComplexLayout, type Vec3 } from '../domain/layout';
import { PLAN_D, WINDOWS } from '../domain/plan';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { readingNow } from './readings';

const MAX_PARTICLES = 2400;
const LIFE_S = 5;
const EMIT_PER_S = 30;
const BUCKETS = [{ until: 1.2, size: 1.6, opacity: 0.55 }, { until: 3, size: 3, opacity: 0.35 }, { until: LIFE_S, size: 4.5, opacity: 0.18 }];
const MAX_FIRE_LIGHTS = 4;

interface Emitter { unitId: string; sensor: string; points: { p: Vec3; out: Vec3 }[] }

function puffTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function emitters(layout: ComplexLayout): Emitter[] {
  const byId = new Map(layout.buildings.map((b) => [b.id, b]));
  const out: Emitter[] = [];
  for (const a of layout.apartments) {
    const b = byId.get(a.building);
    if (!b?.supportsPlan) continue;
    const points = WINDOWS.filter((w) => w.unit === 'apt1').map((w) => {
      const u = (w.u0 + w.u1) / 2, v = w.side === 1 ? PLAN_D : 0, vOut = w.side === 1 ? PLAN_D + 1 : -1;
      const p = planToWorld(b, u, v, 1.8, a.floor, a.mirrored);
      const q = planToWorld(b, u, vOut, 1.8, a.floor, a.mirrored);
      return { p, out: { x: q.x - p.x, y: 0, z: q.z - p.z } };
    });
    out.push({ unitId: a.id, sensor: 'smoke', points });
  }
  for (const b of layout.buildings) {
    // Stairwell: up the stairs, out of the stair windows (side 2) and the androne.
    const points = Array.from({ length: b.floors }, (_, f) => {
      const p = planToWorld(b, 13, 0, 1.8, f, false);
      const q = planToWorld(b, 13, -1, 1.8, f, false);
      return { p, out: { x: q.x - p.x, y: 0, z: q.z - p.z } };
    });
    out.push({ unitId: `${b.id}-S`, sensor: 'smoke', points });
  }
  return out;
}

export function Hazards({ layout }: { layout: ComplexLayout }) {
  const sources = useMemo(() => emitters(layout), [layout]);
  const texture = useMemo(puffTexture, []);
  const pool = useMemo(() => ({
    pos: new Float32Array(MAX_PARTICLES * 3), vel: new Float32Array(MAX_PARTICLES * 3),
    age: new Float32Array(MAX_PARTICLES).fill(LIFE_S), next: 0, debt: new Map<string, number>(),
  }), []);
  const bucketGeoms = useMemo(() => BUCKETS.map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }), []);
  const bucketMats = useMemo(() => BUCKETS.map((bk) => new THREE.PointsMaterial({
    size: bk.size, map: texture, color: '#6b7280', transparent: true, opacity: bk.opacity, depthWrite: false, sizeAttenuation: true,
  })), [texture]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const gas = useRef<Map<string, THREE.Mesh>>(new Map());
  const [coUnits, setCoUnits] = useState<string[]>([]);
  const acc = useRef(0);
  const byId = useMemo(() => new Map(layout.buildings.map((b) => [b.id, b])), [layout]);
  const centers = useMemo(() => new Map(layout.apartments.map((a) => {
    const b = byId.get(a.building)!;
    return [a.id, planToWorld(b, 5.25, 6, 1.6, a.floor, a.mirrored)];
  })), [layout, byId]);

  useFrame(({ clock }, dt) => {
    const now = Date.now();
    const t = clock.elapsedTime;
    const step = Math.min(dt, 0.1);

    // Smoke: emit from every source in proportion to its density, then advance the pool.
    for (const s of sources) {
      const density = smokeDensity(readingNow(`${s.unitId}.${s.sensor}`, now));
      if (density <= 0) { pool.debt.delete(s.unitId); continue; }
      let debt = (pool.debt.get(s.unitId) ?? 0) + density * EMIT_PER_S * step;
      while (debt >= 1) {
        debt -= 1;
        const src = s.points[Math.floor(Math.random() * s.points.length)];
        const i = pool.next;
        pool.next = (pool.next + 1) % MAX_PARTICLES;
        pool.pos.set([src.p.x + (Math.random() - 0.5), src.p.y + Math.random() * 0.5, src.p.z + (Math.random() - 0.5)], i * 3);
        pool.vel.set([src.out.x * 0.8 + (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.6, src.out.z * 0.8 + (Math.random() - 0.5) * 0.4], i * 3);
        pool.age[i] = 0;
      }
      pool.debt.set(s.unitId, debt);
    }
    const counts = BUCKETS.map(() => 0);
    const arrays = bucketGeoms.map((g) => g.getAttribute('position').array as Float32Array);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (pool.age[i] >= LIFE_S) continue;
      pool.age[i] += step;
      for (let k = 0; k < 3; k++) pool.pos[i * 3 + k] += pool.vel[i * 3 + k] * step;
      const b = BUCKETS.findIndex((bk) => pool.age[i] < bk.until);
      if (b < 0) continue;
      arrays[b].set(pool.pos.subarray(i * 3, i * 3 + 3), counts[b] * 3);
      counts[b]++;
    }
    bucketGeoms.forEach((g, b) => {
      g.setDrawRange(0, counts[b]);
      g.getAttribute('position').needsUpdate = true;
      g.computeBoundingSphere();
    });

    // Fire: a flickering orange light in up to four burning apartments.
    let li = 0;
    const cutFloor = useUiStore.getState().floor;
    const walk = useWalkStore.getState();
    const open = walk.active ? walk.openBuilding : null;
    for (const a of layout.apartments) {
      const burning = isFire(readingNow(`${a.id}.temperature`, now), readingNow(`${a.id}.smoke`, now));
      if (burning && li < MAX_FIRE_LIGHTS) {
        const l = lights.current[li++];
        const c = centers.get(a.id)!;
        if (l) { l.position.set(c.x, c.y, c.z); l.intensity = 40 + 25 * Math.sin(t * 17) * Math.sin(t * 7.3); }
      }
      const haze = gas.current.get(a.id);
      if (haze) haze.visible = (open ? a.building === open : cutFloor === a.floor) && gasHaze(readingNow(`${a.id}.gas`, now));
    }
    for (; li < MAX_FIRE_LIGHTS; li++) { const l = lights.current[li]; if (l) l.intensity = 0; }

    // CO badges: re-evaluated twice a second.
    acc.current += dt;
    if (acc.current >= 0.5) {
      acc.current = 0;
      const co = layout.apartments
        .filter((a) => (cutFloor === null || a.floor === cutFloor) && coWarning(readingNow(`${a.id}.co`, now)))
        .map((a) => a.id);
      setCoUnits((prev) => (prev.join() === co.join() ? prev : co));
    }
  });

  const hazeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#84cc16', transparent: true, opacity: 0.25, depthWrite: false }), []);

  return (
    <group>
      {bucketGeoms.map((g, i) => <points key={i} geometry={g} material={bucketMats[i]} frustumCulled={false} />)}
      {Array.from({ length: MAX_FIRE_LIGHTS }, (_, i) => (
        <pointLight key={i} ref={(l) => { lights.current[i] = l; }} color="#fb923c" intensity={0} distance={14} decay={2} />
      ))}
      {layout.apartments.map((a) => {
        const b = byId.get(a.building)!;
        const c = centers.get(a.id)!;
        return (
          <mesh key={a.id} ref={(m) => { if (m) gas.current.set(a.id, m); else gas.current.delete(a.id); }} visible={false}
            material={hazeMat} position={[c.x, c.y - 0.2, c.z]} rotation={[0, b.rotationY, 0]} scale={[10 * b.width / 26, 2.4, 11.6 * b.depth / 12]}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
        );
      })}
      {coUnits.map((id) => {
        const c = centers.get(id)!;
        return (
          <Html key={id} position={[c.x, c.y + 1.8, c.z]} center zIndexRange={[17, 0]} style={{ pointerEvents: 'none' }}>
            <div className="label label--hazard">☠ CO</div>
          </Html>
        );
      })}
    </group>
  );
}
