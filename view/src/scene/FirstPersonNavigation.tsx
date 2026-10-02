// First-person input and camera (V21): keys and drag move the walker of the store through the walk
// world of the domain; E or a click toggles doors; the current place follows the walker.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { CameraControlsImpl } from '@react-three/drei';
import { blindsCover } from '../domain/actuatorVisual';
import { pickDoor } from '../domain/doors';
import type { ComplexLayout } from '../domain/layout';
import { RUN_SPEED, WALK_EYE_M, WALK_SPEED, moveWalker, settle, standAt, walkDelta } from '../domain/walk';
import { buildWalkWorld, toPlan, type WalkEnv, type WalkWorld } from '../domain/walkWorld';
import { locate, samePlace } from '../domain/whereabouts';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { clearWalkInput, walkInput } from '../store/walkInput';
import { doorOpenness, isDoorOpen, useWalkStore, walker } from '../store/walk';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const PLACE_CHECK_S = 0.25;
/** Eye height follows the feet with this rate (1/s): steps and stairs do not jolt the camera. */
const EYE_FOLLOW = 12;

const env: WalkEnv = {
  doorOpenness: (d) => doorOpenness.get(d.id) ?? (isDoorOpen(useWalkStore.getState().doors, d.id, d.defaultOpen) ? 1 : 0),
  blindsCover: (aptId) => blindsCover(useLiveStore.getState().states.get(`${aptId}.blinds`)?.state ?? {}),
};

/** The door in reach and in front of the walker, in the open building or at any park portone. */
function doorInFront(layout: ComplexLayout, world: WalkWorld, openBuilding: string | null): string | null {
  for (const bw of world.buildings) {
    const doors = bw.open ? bw.doors : bw.doors.filter((d) => d.kind === 'portone');
    if (doors.length === 0) continue;
    const p = toPlan(bw.b, walker.x, walker.z);
    const here = bw.open ? locate(layout, openBuilding, walker) : null;
    const floor = here && here.kind !== 'outdoor' ? here.floor : 0;
    const d = pickDoor(doors, { ...p, floor }, walker.yaw - bw.b.rotationY);
    if (d) return d.id;
  }
  return null;
}

export function FirstPersonNavigation({ layout, controls }: { layout: ComplexLayout; controls: CameraControlsImpl }) {
  const { gl } = useThree();
  const keys = useRef(new Set<string>());
  const openBuilding = useWalkStore((s) => s.openBuilding);
  const seq = useWalkStore((s) => s.seq);
  const world = useMemo(() => buildWalkWorld(layout, openBuilding), [layout, openBuilding]);
  const worldRef = useRef(world);
  worldRef.current = world;
  const eyeY = useRef(walker.feet + WALK_EYE_M);
  const sinceCheck = useRef(0);

  // A start or a jump: take the new pose, nudged to a free spot if needed.
  useEffect(() => {
    const w = worldRef.current;
    if (standAt(w, walker.x, walker.z, walker.feet, env) === null) {
      const free = settle(w, walker, env);
      if (free) Object.assign(walker, free);
      else console.warn('Prima persona: nessun punto libero vicino alla partenza');
    }
    eyeY.current = walker.feet + WALK_EYE_M;
  }, [seq]);

  useEffect(() => {
    controls.stop();
    controls.minDistance = 0.01; controls.minPolarAngle = 0.03; controls.maxPolarAngle = Math.PI - 0.03;
    const canvas = gl.domElement;
    let dragging = false, lastX = 0, lastY = 0;
    const typing = () => { const e = document.activeElement; return e instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) || e.isContentEditable); };
    const ignored = (e: KeyboardEvent) => typing() || useUiStore.getState().debugOpen || e.metaKey || e.ctrlKey || e.altKey;
    const down = (e: KeyboardEvent) => {
      if (ignored(e)) return;
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (e.repeat) return;
        const id = doorInFront(layout, worldRef.current, useWalkStore.getState().openBuilding);
        if (id) useWalkStore.getState().toggleDoor(layout, id);
        return;
      }
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault(); keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code); };
    const reset = () => { keys.current.clear(); dragging = false; clearWalkInput(); };
    const pointerDown = (e: PointerEvent) => { if (e.button !== 0) return; dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.focus(); };
    const pointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      walker.yaw -= (e.clientX - lastX) * 0.004;
      walker.pitch = Math.max(-1.15, Math.min(1.15, walker.pitch - (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    };
    const pointerUp = () => { dragging = false; };
    canvas.tabIndex = 0; canvas.focus({ preventScroll: true });
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', reset);
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
    return () => {
      reset();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', reset);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
    };
  }, [layout, controls, gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05), held = keys.current;
    if (useUiStore.getState().debugOpen) { held.clear(); clearWalkInput(); }
    const forward = Number(held.has('KeyW') || held.has('ArrowUp')) - Number(held.has('KeyS') || held.has('ArrowDown')) + walkInput.forward;
    const right = Number(held.has('KeyD') || held.has('ArrowRight')) - Number(held.has('KeyA') || held.has('ArrowLeft')) + walkInput.right;
    walker.yaw -= walkInput.turn * dt * 1.3;
    const run = held.has('ShiftLeft') || held.has('ShiftRight');
    if (forward !== 0 || right !== 0) {
      const { dx, dz } = walkDelta(forward, right, walker.yaw, run ? RUN_SPEED : WALK_SPEED, dt);
      Object.assign(walker, moveWalker(world, walker, dx, dz, env));
    }
    eyeY.current += (walker.feet + WALK_EYE_M - eyeY.current) * Math.min(1, EYE_FOLLOW * dt);
    const flat = Math.cos(walker.pitch);
    controls.setLookAt(walker.x, eyeY.current, walker.z,
      walker.x + Math.sin(walker.yaw) * flat, eyeY.current + Math.sin(walker.pitch), walker.z + Math.cos(walker.yaw) * flat, false);

    sinceCheck.current += dt;
    if (sinceCheck.current >= PLACE_CHECK_S) {
      sinceCheck.current = 0;
      const store = useWalkStore.getState();
      const place = locate(layout, store.openBuilding, walker);
      if (!samePlace(place, store.place)) store.setPlace(place);
    }
  });
  return null;
}
