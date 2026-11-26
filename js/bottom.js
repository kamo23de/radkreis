// Radrouten-Radar – Modul „bottom“: unterer Bereich (Höhenprofil, Wetter, Vergleich, Ranking) auf iPad/Desktop.
// Am Griff ziehen ändert die Höhe; nach unten ziehen oder wischen schiebt den Bereich aus dem Bild,
// die Taste „▴ Höhenprofil & Wetter“ auf der Karte holt ihn zurück. Zustand und Höhe werden je Gerät gemerkt.
import { $ } from './util.js';
import { map } from './map.js';
import { bestChart, chart, wxChart } from './charts.js';

const KEY='rr-bottom';
const MIN_H=120;          // kleinste Höhe im eingeblendeten Zustand (px)
const FLICK=0.5;          // Wischen nach unten schneller als das (px/ms, letzte 100 ms) → ausblenden
let saved={hidden:false,h:null};
try{ Object.assign(saved,JSON.parse(localStorage.getItem(KEY)||'{}')); }catch{}
const store=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(saved)); }catch{} };

const maxH=()=>Math.max(MIN_H,Math.round(($('main').clientHeight||window.innerHeight)*0.7));
function relayout(){ map.invalidateSize({pan:false}); [chart,wxChart,bestChart].forEach(c=>c.resize()); }
function applyHeight(){
  const b=$('bottom');
  if(saved.h) b.style.height=Math.min(maxH(),Math.max(MIN_H,saved.h))+'px'; else b.style.removeProperty('height');
}
export const bottomHidden=()=>document.body.classList.contains('bottom-hidden');
export function setBottomHidden(hidden){
  saved.hidden=hidden; store();
  document.body.classList.toggle('bottom-hidden',hidden);
  if(!hidden) applyHeight();
  setTimeout(relayout,0);
}
export const showBottom=()=>{ if(bottomHidden()) setBottomHidden(false); };

function wireDrag(){
  const b=$('bottom'), handle=$('bottomHandle');
  let y0=null,h0=0,moved=false,raf=0,trail=[];    // trail: [Zeit, y] der letzten Bewegungen
  handle.addEventListener('pointerdown',e=>{
    y0=e.clientY; h0=b.offsetHeight; moved=false; trail=[[performance.now(),e.clientY]];
    handle.setPointerCapture(e.pointerId); b.classList.add('drag'); e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(y0==null) return;
    const dy=y0-e.clientY; if(Math.abs(dy)>4) moved=true;
    const now=performance.now(); trail.push([now,e.clientY]); while(trail.length>2&&now-trail[0][0]>100) trail.shift();
    b.style.height=Math.max(0,Math.min(maxH(),h0+dy))+'px';
    if(!raf) raf=requestAnimationFrame(()=>{ raf=0; map.invalidateSize({pan:false}); });
  });
  const end=e=>{
    if(y0==null) return;
    const h=b.offsetHeight, a=trail[0], z=trail[trail.length-1];
    const v=(z[1]-a[1])/Math.max(16,z[0]-a[0]);                    // Tempo am Ende der Geste, > 0: nach unten
    y0=null; b.classList.remove('drag');
    if(handle.hasPointerCapture&&handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    if(!moved){ setBottomHidden(true); return; }                   // Antippen des Griffs = ausblenden
    if(h<MIN_H||v>FLICK){ applyHeight(); setBottomHidden(true); return; }   // kleiner als Mindesthöhe oder weggewischt
    saved.h=Math.max(MIN_H,h); store(); applyHeight(); relayout();
  };
  handle.addEventListener('pointerup',end);
  handle.addEventListener('pointercancel',end);
}

export function initBottom(){
  document.body.classList.toggle('bottom-hidden',!!saved.hidden);
  applyHeight();
  wireDrag();
  $('toggleBottom').onclick=()=>setBottomHidden(true);
  $('bottomShow').onclick=()=>setBottomHidden(false);
  window.addEventListener('resize',()=>{ if(!bottomHidden()) applyHeight(); });
}
