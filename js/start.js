// Radrouten-Radar – Modul „start“
import { geodesicCircle } from './core.js';
import { state } from './state.js';
import { $, esc, nf2 } from './util.js';
import { map, setMsg } from './map.js';
import { reverseName } from './geocode.js';
import { computeRoute } from './routing.js';
import { renderAll } from './render.js';
import { save } from './storage.js';
import { fitOpts } from './phone.js';

/* ================================================================ Startpunkt & Kreis */
let startMarker=null, circleLayer=null;
function startIcon(){ return L.divIcon({className:'',html:'<div class="pin start">S</div>',iconSize:[26,26],iconAnchor:[13,13]}); }
export async function setStart(ll,label,{recompute=true,fit=true}={}){
  state.start={lat:ll.lat,lng:ll.lng};
  state.startName=label||`${nf2.format(ll.lat)}, ${nf2.format(ll.lng)}`;
  if(!startMarker){
    startMarker=L.marker([ll.lat,ll.lng],{icon:startIcon(),draggable:true,zIndexOffset:1000,title:'Startpunkt (verschiebbar)'}).addTo(map);
    startMarker.on('dragend',()=>{const p=startMarker.getLatLng(); setStart({lat:p.lat,lng:((p.lng+540)%360)-180},null,{fit:false});});
  } else startMarker.setLatLng([ll.lat,ll.lng]);
  drawCircle(); if(fit) fitCircle();
  updateStartInfo(); setMsg('');
  if(!label) reverseName(state.start).then(n=>{ if(n){ state.startName=n; updateStartInfo(); save(); } });
  if(recompute) state.routes.forEach(computeRoute);
  save(); renderAll();
}
function updateStartInfo(){
  const el=$('startInfo'); el.style.display='block';
  el.innerHTML=`<b>Start:</b> ${esc(state.startName)}<br><span style="color:var(--muted)">${state.start.lat.toFixed(5)}, ${state.start.lng.toFixed(5)}</span>`;
  startMarker.bindTooltip('Start: '+esc(state.startName));   // Tooltips sind HTML – Namen maskieren
}
export function drawCircle(){
  if(!state.start) return;
  const pts=geodesicCircle(state.start,state.radiusKm);
  if(circleLayer) circleLayer.setLatLngs(pts);
  else circleLayer=L.polygon(pts,{color:'#1f6feb',weight:2,dashArray:'6 6',fillColor:'#1f6feb',fillOpacity:.06,interactive:false}).addTo(map);
}
export function fitCircle(){ if(circleLayer) map.fitBounds(circleLayer.getBounds(),fitOpts()); }
