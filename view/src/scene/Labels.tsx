// Overlays by zoom level (view spec §8.4, V11): far → only ⚠ on hazards, mid → one label per
// apartment, near (or a cut floor) → the installed devices with their values. At most 40,
// the nearest in view, re-chosen at most 4 times per second.
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { apartmentDevicePose } from '../domain/deviceAppearance';
import { DEVICE_ICONS, formatValue, mainStateText } from '../domain/format';
import { HEAT_SCALES, isHazard } from '../domain/heat';
import { displayedValue, isStale } from '../domain/interpolate';
import { planToWorld, type ComplexLayout, type DevicePlacement, type Vec3 } from '../domain/layout';
import { lodLevel, pickLabels } from '../domain/lod';
import type { SensorType } from '../domain/messages';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';

const REFRESH_S = 0.25;

interface LabelItem { key: string; position: Vec3; text: string; kind: 'hazard' | 'unit' | 'device'; distance: number; inView: boolean }

function deviceText(d: DevicePlacement, now: number, period: number, types: Record<string, SensorType>): string {
  const icon = DEVICE_ICONS[d.type] ?? '•';
  const live = useLiveStore.getState();
  if (d.kind === 'actuator') {
    const s = live.states.get(d.deviceId);
    return `${icon} ${s ? mainStateText(d.type, s.state) : '…'}`;
  }
  const r = live.readings.get(d.deviceId);
  if (!r) return `${icon} …`;
  const unit = r.unit || types[d.type]?.unit || '';
  return `${icon} ${formatValue(isStale(r.lastAt, now, period) ? r.last : displayedValue(r, now, period), unit)}`;
}

export function Labels({ layout }: { layout: ComplexLayout }) {
  const model = useModelStore((s) => s.model)!;
  const types = model.device_types as Record<string, SensorType>;
  const plan2d = useUiStore((s) => s.mode === '2d');
  const [items, setItems] = useState<LabelItem[]>([]);
  const acc = useRef(REFRESH_S);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  const byId = useMemo(() => new Map(layout.buildings.map((b) => [b.id, b])), [layout]);
  const apartmentAnchors = useMemo(() => layout.apartments.map((a) => {
    const b = byId.get(a.building)!;
    return { apt: a, solid: planToWorld(b, 5.25, 6, b.floorHeight * 0.55, a.floor, a.mirrored), cut: planToWorld(b, 5.25, 6, 1.6, a.floor, a.mirrored) };
  }), [layout, byId]);
  const cutDevicePositions = useMemo(() => {
    const out = new Map<string, Vec3>();
    for (const a of layout.apartments) {
      const b = byId.get(a.building)!;
      if (!b.supportsPlan) continue;
      for (const d of layout.devices.values()) {
        if (d.unitId !== a.id) continue;
        const p = apartmentDevicePose(d.type, !plan2d);
        if (p) out.set(d.deviceId, planToWorld(b, p.u, p.v, p.h + .18, a.floor, a.mirrored));
      }
    }
    return out;
  }, [layout, byId, plan2d]);
  const devicesByUnit = useMemo(() => {
    const out = new Map<string, DevicePlacement[]>();
    for (const d of layout.devices.values()) if (d.position) out.set(d.unitId, [...(out.get(d.unitId) ?? []), d]);
    return out;
  }, [layout]);

  useFrame(({ camera }, delta) => {
    acc.current += delta;
    if (acc.current < REFRESH_S) return;
    acc.current = 0;
    const ui = useUiStore.getState();
    const live = useLiveStore.getState();
    const now = Date.now();
    const period = model.complex.sampling_period_s * 1000;
    const cut = ui.floor !== null;
    frustum.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const out: LabelItem[] = [];
    const push = (key: string, p: Vec3, text: string, kind: LabelItem['kind']) => {
      v.set(p.x, p.y, p.z);
      out.push({ key, position: p, text, kind, distance: camera.position.distanceTo(v), inView: frustum.containsPoint(v) });
    };
    const q = ui.heatQuantity;
    const pushDevices = (unitId: string) => {
      for (const d of devicesByUnit.get(unitId) ?? []) push(d.deviceId, cut ? cutDevicePositions.get(d.deviceId) ?? d.position! : d.position!, deviceText(d, now, period, types), 'device');
    };

    for (const { apt, solid, cut: cutAnchor } of apartmentAnchors) {
      if (cut && apt.floor !== ui.floor) continue;
      const anchor = cut ? cutAnchor : solid;
      const last = (t: string) => live.readings.get(`${apt.id}.${t}`)?.last;
      const hazard = isHazard({ smoke: last('smoke'), gas: last('gas'), co: last('co') }, types);
      const lod = lodLevel(camera.position.distanceTo(v.set(anchor.x, anchor.y, anchor.z)), cut);
      if (lod === 'far') {
        if (hazard) push(`${apt.id}!`, anchor, '⚠', 'hazard');
      } else if (lod === 'near' && (cut || ui.building === apt.building)) {
        pushDevices(apt.id);
      } else {
        const r = live.readings.get(`${apt.id}.${q}`);
        const value = r ? formatValue(displayedValue(r, now, period), HEAT_SCALES[q].unit) : 'in attesa';
        push(apt.id, anchor, `${hazard ? '⚠ ' : ''}${apt.id} · ${value}`, hazard ? 'hazard' : 'unit');
      }
    }
    // Stairwells and buildings: devices when close, on the cut floor or in the selected building.
    for (const b of layout.buildings) {
      for (const unitId of [`${b.id}-S`, b.id]) {
        for (const d of devicesByUnit.get(unitId) ?? []) {
          const p = d.position!;
          const dist = camera.position.distanceTo(v.set(p.x, p.y, p.z));
          const floor = Math.floor((p.y - 0.6) / b.floorHeight + 1e-6);
          const visible = cut ? floor === ui.floor : ui.building === b.id && lodLevel(dist, false) === 'near';
          if (visible) push(d.deviceId, p, deviceText(d, now, period, types), 'device');
        }
      }
    }
    // Park and parking: when close.
    for (const unitId of ['park', ...layout.chargers.map((c) => c.id)]) {
      for (const d of devicesByUnit.get(unitId) ?? []) {
        const p = d.position!;
        if (lodLevel(camera.position.distanceTo(v.set(p.x, p.y, p.z)), false) === 'near')
          push(d.deviceId, p, deviceText(d, now, period, types), 'device');
      }
    }
    const picked = pickLabels(out);
    setItems((prev) => (prev.length === picked.length && prev.every((x, i) => x.key === picked[i].key && x.text === picked[i].text && x.position.x === picked[i].position.x && x.position.y === picked[i].position.y && x.position.z === picked[i].position.z) ? prev : picked));
  });

  return (
    <>
      {items.map((it) => (
        <Html key={it.key} position={[it.position.x, it.position.y, it.position.z]} center zIndexRange={[15, 0]}
          style={{ pointerEvents: 'none' }}>
          <div className={`label label--${it.kind}`}>{it.text}</div>
        </Html>
      ))}
    </>
  );
}
