// The 3D canvas: renderer settings, adaptive resolution, camera rig, scene, minimap pass.
import { Canvas } from '@react-three/fiber';
import { lazy, Suspense, useState } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { useWalkStore } from '../store/walk';
import { CameraRig } from './CameraRig';
import { Complex } from './Complex';
import { useUiStore } from '../store/ui';
import { FrameScheduler } from './FrameScheduler';
import { Hazards } from './Hazards';
import { HeatPainter } from './HeatPainter';
import { Labels } from './Labels';
import { Lighting } from './Lighting';
import { MinimapPass } from './Minimap';
import { ModelBoundary } from './ModelBoundary';
const Furniture = lazy(() => import('./Furniture').then((m) => ({ default: m.Furniture })));
const People = lazy(() => import('./People').then((m) => ({ default: m.People })));
import { Weather } from './Weather';

export function Viewport({ layout }: { layout: ComplexLayout }) {
  const walking = useWalkStore((s) => s.active);
  // Rain only reaches the walker outdoors or on a balcony (V21).
  const sheltered = useWalkStore((s) => s.active && (s.place.kind === 'apartment' || s.place.kind === 'stairwell'));
  const low = useUiStore((s) => s.lowPerformance);
  const floor = useUiStore((s) => s.floor);
  const needsInteriors = walking || floor !== null;
  const [dpr, setDpr] = useState(Math.min(1.5, window.devicePixelRatio || 1));
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      frameloop="never"
      dpr={low ? Math.min(1, dpr) : dpr}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
    >
      <FrameScheduler onOverload={() => setDpr((d) => Math.max(.75, d - .25))} />
      <CameraRig layout={layout} />
      <Lighting />
      <Complex layout={layout} />
      <HeatPainter layout={layout} />
      {/* External models load in the background, each layer on its own: the rest of the scene
          neither waits for them nor fails with them. */}
      {needsInteriors && <ModelBoundary name="arredi"><Suspense fallback={null}><Furniture layout={layout} /></Suspense></ModelBoundary>}
      {needsInteriors && <ModelBoundary name="residenti"><Suspense fallback={null}><People layout={layout} /></Suspense></ModelBoundary>}
      <Hazards layout={layout} />
      {!sheltered && <Weather />}
      {!walking && <Labels layout={layout} />}
      {!walking && <MinimapPass />}
    </Canvas>
  );
}
