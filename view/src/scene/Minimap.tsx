// Minimap (view spec §8.8): a second render pass from above, bottom-left, with the framed point
// and the camera wedge visible only to the minimap camera (layer 1), plus a DOM frame that handles
// clicks: a click frames the clicked point, where the dot then sits.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MINIMAP_EXTENT_M, MINIMAP_SIZE_PX, minimapMarker, minimapToWorld } from '../domain/camera';
import { useUiStore } from '../store/ui';
import { cameraApi } from './CameraRig';

export const MINIMAP_MARGIN_PX = 16;
const MARKER_LAYER = 1;
const WEDGE_M = 40;

function wedgeGeometry(): THREE.BufferGeometry {
  const half = Math.tan(THREE.MathUtils.degToRad(25)) * WEDGE_M;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, half, 0, WEDGE_M, -half, 0, WEDGE_M], 3));
  return g;
}

const onMarkerLayer = (o: THREE.Object3D | null) => o?.layers.set(MARKER_LAYER);

export function MinimapPass() {
  const miniCam = useMemo(() => {
    const e = MINIMAP_EXTENT_M;
    const c = new THREE.OrthographicCamera(-e, e, e, -e, 1, 500);
    c.position.set(0, 200, 0);
    c.up.set(0, 0, -1);               // north (−Z) up
    c.lookAt(0, 0, 0);
    c.layers.enable(MARKER_LAYER);
    return c;
  }, []);
  const wedgeRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const wedge = useMemo(wedgeGeometry, []);
  const markerMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#f59e0b', transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide,
  }), []);
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f59e0b', depthTest: false }), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ gl, scene, camera, size }) => {
    camera.getWorldDirection(dir);
    const c = cameraApi.controls;
    if (c) c.getTarget(target); else target.copy(camera.position);
    const m = minimapMarker(camera.position, target, Math.atan2(dir.x, dir.z));
    wedgeRef.current?.position.set(m.wedge.x, 40, m.wedge.z);
    wedgeRef.current?.rotation.set(0, m.wedge.yaw, 0);
    dotRef.current?.position.set(m.dot.x, 40, m.dot.z);
    gl.autoClear = true;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.render(scene, camera);

    const fog = scene.fog;
    const shadows = gl.shadowMap.autoUpdate;
    scene.fog = null;
    gl.shadowMap.autoUpdate = false;
    gl.setScissorTest(true);
    gl.setScissor(MINIMAP_MARGIN_PX, MINIMAP_MARGIN_PX, MINIMAP_SIZE_PX, MINIMAP_SIZE_PX);
    gl.setViewport(MINIMAP_MARGIN_PX, MINIMAP_MARGIN_PX, MINIMAP_SIZE_PX, MINIMAP_SIZE_PX);
    gl.render(scene, miniCam);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.shadowMap.autoUpdate = shadows;
    scene.fog = fog;
  }, 1);

  const setWedge = (o: THREE.Mesh | null) => { wedgeRef.current = o; onMarkerLayer(o); };
  const setDot = (o: THREE.Mesh | null) => { dotRef.current = o; onMarkerLayer(o); };
  return (
    <group>
      <mesh ref={setWedge} geometry={wedge} material={markerMat} renderOrder={999} />
      <mesh ref={setDot} material={dotMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1000}>
        <circleGeometry args={[5, 20]} />
      </mesh>
    </group>
  );
}

const floorLabel = (f: number | null) => (f === null ? 'Tutti' : f === 0 ? 'T' : String(f));

export function MinimapOverlay() {
  const building = useUiStore((s) => s.building);
  const floor = useUiStore((s) => s.floor);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = minimapToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, MINIMAP_EXTENT_M);
    const c = cameraApi.controls;
    if (c) c.moveTo(p.x, c.getTarget(new THREE.Vector3()).y, p.z, true);
  };
  return (
    <div className="minimap" style={{ width: MINIMAP_SIZE_PX, height: MINIMAP_SIZE_PX, left: MINIMAP_MARGIN_PX, bottom: MINIMAP_MARGIN_PX }}
      onClick={onClick} title="Clic per spostare la vista">
      <span className="minimap__north">▲ N</span>
      <span className="minimap__label">{building ?? 'Tutti'} · piano {floorLabel(floor)}</span>
    </div>
  );
}
