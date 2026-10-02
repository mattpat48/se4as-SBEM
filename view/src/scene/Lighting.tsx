// Sun, sky, fog and the day → night style blend (view spec §7.6, V13). The sun follows the
// simulated clock over L'Aquila; below the horizon it becomes a dim bluish moonlight.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { simNowMs } from '../domain/clock';
import { isCloudy } from '../domain/effects';
import { DATA, DAY, NIGHT, lerpColor, mixPalette } from '../domain/palette';
import { LAQUILA, nightFactor, sunPosition } from '../domain/sun';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { useWalkStore, walker } from '../store/walk';
import { atmosphere } from './atmosphere';
import { TWIN_EDGES, applyPalette, fixedMat } from './materials';
import { readingNow } from './readings';

const SUN_DISTANCE = 150;
const MOON = new THREE.Vector3(0.45, 0.8, 0.4).normalize();

function currentSun() {
  const clock = useLiveStore.getState().clock;
  const complex = useModelStore.getState().model?.complex;
  const lat = complex?.lat ?? LAQUILA.lat, lon = complex?.lon ?? LAQUILA.lon;
  return clock ? sunPosition(simNowMs(clock, Date.now()), lat, lon) : { elevationDeg: 45, azimuthDeg: 180 };
}

/** The night factor, re-rendering only when it moves by more than 0.02. */
export function useNightFactor(): number {
  const [n, setN] = useState(atmosphere.night);
  useFrame(() => { if (Math.abs(atmosphere.night - n) > 0.02) setN(atmosphere.night); });
  return n;
}

export function Lighting() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene, gl } = useThree();
  const inside = useWalkStore((s) => s.active);
  const low = useUiStore((s) => s.lowPerformance);
  const elapsed = useRef(1);
  const focus = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), sky: new THREE.Color() }), []);

  useFrame((_, dt) => {
    elapsed.current += dt;
    if (elapsed.current < .1) return;
    elapsed.current = 0;
    const s = currentSun();
    const n = nightFactor(s.elevationDeg);
    const dataMode = useUiStore.getState().dataMode;
    const mixed = dataMode ? DATA : mixPalette(DAY, NIGHT, n);
    // Clouds (§7.7): the simulator only has clouds while it rains → dimmer sun, greyer sky.
    const cloudy = isCloudy(readingNow('park.rain_level'));
    const palette = cloudy ? { ...mixed, sunIntensity: mixed.sunIntensity * 0.4, sky: lerpColor(mixed.sky, '#8b95a5', 0.5 * (1 - n)) } : mixed;
    atmosphere.night = dataMode ? 0 : n;
    atmosphere.dataMode = dataMode;
    atmosphere.palette = palette;
    applyPalette(palette);

    const el = THREE.MathUtils.degToRad(Math.max(s.elevationDeg, 0));
    const az = THREE.MathUtils.degToRad(s.azimuthDeg);
    if (s.elevationDeg > -2) tmp.dir.set(Math.cos(el) * Math.sin(az), Math.max(Math.sin(el), 0.05), -Math.cos(el) * Math.cos(az)).normalize();
    else tmp.dir.copy(MOON);
    const light = sun.current;
    if (light) {
      // In first person the sun's shadow box follows the walker, in 2 m steps against shimmering.
      if (inside) light.target.position.set(Math.round(walker.x / 2) * 2, walker.feet, Math.round(walker.z / 2) * 2);
      else light.target.position.set(focus.x, focus.y, focus.z);
      light.target.updateMatrixWorld();
      light.position.copy(tmp.dir).multiplyScalar(SUN_DISTANCE).add(light.target.position);
      const extent = inside ? 30 : 110;
      const shadowCamera = light.shadow.camera;
      if (shadowCamera.right !== extent) {
        shadowCamera.left = -extent; shadowCamera.right = extent;
        shadowCamera.top = extent; shadowCamera.bottom = -extent;
        shadowCamera.updateProjectionMatrix();
      }
      light.shadow.normalBias = inside ? .025 : .4;
      light.color.set(palette.sunColor);
      light.intensity = palette.sunIntensity;
    }
    if (hemi.current) {
      hemi.current.color.set(palette.hemiSky);
      hemi.current.groundColor.set(palette.hemiGround);
      hemi.current.intensity = palette.hemiIntensity;
    }
    tmp.sky.set(palette.sky);
    if (scene.background instanceof THREE.Color) scene.background.copy(tmp.sky);
    else scene.background = tmp.sky.clone();
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(tmp.sky);
    gl.toneMappingExposure = palette.exposure;
    TWIN_EDGES.opacity = 0.55 * atmosphere.night;
    TWIN_EDGES.visible = atmosphere.night > 0.02;
    (fixedMat('ghostEdge', () => new THREE.LineBasicMaterial()) as THREE.LineBasicMaterial).color.set(n > 0.5 && !dataMode ? '#38bdf8' : '#94a3b8');
  });

  return (
    <>
      <color attach="background" args={[DAY.sky]} />
      <fog attach="fog" args={[DAY.sky, 420, 1600]} />
      <hemisphereLight ref={hemi} args={[DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity]} />
      <directionalLight
        ref={sun}
        color={DAY.sunColor}
        intensity={DAY.sunIntensity}
        position={[-70, 110, 60]}
        castShadow
        key={low ? 'sun-low' : 'sun-normal'}
        shadow-mapSize={low ? [1024, 1024] : [1536, 1536]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={10}
        shadow-camera-far={320}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
      />
    </>
  );
}
