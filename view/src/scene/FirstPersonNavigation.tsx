import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { CameraControlsImpl } from '@react-three/drei';
import { planToWorld, type ApartmentGeom, type BuildingGeom } from '../domain/layout';
import { moveWalker, WALK_EYE_M, WALK_START } from '../domain/walk';
import { useUiStore } from '../store/ui';
import { clearWalkInput, walkInput } from '../store/walkInput';

const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
export function FirstPersonNavigation({ b, apt, controls }: {b:BuildingGeom;apt:ApartmentGeom;controls:CameraControlsImpl}) {
  const {gl}=useThree();
  const keys=useRef(new Set<string>());
  const view=useRef({ ...WALK_START, yaw:-Math.PI/2, pitch:0 });
  useEffect(()=>{
    view.current={...WALK_START,yaw:-Math.PI/2,pitch:0};
    controls.stop();
    controls.minDistance=.01; controls.minPolarAngle=.03; controls.maxPolarAngle=Math.PI-.03;
    const canvas=gl.domElement;
    let dragging=false,lastX=0,lastY=0;
    const typing=()=>{const e=document.activeElement; return e instanceof HTMLElement && (['INPUT','TEXTAREA','SELECT'].includes(e.tagName)||e.isContentEditable);};
    const down=(e:KeyboardEvent)=>{
      if(!MOVE_KEYS.has(e.code)||typing()||useUiStore.getState().debugOpen||e.metaKey||e.ctrlKey||e.altKey) return;
      e.preventDefault(); keys.current.add(e.code);
    };
    const up=(e:KeyboardEvent)=>{keys.current.delete(e.code);};
    const reset=()=>{keys.current.clear(); dragging=false;clearWalkInput();};
    const pointerDown=(e:PointerEvent)=>{if(e.button!==0)return;dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);canvas.focus();};
    const pointerMove=(e:PointerEvent)=>{if(!dragging)return; view.current.yaw-=(e.clientX-lastX)*.004;view.current.pitch=Math.max(-1.15,Math.min(1.15,view.current.pitch-(e.clientY-lastY)*.004));lastX=e.clientX;lastY=e.clientY;};
    const pointerUp=()=>{dragging=false;};
    canvas.tabIndex=0; canvas.focus({preventScroll:true});
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',reset);
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    return ()=>{reset();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',reset);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);};
  },[b,apt,controls,gl]);
  useFrame((_,delta)=>{
    const dt=Math.min(delta,.05), p=view.current, held=keys.current;
    if(useUiStore.getState().debugOpen) {held.clear();clearWalkInput();}
    const forward=Number(held.has('KeyW')||held.has('ArrowUp'))-Number(held.has('KeyS')||held.has('ArrowDown'))+walkInput.forward;
    const right=Number(held.has('KeyD')||held.has('ArrowRight'))-Number(held.has('KeyA')||held.has('ArrowLeft'))+walkInput.right;
    p.yaw-=walkInput.turn*dt*1.3;
    const length=Math.max(1,Math.hypot(forward,right));
    const speed=(held.has('ShiftLeft')||held.has('ShiftRight')?2.6:1.7)*dt/length;
    const next=moveWalker(p,(Math.sin(p.yaw)*forward-Math.cos(p.yaw)*right)*speed,(Math.cos(p.yaw)*forward+Math.sin(p.yaw)*right)*speed);
    p.u=next.u;p.v=next.v;
    const eye=planToWorld(b,p.u,p.v,WALK_EYE_M+.12,apt.floor,apt.mirrored);
    const yaw=p.yaw+b.rotationY+(apt.mirrored?Math.PI:0), flat=Math.cos(p.pitch);
    controls.setLookAt(eye.x,eye.y,eye.z,eye.x+Math.sin(yaw)*flat,eye.y+Math.sin(p.pitch),eye.z+Math.cos(yaw)*flat,false);
  });
  return null;
}
