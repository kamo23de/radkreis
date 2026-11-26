// Radrouten-Radar – Modul „targets“
import { COLORS } from './config.js';
import { state } from './state.js';
import { $ } from './util.js';
import { hoverMarker, map } from './map.js';
import { reverseName } from './geocode.js';
import { setStart } from './start.js';
import { computeRoute } from './routing.js';
import { rankOf } from './ranking.js';
import { renderAll } from './render.js';
import { save } from './storage.js';

/* ================================================================ Ziele verwalten */
export function pinIcon(r){ const rk=rankOf(r); return L.divIcon({className:'',html:`<div class="pin${r.status==='loading'?' loading':''}${rk===1?' best':''}" style="background:${r.color}">${r.num}${rk?`<span class="rk">#${rk}</span>`:''}</div>`,iconSize:[26,26],iconAnchor:[13,13]}); }
function nextColor(){ const used=new Set(state.routes.map(r=>r.color)); return COLORS.find(c=>!used.has(c))||COLORS[state.counter%COLORS.length]; }
export function addTarget(ll,label,opts={}){
  const compute=opts.compute!==false;
  if(!state.start){ setStart(ll,label); return; }
  const id='r'+(++state.counter);
  const colorFree=c=>c&&!state.routes.some(x=>x.color===c);
  const r={id, num:opts.num!=null&&!state.routes.some(x=>x.num===opts.num)?opts.num:state.counter, color:colorFree(opts.color)?opts.color:nextColor(), latlng:{lat:ll.lat,lng:ll.lng}, name:label||null, status:'idle', retMode:opts.retMode||$('retDefault').value, pausePct:opts.pausePct??state.defaultPause??0};
  r.marker=L.marker([ll.lat,ll.lng],{icon:pinIcon(r),draggable:true,title:'Ziel – ziehen zum Verschieben, Rechtsklick zum Entfernen'}).addTo(map);
  r.marker.on('click',()=>select(r.id));
  r.marker.on('contextmenu',ev=>{L.DomEvent.preventDefault(ev); removeTarget(r.id);});
  r.marker.on('dragend',()=>{const p=r.marker.getLatLng(); r.latlng={lat:p.lat,lng:((p.lng+540)%360)-180}; r.name=null; nameTarget(r); computeRoute(r); save();});
  if(opts.index!=null&&opts.index>=0&&opts.index<state.routes.length) state.routes.splice(opts.index,0,r); else state.routes.push(r);
  state.selectedId=r.id;
  if(!r.name) nameTarget(r);
  if(compute) computeRoute(r);
  save(); renderAll();
}
function nameTarget(r){ const ll=r.latlng; reverseName(ll).then(n=>{ if(n && r.latlng===ll){ r.name=n; renderAll(); save(); } }); }
export const snapshot=r=>({lat:r.latlng.lat,lng:r.latlng.lng,name:r.name,retMode:r.retMode,pausePct:r.pausePct||0,
  num:r.num,color:r.color,index:state.routes.indexOf(r)});
let undoTimer=null;
export function offerUndo(text,items){
  const t=$('toast'); $('toastText').textContent=text; t.classList.add('on');
  clearTimeout(undoTimer); undoTimer=setTimeout(()=>t.classList.remove('on'),8000);
  $('toastUndo').onclick=()=>{ clearTimeout(undoTimer); t.classList.remove('on');
    items.forEach(x=>addTarget(x,x.name,{retMode:x.retMode,pausePct:x.pausePct,num:x.num,color:x.color,index:x.index})); };
}
export function removeTarget(id,{undo=true}={}){
  const i=state.routes.findIndex(r=>r.id===id); if(i<0) return;
  const r=state.routes[i]; r.ctrl&&r.ctrl.abort();
  if(undo) offerUndo(`„${label(r)}“ entfernt`,[snapshot(r)]);
  map.removeLayer(r.marker); r.line&&map.removeLayer(r.line);
  state.routes.splice(i,1);
  if(state.selectedId===id) state.selectedId=state.routes.length?state.routes[state.routes.length-1].id:null;
  map.removeLayer(hoverMarker); save(); renderAll();
}
export function select(id,{zoom=false}={}){
  state.selectedId=id; renderAll();
  const r=state.routes.find(x=>x.id===id);
  if(zoom&&r){ if(r.line) map.fitBounds(r.line.getBounds(),{padding:[30,30]}); else map.panTo([r.latlng.lat,r.latlng.lng]); }
}
export function drawRoute(r){
  if(r.line){ map.removeLayer(r.line); r.line=null; }
  if(r.status==='ok'&&r.coords){
    const ll=r.coords.map(p=>[p[1],p[0]]);
    if(r.retLen&&r.outIdx){
      r.line=L.featureGroup([
        L.polyline(ll.slice(0,r.outIdx+1),{color:r.color,weight:4,opacity:.85}),
        L.polyline(ll.slice(r.outIdx),{color:r.color,weight:4,opacity:.85,dashArray:'7 7'})
      ]).addTo(map);
    } else r.line=L.polyline(ll,{color:r.color,weight:4,opacity:.85}).addTo(map);
    r.line.on('click',ev=>{L.DomEvent.stopPropagation(ev); select(r.id);});
  }
}
export const label = r => r.name || `Ziel ${r.num}`;
