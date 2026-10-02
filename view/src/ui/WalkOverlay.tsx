import type { PointerEvent } from 'react';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { clearWalkInput, walkInput } from '../store/walkInput';

export function WalkOverlay() {
  const id=useUiStore(s=>s.firstPersonUnit);
  const layout=useModelStore(s=>s.layout);
  const apartments=layout?.apartments ?? [];
  const current=apartments.find(a=>a.id===id);
  const show=useUiStore(s=>s.showDeviceNames);
  if(!id)return null;
  const hold=(field:keyof typeof walkInput,value:number)=>(e:PointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);walkInput[field]=value;};
  const button=(label:string,text:string,field:keyof typeof walkInput,value:number)=><button aria-label={label} onPointerDown={hold(field,value)} onPointerUp={clearWalkInput} onPointerCancel={clearWalkInput} onLostPointerCapture={clearWalkInput} onKeyDown={(e)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();walkInput[field]=value;}}} onKeyUp={clearWalkInput}>{text}</button>;
  return <>
    <div className="walk-heading"><strong>{id} · Prima persona</strong><label>Interno <select aria-label="Interno da visitare" value={id} onChange={e=>{const a=apartments.find(a=>a.id===e.target.value);if(a)useUiStore.getState().enterApartment(a.id,a.building,a.floor);}}>{apartments.filter(a=>a.building===current?.building&&a.floor===current?.floor).map(a=><option key={a.id} value={a.id}>{a.number}</option>)}</select></label><span>Clicca un dispositivo per vedere i dettagli</span>
      <button aria-pressed={show} onClick={()=>useUiStore.getState().toggleDeviceNames()}>{show?'Nascondi':'Mostra'} nomi dispositivi</button>
    </div>
    <section className="walk-controls" aria-label="Movimento in prima persona">
      <p>Trascina per guardarti intorno · W A S D o frecce per camminare · Esc per uscire</p>
      <div className="walk-pad">
        {button('Gira a sinistra','↶','turn',-1)}{button('Cammina avanti','↑','forward',1)}{button('Gira a destra','↷','turn',1)}
        {button('Passo a sinistra','←','right',-1)}{button('Cammina indietro','↓','forward',-1)}{button('Passo a destra','→','right',1)}
      </div>
    </section>
  </>;
}
