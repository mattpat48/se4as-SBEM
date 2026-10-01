// Camera controls, flights to a building, and the animated 3D ↔ 2D (orthographic) switch.
import { CameraControls, CameraControlsImpl, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CAMERA_LIMITS, focusOnBuilding } from '../domain/camera';
import { shakeAmplitude } from '../domain/effects';
import type { ComplexLayout } from '../domain/layout';
import { useUiStore } from '../store/ui';
import { readingNow } from './readings';

const FOV = 45;
const INITIAL = { position: [-48, 42, -98], target: [0, 6, -40] } as const;
const TRANSITION_SMOOTH_TIME = 0.2;   // ≈ 0.8 s to settle
const { ACTION } = CameraControlsImpl;

/** The live controls, for DOM overlays (minimap clicks) outside the canvas. */
export const cameraApi: { controls: CameraControlsImpl | null } = { controls: null };

const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

interface Pose { position: THREE.Vector3; target: THREE.Vector3; zoom?: number; azimuth?: number }

function configure(c: CameraControlsImpl, ortho: boolean, viewHeightPx: number) {
  c.smoothTime = TRANSITION_SMOOTH_TIME;
  c.minDistance = CAMERA_LIMITS.minDistance;
  c.maxDistance = CAMERA_LIMITS.maxDistance;
  c.setBoundary(new THREE.Box3(new THREE.Vector3(-110, 0, -110), new THREE.Vector3(110, 60, 110)));
  if (ortho) {
    c.minPolarAngle = 0; c.maxPolarAngle = 0;
    c.azimuthRotateSpeed = 0; c.polarRotateSpeed = 0;
    c.mouseButtons.left = ACTION.TRUCK; c.mouseButtons.right = ACTION.TRUCK; c.mouseButtons.wheel = ACTION.ZOOM;
    c.touches.one = ACTION.TOUCH_TRUCK; c.touches.two = ACTION.TOUCH_ZOOM_TRUCK;
    c.minZoom = viewHeightPx / (2 * CAMERA_LIMITS.maxDistance * tanHalfFov);
    c.maxZoom = viewHeightPx / (2 * CAMERA_LIMITS.minDistance * tanHalfFov);
  } else {
    c.minPolarAngle = 0; c.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle;
    c.azimuthRotateSpeed = 1; c.polarRotateSpeed = 1;
    c.mouseButtons.left = ACTION.ROTATE; c.mouseButtons.right = ACTION.TRUCK; c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE; c.touches.two = ACTION.TOUCH_DOLLY_TRUCK;
  }
}

export function CameraRig({ layout }: { layout: ComplexLayout }) {
  const mode = useUiStore((s) => s.mode);
  const building = useUiStore((s) => s.building);
  const size = useThree((s) => s.size);
  const [active, setActive] = useState<'persp' | 'ortho'>('persp');
  const [controls, setControls] = useState<CameraControlsImpl | null>(null);
  const orthoRef = useRef<THREE.OrthographicCamera>(null);
  const pending = useRef<Pose | null>(null);
  const initialized = useRef(false);
  const busy = useRef(false);
  const savedAzimuth = useRef(0);   // the 3D azimuth, restored after a 2D round trip

  // A new controls instance appears whenever the default camera changes: configure it and restore the pose.
  useEffect(() => {
    if (!controls) return;
    // Right after a switch, `active` changes one render before the new controls exist: wait for them.
    const isOrtho = (controls.camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    if (isOrtho !== (active === 'ortho')) return;
    cameraApi.controls = controls;
    configure(controls, active === 'ortho', size.height);
    const pose = pending.current;
    pending.current = null;
    if (pose) {
      controls.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, false);
      if (pose.zoom !== undefined) controls.zoomTo(pose.zoom, false);
      if (pose.azimuth !== undefined) controls.rotateTo(pose.azimuth, Math.PI / 4, true);
    } else if (!initialized.current) {
      controls.setLookAt(...INITIAL.position, ...INITIAL.target, false);
    }
    initialized.current = true;
    return () => { if (cameraApi.controls === controls) cameraApi.controls = null; };
  }, [controls, active, size.height]);

  // 3D → 2D: rotate to a top-down view (north up), then swap to an orthographic camera of equal visible height.
  useEffect(() => {
    const c = controls;
    if (!c || busy.current) return;
    if (mode === '2d' && active === 'persp') {
      busy.current = true;
      const target = c.getTarget(new THREE.Vector3());
      savedAzimuth.current = c.azimuthAngle;
      c.rotateTo(0, 0, true).then(() => {
        const distance = c.distance;
        const ortho = orthoRef.current!;
        const zoom = size.height / (2 * distance * tanHalfFov);
        ortho.position.set(target.x, target.y + distance, target.z + 0.01);   // just south: north stays up
        pending.current = { position: ortho.position.clone(), target, zoom };
        if (useUiStore.getState().floor === null) useUiStore.getState().setFloor(0);
        busy.current = false;
        setActive('ortho');
      });
    } else if (mode === '3d' && active === 'ortho') {
      const target = c.getTarget(new THREE.Vector3());
      const ortho = orthoRef.current!;
      const distance = size.height / (2 * ortho.zoom * tanHalfFov);
      pending.current = { position: new THREE.Vector3(target.x, target.y + distance, target.z + 0.01), target, azimuth: savedAzimuth.current };
      setActive('persp');
    }
  }, [mode, active, controls, size.height]);

  // Building filter or double-click: fly there (3D) or pan there (2D).
  useEffect(() => {
    const c = controls;
    const b = layout.buildings.find((x) => x.id === building);
    if (!c || !b) return;
    if (active === 'persp') {
      const f = focusOnBuilding(b);
      c.setLookAt(f.position.x, f.position.y, f.position.z, f.target.x, f.target.y, f.target.z, true);
    } else {
      c.moveTo(b.center.x, 0, b.center.z, true);
    }
  }, [building, controls, layout, active]);

  // Earthquake (§7.8): a random offset of the camera position (not the target) while seismic > 3.
  // The previous offset is removed before the controls update (-2 < -1) and a new one added after.
  const shake = useRef(new THREE.Vector3());
  useFrame(({ camera }) => { camera.position.sub(shake.current); shake.current.set(0, 0, 0); }, -2);
  useFrame(({ camera }) => {
    const a = shakeAmplitude(readingNow('park.seismic'));
    if (a <= 0) return;
    shake.current.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    camera.position.add(shake.current);
  });

  return (
    <>
      <PerspectiveCamera makeDefault={active === 'persp'} fov={FOV} near={0.5} far={1500} position={[...INITIAL.position]} />
      <OrthographicCamera ref={orthoRef} makeDefault={active === 'ortho'} near={0.5} far={2000} />
      <CameraControls ref={setControls} makeDefault />
    </>
  );
}
