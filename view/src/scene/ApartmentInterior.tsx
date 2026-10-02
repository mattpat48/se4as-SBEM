import { Html } from '@react-three/drei';
import { wallHeight } from '../domain/interior';
import { apartmentDevicePose } from '../domain/deviceAppearance';
import type { ApartmentGeom, BuildingGeom, ComplexLayout } from '../domain/layout';
import { PLINTH_M } from '../domain/plan';
import { useUiStore } from '../store/ui';
import { ApartmentSensors } from './ApartmentSensors';
import { onPick } from './Complex';
import { InteriorActuators, WindowActuators } from './Devices';
import { UnitMesh } from './Floor';
import { InteriorWalls } from './InteriorWalls';
import { planBox, planLocal } from './geom';
import { mat, UNIT_BOX } from './materials';
import { Park } from './Park';

const NAMES:Record<string,string>={temperature:'Temperatura',humidity:'Umidità',co2:'Qualità dell’aria',occupancy:'Presenza',light:'Luminosità',smoke:'Rilevatore di fumo',gas:'Rilevatore di gas',co:'Monossido di carbonio',noise_level:'Rumore',power:'Contatore elettrico',water_flow:'Contatore acqua',gas_flow:'Contatore gas',hvac:'Climatizzatore',ventilation:'Ventilazione',gas_valve:'Valvola gas',alarm:'Allarme',resident_display:'Display residenti'};
function InteriorNames({b,apt,layout}:{b:BuildingGeom;apt:ApartmentGeom;layout:ComplexLayout}) {
  const show=useUiStore(s=>s.showDeviceNames);
  if(!show)return null;
  return <>{[...layout.devices.values()].filter(d=>d.unitId===apt.id).map(d=>{
    const p=apartmentDevicePose(d.type,true);if(!p)return null;
    const [x,z]=planLocal(b,p.u+Math.sin(p.rotationY)*.18,p.v+Math.cos(p.rotationY)*.18,apt.mirrored);
    return <Html key={d.deviceId} position={[x,PLINTH_M+apt.floor*b.floorHeight+p.h+.18,z]} center distanceFactor={4} occlude style={{pointerEvents:'none'}}><span className="interior-device-name">{NAMES[d.type]??d.type}</span></Html>;
  })}</>;
}
function Shell({b,apt}:{b:BuildingGeom;apt:ApartmentGeom}) {
  const ceiling=wallHeight(b.floorHeight);
  return <InteriorWalls b={b} apt={apt} ceiling={ceiling}>
    <mesh geometry={UNIT_BOX} material={mat('furniture')} position={[5.25,ceiling+.07,6]} scale={[10.5,.14,12]} castShadow receiveShadow />
    <mesh geometry={UNIT_BOX} material={mat('wood')} position={[10.385,1.16,5.1]} scale={[.035,2.08,.94]} />
    <mesh geometry={UNIT_BOX} material={mat('metal')} position={[10.35,1.08,4.77]} scale={[.04,.035,.14]} />
  </InteriorWalls>;
}
export function ApartmentInterior({layout,apt}:{layout:ComplexLayout;apt:ApartmentGeom}) {
  const b=layout.buildings.find(b=>b.id===apt.building)!;
  const y0=PLINTH_M+apt.floor*b.floorHeight;
  return <group onClick={onPick}>
    <mesh geometry={UNIT_BOX} material={mat('ground')} position={[0,-.5,0]} scale={[200,1,200]} receiveShadow />
    <Park layout={layout}/>
    <ambientLight intensity={.35} />
    <group position={[b.center.x,0,b.center.z]} rotation={[0,b.rotationY,0]}>
      <UnitMesh unitId={apt.id} part="floor" color="#d9d2c5" faded={false} box={planBox(b,{u0:0,u1:10.5,v0:0,v1:12},y0,.12,apt.mirrored)}/>
      <Shell b={b} apt={apt}/>
      <WindowActuators b={b} apt={apt} immersive/>
      <InteriorActuators b={b} apt={apt} immersive/>
      <InteriorNames b={b} apt={apt} layout={layout}/>
    </group>
    <ApartmentSensors layout={layout}/>
  </group>;
}
