// The park: lawn, paths, fountain, trees, lamp posts, weather station, sprinklers.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ComplexLayout, Vec3 } from '../domain/layout';
import { windSway } from '../domain/effects';
import { gardenCore } from '../domain/garden';
import { GardenLandscape } from './GardenLandscape';
import { treeSpecs, type TreeSpec } from '../domain/trees';
import { readingNow } from './readings';
import { UNIT_BOX, fixedMat, mat } from './materials';

const TRUNK = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 8).translate(0, 1.1, 0);
const CROWN = new THREE.IcosahedronGeometry(1.9, 1).translate(0, 3.2, 0);

export function Trees({ trees }: { trees: TreeSpec[] }) {
  const trunk = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.z);
      trunk.current!.setMatrixAt(i, m);
      crown.current!.setMatrixAt(i, m);
    });
    trunk.current!.instanceMatrix.needsUpdate = true;
    crown.current!.instanceMatrix.needsUpdate = true;
    trunk.current!.computeBoundingSphere();
    crown.current!.computeBoundingSphere();
  }, [trees]);

  // Wind (§7.7): sway proportional to wind_speed, full at 80 km/h.
  const swayed = useRef(false);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  useFrame(({ clock }) => {
    const amp = windSway(readingNow('park.wind_speed')) * 0.18;
    if (amp === 0 && !swayed.current) return;
    swayed.current = amp > 0;
    const t = clock.elapsedTime;
    trees.forEach((tr, i) => {
      tmp.e.set(amp * Math.sin(t * 2.1 + i), 0, amp * Math.cos(t * 1.7 + i * 1.3));
      tmp.m.compose(tmp.p.set(tr.x, 0, tr.z), tmp.q.setFromEuler(tmp.e), tmp.s.set(tr.s, tr.s, tr.s));
      trunk.current!.setMatrixAt(i, tmp.m);
      crown.current!.setMatrixAt(i, tmp.m);
    });
    trunk.current!.instanceMatrix.needsUpdate = true;
    crown.current!.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={trunk} args={[TRUNK, mat('trunk'), trees.length]} castShadow />
      <instancedMesh ref={crown} args={[CROWN, mat('leaf'), trees.length]} castShadow receiveShadow />
    </>
  );
}

const poleMat = () => fixedMat('pole', () => new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.6 }));
const lampMat = () => fixedMat('lampOff', () => new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#fde68a', emissiveIntensity: 0 }));
const stoneMat = () => fixedMat('stone', () => new THREE.MeshStandardMaterial({ color: '#e7e1d6', roughness: 0.8 }));
const metalMat = () => fixedMat('metal', () => new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.4, metalness: 0.6 }));

export function LampPost({ p }: { p: Vec3 }) {
  return (
    <group position={[p.x, 0, p.z]}>
      <mesh material={poleMat()} position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 4, 6]} />
      </mesh>
      <mesh material={lampMat()} position={[0, 4.1, 0]}>
        <sphereGeometry args={[0.35, 12, 8]} />
      </mesh>
    </group>
  );
}

/** Cups on top of the weather mast, spinning at wind_speed / 10 turns per second. */
function Anemometer() {
  const rotor = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (rotor.current) rotor.current.rotation.y += 2 * Math.PI * (readingNow('park.wind_speed') / 10) * dt;
  });
  return (
    <group ref={rotor} position={[0, 4.1, 0]} userData={{ deviceId: 'park.wind_speed' }}>
      {[0, 1, 2].map((k) => (
        <group key={k} rotation={[0, (k * 2 * Math.PI) / 3, 0]}>
          <mesh material={metalMat()} position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, 0.5, 4]} /></mesh>
          <mesh material={metalMat()} position={[0.5, 0, 0]}><sphereGeometry args={[0.08, 8, 6]} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Park({ layout }: { layout: ComplexLayout }) {
  const { center, width, depth } = gardenCore(layout);
  const trees = useMemo(() => treeSpecs(layout), [layout]);
  const st = layout.parkFixtures.station;
  const ringR = Math.min(width, depth) / 5;
  return (
    <group userData={{ unitId: 'park' }}>
      <GardenLandscape layout={layout} />
      <mesh geometry={UNIT_BOX} material={mat('grass')} position={[center.x, 0.1, center.z]} scale={[width, 0.2, depth]} receiveShadow
        userData={{ unitId: 'park' }} />
      <mesh geometry={UNIT_BOX} material={mat('path')} position={[center.x, 0.11, center.z]} scale={[width, 0.22, 3]} receiveShadow />
      <mesh geometry={UNIT_BOX} material={mat('path')} position={[center.x, 0.11, center.z]} scale={[3, 0.22, depth]} receiveShadow />
      <mesh material={mat('path')} position={[center.x, 0.2, center.z]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.12]} receiveShadow>
        <torusGeometry args={[ringR, 1.2, 6, 48]} />
      </mesh>
      <Fountain x={center.x} z={center.z} />
      <Trees trees={trees} />
      {layout.parkFixtures.lamps.map((p, i) => <LampPost key={i} p={p} />)}
      <group position={[st.x, 0, st.z]} userData={{ unitId: 'park' }}>
        <mesh material={metalMat()} position={[0, 2, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 4, 8]} />
        </mesh>
        <Anemometer />
      </group>
      {layout.parkFixtures.irrigation.map((p, i) => (
        <mesh key={i} material={metalMat()} position={[p.x, 0.3, p.z]}>
          <cylinderGeometry args={[0.1, 0.12, 0.2, 8]} />
        </mesh>
      ))}
    </group>
  );
}


function Fountain({x,z}:{x:number;z:number}) {
  const jets=useRef<THREE.InstancedMesh>(null);
  const water=useMemo(()=>new THREE.MeshStandardMaterial({color:'#75b9bd',roughness:.2,metalness:.15,transparent:true,opacity:.78}),[]);
  const drops=useMemo(()=>new THREE.SphereGeometry(.07,6,4),[]);
  useLayoutEffect(()=>()=>{water.dispose();drops.dispose();},[water,drops]);
  const matrix=useMemo(()=>new THREE.Matrix4(),[]);
  useFrame(({clock})=>{
    const t=clock.elapsedTime;
    for(let i=0;i<96;i++) {const a=(i%8)*Math.PI/4,k=((Math.floor(i/8)/12+t*.35)%1),r=.35+k*2.15;matrix.makeScale(1,1.6,1).setPosition(x+Math.cos(a)*r,.9+Math.sin(k*Math.PI)*2.1,z+Math.sin(a)*r);jets.current!.setMatrixAt(i,matrix);}
    jets.current!.instanceMatrix.needsUpdate=true;
  });
  return <group>
    <mesh position={[x,.12,z]} material={stoneMat()} receiveShadow><cylinderGeometry args={[4.4,4.6,.24,64]}/></mesh>
    <mesh position={[x,.39,z]} material={stoneMat()} castShadow receiveShadow><cylinderGeometry args={[3.2,3.4,.62,64]}/></mesh>
    <mesh position={[x,.73,z]} rotation={[-Math.PI/2,0,0]} material={stoneMat()}><torusGeometry args={[3.02,.22,10,64]}/></mesh>
    <mesh position={[x,.73,z]} material={water}><cylinderGeometry args={[2.82,2.82,.06,64]}/></mesh>
    <mesh position={[x,1.18,z]} material={stoneMat()} castShadow><cylinderGeometry args={[.3,.48,1.05,24]}/></mesh>
    <mesh position={[x,1.72,z]} material={stoneMat()} castShadow><cylinderGeometry args={[1.03,.45,.3,32]}/></mesh>
    <mesh position={[x,1.91,z]} material={water}><cylinderGeometry args={[.94,.94,.05,32]}/></mesh>
    <mesh position={[x,2.1,z]} material={stoneMat()} castShadow><cylinderGeometry args={[.13,.24,.6,16]}/></mesh>
    <instancedMesh ref={jets} args={[drops,water,96]} frustumCulled={false}/>
  </group>;
}
