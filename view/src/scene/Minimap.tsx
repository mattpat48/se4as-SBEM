// A schematic SVG map: no second WebGL pass, no scene duplication or GPU allocations.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import { MINIMAP_EXTENT_M, MINIMAP_SIZE_PX, minimapMarker, minimapToWorld } from '../domain/camera';
import { gardenCore } from '../domain/garden';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { cameraApi } from './CameraRig';

export const MINIMAP_MARGIN_PX = 16;
const markerStore = create(() => ({ x: 0, z: 0, cx: 0, cz: 0, yaw: 0 }));

/** Only camera coordinates change: static map elements do not depend on telemetry or 3D meshes. */
export function MinimapPass() {
  const elapsed = useRef(1);
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  useFrame(({ camera }, dt) => {
    elapsed.current += dt;
    if (elapsed.current < .1) return;
    elapsed.current = 0;
    camera.getWorldDirection(tmp.dir);
    const c = cameraApi.controls;
    if (c) c.getTarget(tmp.target); else tmp.target.copy(camera.position);
    const m = minimapMarker(camera.position, tmp.target, Math.atan2(tmp.dir.x, tmp.dir.z));
    const prev = markerStore.getState();
    if (Math.abs(prev.x - m.dot.x) + Math.abs(prev.z - m.dot.z) + Math.abs(prev.cx - m.wedge.x) + Math.abs(prev.cz - m.wedge.z) + Math.abs(prev.yaw - m.wedge.yaw) > .01)
      markerStore.setState({ x: m.dot.x, z: m.dot.z, cx: m.wedge.x, cz: m.wedge.z, yaw: m.wedge.yaw });
  });
  return null;
}

const floorLabel = (f: number | null) => f === null ? 'Tutti' : f === 0 ? 'T' : String(f);

export function MinimapOverlay() {
  const layout = useModelStore((s) => s.layout);
  const building = useUiStore((s) => s.building);
  const floor = useUiStore((s) => s.floor);
  const marker = markerStore();
  const core = layout ? gardenCore(layout) : null;
  const e = MINIMAP_EXTENT_M;
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const p = minimapToWorld(event.clientX - rect.left, event.clientY - rect.top, rect.width, e);
    const c = cameraApi.controls;
    if (c) c.moveTo(p.x, c.getTarget(new THREE.Vector3()).y, p.z, true);
  };
  return (
    <div className="minimap" style={{ width: MINIMAP_SIZE_PX, height: MINIMAP_SIZE_PX, left: MINIMAP_MARGIN_PX, bottom: MINIMAP_MARGIN_PX }} onClick={onClick} title="Clic per spostare la vista">
      <svg width="100%" height="100%" viewBox={`${-e} ${-e} ${2 * e} ${2 * e}`} role="img" aria-label="Mappa del residence">
        <rect x={-e} y={-e} width={e * 2} height={e * 2} fill="#dfd9cb" />
        <path d="M -82 -72 H 82 V 92 H -82 Z" fill="none" stroke="#8e9795" strokeWidth="8" />
        {core && <g>
          <rect x={core.center.x - core.width / 2} y={core.center.z - core.depth / 2} width={core.width} height={core.depth} fill="#91ac79" />
          <path d={`M ${core.center.x - core.width / 2} ${core.center.z} h ${core.width} M ${core.center.x} ${core.center.z - core.depth / 2} v ${core.depth}`} stroke="#e6ddc6" strokeWidth="3" />
          <circle cx={core.center.x} cy={core.center.z} r={Math.min(core.width, core.depth) / 5} fill="none" stroke="#e6ddc6" strokeWidth="3" />
          <circle cx={core.center.x} cy={core.center.z} r="3.4" fill="#79b5bc" />
        </g>}
        {layout && <rect x={layout.parking.center.x - layout.parking.width / 2} y={layout.parking.center.z - layout.parking.depth / 2} width={layout.parking.width} height={layout.parking.depth} fill="#8c9593" stroke="#f1eadb" />}
        {layout?.buildings.map((b) => <g key={b.id} transform={`translate(${b.center.x} ${b.center.z}) rotate(${-b.rotationY * 180 / Math.PI})`}>
          <rect x={-b.width / 2} y={-b.depth / 2} width={b.width} height={b.depth} fill={building === b.id ? '#deb879' : '#f0e7d4'} stroke="#697569" strokeWidth=".8" />
          <path d={`M ${-b.width / 2 + 1} ${b.depth / 2 + .8} H ${b.width / 2 - 1}`} stroke="#80a9a6" strokeWidth="1.4" />
          <text textAnchor="middle" dominantBaseline="central" fontSize="6" fill="#26352f">{b.id}</text>
        </g>)}
        <path d="M 0 0 L -17 36 L 17 36 Z" transform={`translate(${marker.cx} ${marker.cz}) rotate(${-marker.yaw * 180 / Math.PI})`} fill="#e3aa42" opacity=".35" />
        <circle cx={marker.x} cy={marker.z} r="2.8" fill="#e3aa42" stroke="#fff" strokeWidth=".8" />
      </svg>
      <span className="minimap__north">▲ N</span>
      <span className="minimap__label">{building ?? 'Tutti'} · piano {floorLabel(floor)}</span>
    </div>
  );
}
