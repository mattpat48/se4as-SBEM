// Paints every apartment each frame (view spec §7.9, §7.8): heat-map tint of windows and cut
// slabs by day, emissive shells by night, grey (striped when stale) without fresh data, and the
// red hazard pulse regardless of the heat map.
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { lightLevel } from '../domain/actuatorVisual';
import { isFire } from '../domain/effects';
import { heatColor, isHazard } from '../domain/heat';
import { displayedValue, isStale } from '../domain/interpolate';
import type { ComplexLayout } from '../domain/layout';
import type { SensorType } from '../domain/messages';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { atmosphere } from './atmosphere';
import { getUnit } from './registry';

export const STALE_COLOR = '#9ca3af';
const HAZARD_COLOR = '#ef4444';
const SELECTED_COLOR = '#f59e0b';
const WARM_LIGHT = '#fde68a';

function stripeTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#6b7280';
  g.lineWidth = 10;
  for (let i = -64; i < 128; i += 24) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const STRIPES = stripeTexture();

function setMap(m: THREE.MeshStandardMaterial, striped: boolean) {
  const map = striped ? STRIPES : null;
  if (m.map !== map) { m.map = map; m.needsUpdate = true; }
}

export function HeatPainter({ layout }: { layout: ComplexLayout }) {
  const model = useModelStore((s) => s.model)!;
  const types = model.device_types as Record<string, SensorType>;
  const residents = useMemo(() => new Map(model.units.map((u) => [u.id, Number(u.attrs.residents ?? 0)])), [model]);
  const c = useMemo(() => ({
    heat: new THREE.Color(), glass: new THREE.Color(), tmp: new THREE.Color(), red: new THREE.Color(HAZARD_COLOR),
    stale: new THREE.Color(STALE_COLOR), sel: new THREE.Color(SELECTED_COLOR), black: new THREE.Color(0, 0, 0),
    warm: new THREE.Color(WARM_LIGHT), glow: new THREE.Color(), fire: new THREE.Color('#fb923c'),
  }), []);

  useFrame(({ clock }) => {
    const ui = useUiStore.getState();
    const live = useLiveStore.getState();
    const now = Date.now();
    const period = model.complex.sampling_period_s * 1000;
    const pulse = 0.4 + 0.4 * Math.sin(2 * Math.PI * clock.elapsedTime * 1.5);
    const night = atmosphere.night;
    const p = atmosphere.palette;
    c.glass.set(p.glass);
    const dataMode = atmosphere.dataMode;
    const touched = new Set<THREE.InstancedMesh>();

    for (const apt of layout.apartments) {
      const parts = getUnit(apt.id);
      if (!parts) continue;
      const r = live.readings.get(`${apt.id}.${ui.heatQuantity}`);
      const state = !r ? 'missing' : isStale(r.lastAt, now, period) ? 'stale' : 'ok';
      if (state === 'ok') c.heat.set(heatColor(ui.heatQuantity, displayedValue(r!, now, period), residents.get(apt.id)));
      else c.heat.copy(c.stale);
      const last = (t: string) => live.readings.get(`${apt.id}.${t}`)?.last;
      const hazard = isHazard({ smoke: last('smoke'), gas: last('gas'), co: last('co') }, types);
      const selected = ui.selectedUnit === apt.id;
      const striped = ui.heatOn && state === 'stale';

      // Windows: glass tinted by the heat colour (day), lit by `lights` at night, red while in hazard.
      if (parts.windows) {
        const w = parts.windows;
        if (hazard) c.tmp.copy(c.glass).lerp(c.red, pulse);
        else if (ui.heatOn && !dataMode) c.tmp.copy(c.glass).lerp(c.heat, 0.45 + 0.4 * night);
        else c.tmp.copy(c.glass);
        const lit = lightLevel(live.states.get(`${apt.id}.lights`)?.state ?? {});
        c.glow.copy(c.warm).multiplyScalar(1.4 * lit * night);
        if (hazard) c.glow.lerp(c.red, pulse * 0.6);
        // Fire (§7.8): flickering orange glow in the windows.
        if (isFire(last('temperature') ?? 0, last('smoke') ?? 0))
          c.glow.copy(c.fire).multiplyScalar(1.6 + 0.8 * Math.sin(clock.elapsedTime * 13) * Math.sin(clock.elapsedTime * 5.1));
        const emissive = w.geometry.getAttribute('instanceEmissive') as THREE.InstancedBufferAttribute | undefined;
        for (const i of parts.windowIndices) {
          w.setColorAt(i, c.tmp);
          emissive?.setXYZ(i, c.glow.r, c.glow.g, c.glow.b);
        }
        touched.add(w);
      }

      // Cut floor slab: the heat colour itself.
      if (parts.floor) {
        const m = parts.floor.material as THREE.MeshStandardMaterial;
        m.color.set(ui.heatOn ? c.heat : c.tmp.set(p.slab));
        setMap(m, striped);
        if (hazard) { m.emissive.copy(c.red); m.emissiveIntensity = pulse; }
        else if (ui.heatOn) { m.emissive.copy(c.heat); m.emissiveIntensity = 0.9 * night; }
        else if (selected) { m.emissive.copy(c.sel); m.emissiveIntensity = 0.25; }
        else m.emissive.copy(c.black);
      }

      // Solid shells: plain wall by day, emissive heat colour by night.
      for (const s of parts.shells) {
        const m = s.material as THREE.MeshStandardMaterial;
        m.color.set(p.wall);
        if (dataMode && ui.heatOn) m.color.lerp(c.heat, 0.55);   // "plastico": colour only on the data
        if (striped) m.color.lerp(c.stale, 0.5);
        setMap(m, striped);
        if (hazard) { m.emissive.copy(c.red); m.emissiveIntensity = pulse; }
        else if (ui.heatOn && night > 0) { m.emissive.copy(c.heat); m.emissiveIntensity = 0.55 * night; }
        else if (selected) { m.emissive.copy(c.sel); m.emissiveIntensity = 0.2; }
        else m.emissive.copy(c.black);
      }
    }
    for (const w of touched) {
      if (w.instanceColor) w.instanceColor.needsUpdate = true;
      const emissive = w.geometry.getAttribute('instanceEmissive');
      if (emissive) emissive.needsUpdate = true;
    }
  });

  return null;
}
