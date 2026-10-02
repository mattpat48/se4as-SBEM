import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gardenPlan, type GardenPoint, type GardenSeat } from '../domain/garden';
import type { ComplexLayout } from '../domain/layout';
import { atmosphere } from './atmosphere';
import { UNIT_BOX, fixedMat, mat } from './materials';
import { ModelBoundary } from './ModelBoundary';
import { useUiStore } from '../store/ui';
import { MergedBoxes, type BoxTransform } from './MergedBoxes';

const stone = () => fixedMat('gardenLimestone',()=>new THREE.MeshStandardMaterial({color:'#d4c7ad',roughness:.95}));
const timber = () => fixedMat('gardenTimber',()=>new THREE.MeshStandardMaterial({color:'#927555',roughness:.86}));
const metal = () => fixedMat('gardenIron',()=>new THREE.MeshStandardMaterial({color:'#38433e',roughness:.7,metalness:.25}));
const shrub = () => fixedMat('gardenShrub',()=>new THREE.MeshStandardMaterial({color:'#60744b',roughness:1}));
const FLOWER = new THREE.IcosahedronGeometry(.13,1);
const BUSH = new THREE.IcosahedronGeometry(1,2);
const LOW_BUSH = new THREE.IcosahedronGeometry(1,1);

function Turf({layout}:{layout:ComplexLayout}) {
  const geometry=useMemo(()=>{
    const shape=new THREE.Shape();shape.moveTo(-78,-67);shape.lineTo(78,-67);shape.lineTo(78,86);shape.lineTo(-78,86);shape.closePath();
    // Cut foundations and the EV parking out of the landscaped ground.
    for(const b of layout.buildings) {
      const path=new THREE.Path(),c=Math.cos(b.rotationY),s=Math.sin(b.rotationY);
      const corners=[[-b.width/2-2,-b.depth/2-3],[b.width/2+2,-b.depth/2-3],[b.width/2+2,b.depth/2+3],[-b.width/2-2,b.depth/2+3]];
      corners.forEach(([x,z],i)=>{const wx=b.center.x+x*c+z*s,wz=b.center.z-x*s+z*c;i===0?path.moveTo(wx,wz):path.lineTo(wx,wz);});path.closePath();shape.holes.push(path);
    }
    const p=layout.parking,path=new THREE.Path();const x=p.center.x,z=p.center.z,w=p.width/2+1,d=p.depth/2+1;
    path.moveTo(x-w,z-d);path.lineTo(x+w,z-d);path.lineTo(x+w,z+d);path.lineTo(x-w,z+d);path.closePath();shape.holes.push(path);
    const g=new THREE.ShapeGeometry(shape);g.rotateX(Math.PI/2);const index=g.index!;for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+1));index.setX(i+1,a);}g.computeVertexNormals();return g;
  },[layout]);
  useLayoutEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} position={[0,.025,0]} material={mat('grass')} receiveShadow />;
}

function Walkways({layout}:{layout:ComplexLayout}) {
  const geometry=useMemo(()=>{
    const plan=gardenPlan(layout),parts:THREE.BufferGeometry[]=[];
    const elevation=(x:number,z:number)=>Math.abs(x-plan.core.center.x)<plan.core.width/2 && Math.abs(z-plan.core.center.z)<plan.core.depth/2 ? .22 : .035;
    const box=(x:number,y:number,z:number,w:number,h:number,d:number,a:number)=>{
      const g=new THREE.BoxGeometry(w,h,d);g.rotateY(a);g.translate(x,y,z);parts.push(g);
    };
    for(const path of plan.paths) for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i],length=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(length/1.5)),angle=-Math.atan2(b.z-a.z,b.x-a.x);
      for(let j=0;j<n;j++) {
        const t=(j+.5)/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,y=elevation(x,z);
        box(x,y-.12,z,length/n+.035,.24,path.width,angle);
        for(const side of [-1,1])box(x+Math.sin(angle)*side*(path.width/2+.08),y-.1,z+Math.cos(angle)*side*(path.width/2+.08),length/n,.22,.14,angle);
      }
    }
    for(const path of plan.paths)for(const p of path.points) {
      const g=new THREE.CylinderGeometry(path.width/2,path.width/2,.24,20);g.translate(p.x,elevation(p.x,p.z)-.12,p.z);parts.push(g);
    }
    const merged=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());return merged;
  },[layout]);
  useLayoutEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} material={stone()} receiveShadow/>;
}

function LibraryModel({name,positions,width,layout}:{name:'bench'|'trashcan';positions:GardenSeat[];width:number;layout:ComplexLayout}) {
  const {scene}=useGLTF(`/models/garden/${name}.glb`);
  const models=useMemo(()=>{
    scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    const fit=new THREE.Matrix4().makeScale(width/size.x,(name==='bench'?.9:.85)/size.y,(name==='bench'?.75:.5)/size.z)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
    const core=gardenPlan(layout).core,models:THREE.InstancedMesh[]=[];
    scene.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      const mesh=new THREE.InstancedMesh(o.geometry,o.material,positions.length);
      positions.forEach((p,i)=>{
        const y=Math.abs(p.x-core.center.x)<core.width/2&&Math.abs(p.z-core.center.z)<core.depth/2?.2:.025;
        const matrix=new THREE.Matrix4().makeTranslation(p.x,y,p.z).multiply(new THREE.Matrix4().makeRotationY(p.angle)).multiply(fit).multiply(o.matrixWorld);
        mesh.setMatrixAt(i,matrix);
      });
      mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;models.push(mesh);
    });
    return models;
  },[scene,positions,width,name,layout]);
  useLayoutEffect(()=>()=>models.forEach(m=>m.dispose()),[models]);
  return <group dispose={null}>{models.map(m=><primitive key={m.uuid} object={m}/>)}</group>;
}

function Pergola({p}:{p:GardenPoint}) {
  const boxes=useMemo(()=>{
    const out:BoxTransform[]=[];
    for(const x of [-1,1])for(const z of [-1,1])out.push({position:[x*3,1.5,z*2.3],scale:[.18,3,.18]});
    for(const z of [-1,1])out.push({position:[0,3,z*2.3],scale:[7,.22,.2]});
    for(let i=0;i<14;i++)out.push({position:[-3.3+i*.5,3.18,0],scale:[.15,.2,5.6]});
    out.push({position:[0,.8,0],scale:[2,.15,1]});
    for(const z of [-1,1])out.push({position:[0,.48,z*1.1],scale:[2.8,.13,.45]});
    return out;
  },[]);
  return <group position={[p.x,0,p.z]}>
    <mesh geometry={UNIT_BOX} position={[0,.09,0]} scale={[8,.18,6.5]} material={stone()} receiveShadow/>
    <MergedBoxes boxes={boxes} material={timber()} castShadow/>
  </group>;
}

function Planting({layout}:{layout:ComplexLayout}) {
  const low = useUiStore((s) => s.lowPerformance);
  const bushes=useRef<THREE.InstancedMesh>(null),flowers=useRef<THREE.InstancedMesh>(null);
  const data=useMemo(()=>{
    const hedge:THREE.Matrix4[]=[],bloom:THREE.Matrix4[]=[];
    // Four planted corners frame the fountain square, leaving the cross paths open.
    for(const sx of [-1,1])for(const sz of [-1,1]) {
      for(let i=0;i<22;i++) {
        const x=sx*(16+i%11*1.6),z=sz*(12+Math.floor(i/11)*9);
        hedge.push(new THREE.Matrix4().makeScale(.8,.6,.7).setPosition(x,.7,z));
        for(let j=0;j<5;j++)bloom.push(new THREE.Matrix4().makeTranslation(x+(j%3)*.3-.3,.48,z+(Math.floor(j/3)*.4)-.2));
      }
    }
    // Soft borders along the outer promenade, away from door approaches and chargers.
    for(const side of [-1,1])for(let i=0;i<46;i++)hedge.push(new THREE.Matrix4().makeScale(.8,.6,.8).setPosition(side*72,.6,-51+i*2.2));
    return {hedge,bloom};
  },[layout]);
  useLayoutEffect(()=>{data.hedge.forEach((m,i)=>bushes.current!.setMatrixAt(i,m));data.bloom.forEach((m,i)=>{flowers.current!.setMatrixAt(i,m);flowers.current!.setColorAt(i,new THREE.Color(['#c39ab3','#e1d3b0','#a398ca'][i%3]));});for(const r of [bushes,flowers]){r.current!.instanceMatrix.needsUpdate=true;r.current!.computeBoundingSphere();}},[data]);
  return <>
    <instancedMesh ref={bushes} args={[low ? LOW_BUSH : BUSH,shrub(),data.hedge.length]} castShadow receiveShadow/>
    <instancedMesh ref={flowers} args={[FLOWER,mat('path'),data.bloom.length]}/>
  </>;
}

function PathLights() {
  const pool=useRef<THREE.PointLight>(null);
  const material=useMemo(()=>new THREE.MeshStandardMaterial({color:'#f0dfb9',emissive:'#ffd69a',emissiveIntensity:0}),[]);
  useFrame(()=>{material.emissiveIntensity=atmosphere.night*1.8;if(pool.current)pool.current.intensity=atmosphere.night*90;});
  useLayoutEffect(()=>()=>material.dispose(),[material]);
  return <><pointLight ref={pool} position={[0,3,0]} color="#c7e3e1" intensity={0} distance={25} decay={2}/>{[-1,1].flatMap(s=>[-46,-22,20,43].map(z=><group key={`${s}:${z}`} position={[s*65,0,z]}>
    <mesh geometry={UNIT_BOX} material={metal()} position={[0,.45,0]} scale={[.2,.9,.2]}/>
    <mesh geometry={UNIT_BOX} material={material} position={[0,.84,0]} scale={[.24,.16,.24]}/>
  </group>))}</>;
}

export function GardenLandscape({layout}:{layout:ComplexLayout}) {
  const plan=useMemo(()=>gardenPlan(layout),[layout]);
  return <group name="Giardino e percorsi del residence">
    <Turf layout={layout}/><Walkways layout={layout}/><Planting layout={layout}/><PathLights/>
    {plan.pergolas.map((p,i)=><Pergola key={i} p={p}/>)}
    <ModelBoundary name="arredi del parco"><Suspense fallback={null}>
      <LibraryModel name="bench" positions={plan.seats} width={2.8} layout={layout}/>
      <LibraryModel name="trashcan" positions={plan.bins} width={.5} layout={layout}/>
    </Suspense></ModelBoundary>
  </group>;
}
