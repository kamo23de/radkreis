// Radrouten-Radar – Modul „storage“
import { STORE_KEY } from './config.js';
import { state } from './state.js';
import { $ } from './util.js';
import { setStart } from './start.js';
import { toggleCustom } from './routing.js';
import { nextFullHour, toLocalInput } from './weather.js';
import { addTarget } from './targets.js';
import { normalizeWeights } from './ranking.js';

/* ================================================================ Persistenz (localStorage) */
let restoring=false;   // während restore() nicht speichern, sonst würde ein Zwischenstand (ohne Ziele) die gespeicherten Daten überschreiben
export function save(){
  if(restoring) return;
  try{
    localStorage.setItem(STORE_KEY,JSON.stringify({
      start:state.start, startName:state.startName, radiusKm:state.radiusKm,
      profile:$('profile').value, customProfile:$('customProfile').value, server:$('server').value, customServer:$('customServer').value,
      startTime:$('startTime').value, speed:$('speed').value, hpd:$('hpd').value, wxMode:$('wxMode').value,
      routeColor:$('routeColor').value, showArrows:$('showArrows').checked, arrowsAll:$('arrowsAll').checked, optWeights:state.optWeights,
      retDefault:$('retDefault').value, maxDur:$('maxDur').value,
      defaultPause:state.defaultPause??0,
      targets:state.routes.map(r=>({lat:r.latlng.lat,lng:r.latlng.lng,name:r.name,retMode:r.retMode,pausePct:r.pausePct||0}))
    }));
  }catch{}
}
export function restore(){
  $('startTime').value=toLocalInput(new Date(nextFullHour()*1000));
  let s=null; try{ s=JSON.parse(localStorage.getItem(STORE_KEY)||'null'); }catch{}
  if(!s) return;
  ['profile','customProfile','server','customServer','speed','hpd','wxMode','routeColor','retDefault','maxDur'].forEach(k=>{ if(s[k]!=null&&s[k]!=='') $(k).value=s[k]; });
  if(s.showArrows!=null) $('showArrows').checked=s.showArrows;
  if(s.optWeights){ Object.assign(state.optWeights,s.optWeights); normalizeWeights(); }
  if(s.arrowsAll!=null) $('arrowsAll').checked=s.arrowsAll;
  if(s.startTime){ const t=new Date(s.startTime).getTime(); if(isFinite(t)&&t>Date.now()-3600e3) $('startTime').value=s.startTime; }
  toggleCustom();
  if(s.radiusKm){ state.radiusKm=s.radiusKm; $('radius').value=s.radiusKm; }
  const okLL=p=>p&&isFinite(p.lat)&&isFinite(p.lng)&&Math.abs(p.lat)<=90;
  if(okLL(s.start)){
    restoring=true;
    try{
      setStart(s.start,s.startName,{recompute:false});
      if(s.defaultPause!=null) state.defaultPause=+s.defaultPause||0;
      (s.targets||[]).filter(okLL).forEach(t=>{
        try{ addTarget(t,t.name,{retMode:t.retMode||'none',pausePct:+t.pausePct||0}); }catch(e){ console.warn('Ziel nicht wiederhergestellt',t,e); }
      });
    } finally { restoring=false; }
    save();
  }
}
