// Radrouten-Radar – Modul „main“
import { MAX_RADIUS_KM } from './config.js';
import { state } from './state.js';
import { $ } from './util.js';
import { hoverMarker, map, setMsg } from './map.js';
import { setupSearch } from './geocode.js';
import { drawCircle, fitCircle, setStart } from './start.js';
import { computeRoute, deadServers, toggleCustom } from './routing.js';
import { maxDurationH, nextFullHour, scheduleWeather, setStartUnix, startUnix } from './weather.js';
import { addTarget, offerUndo, removeTarget, snapshot } from './targets.js';
import { exportAll } from './export.js';
import { listPending, renderList } from './list.js';
import { bestChart, chart, renderChart, wxChart } from './charts.js';
import { renderAll } from './render.js';
import { restore, save } from './storage.js';
import { initPhone, isPhone } from './phone.js';
import { initBottom, showBottom } from './bottom.js';
import { initShare, openSharedFromHash } from './share.js';
import { initWindMap } from './windmap.js';

/* ================================================================ UI-Verdrahtung & Start */
map.on('click', e => {
  const ll={lat:e.latlng.lat, lng:((e.latlng.lng+540)%360)-180};
  if(state.pickStart || !state.start){ state.pickStart=false; $('pickStartBtn').classList.remove('active'); setStart(ll); }
  else addTarget(ll);
});
// Aufgeschobene Aktualisierung der Routenliste nachholen, sobald ein Eingabefeld darin verlassen wird
$('routes').addEventListener('focusout',()=>setTimeout(()=>{ if(listPending) renderList(); },0));
setupSearch('startQuery','startSearchBtn','startResults',(ll,lbl)=>setStart(ll,lbl));
setupSearch('targetQuery','targetSearchBtn','targetResults',(ll,lbl)=>{ if(!state.start){ setStart(ll,lbl); return; } addTarget(ll,lbl); });
$('pickStartBtn').onclick=()=>{ state.pickStart=!state.pickStart; $('pickStartBtn').classList.toggle('active',state.pickStart); setMsg(state.pickStart?'Klicke in die Karte, um den Startpunkt zu setzen.':''); };
$('locateBtn').onclick=()=>{
  if(!navigator.geolocation){ setMsg('Standortabfrage wird von diesem Browser nicht unterstützt.'); return; }
  setMsg('Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(p=>setStart({lat:p.coords.latitude,lng:p.coords.longitude}),
    e=>setMsg('Standort nicht verfügbar: '+e.message),{enableHighAccuracy:true,timeout:15000});
};
$('radius').addEventListener('change',()=>{
  let v=parseFloat(String($('radius').value).replace(',','.'));
  if(!isFinite(v)||v<=0) v=100; v=Math.min(MAX_RADIUS_KM,v);
  $('radius').value=v; state.radiusKm=v; drawCircle(); fitCircle(); save(); renderAll();
});
const recalcAll=()=>{ deadServers.clear(); state.routes.forEach(computeRoute); };
$('profile').addEventListener('change',()=>{ toggleCustom(); save(); if($('profile').value!=='__custom') recalcAll(); });
$('customProfile').addEventListener('change',()=>{ save(); recalcAll(); });
$('server').addEventListener('change',()=>{ toggleCustom(); save(); if($('server').value!=='custom') recalcAll(); });
$('customServer').addEventListener('change',()=>{ save(); recalcAll(); });
$('recalcBtn').onclick=recalcAll;
$('retAll').onclick=()=>{ const v=$('retDefault').value; state.routes.forEach(r=>{ if((r.retMode||'none')!==v){ r.retMode=v; computeRoute(r); } }); save(); };
$('retDefault').addEventListener('change',save);
$('maxDur').addEventListener('change',()=>{ const h=maxDurationH(); if($('maxDur').value.trim()&&!h) $('maxDur').value=''; save(); scheduleWeather(150); renderAll(); });
$('exportAllBtn').onclick=exportAll;
$('clearBtn').onclick=()=>{
  const snaps=state.routes.map(snapshot); if(!snaps.length) return;
  [...state.routes].forEach(r=>removeTarget(r.id,{undo:false}));
  offerUndo(`${snaps.length} ${snaps.length===1?'Ziel':'Ziele'} entfernt`,snaps);
};
$('onlySel').addEventListener('change',renderChart);
// Wetter-Steuerung
$('startTime').addEventListener('change',()=>{ save(); scheduleWeather(150); });
['speed','hpd','wxMode','paceModel','mass'].forEach(id=>$(id).addEventListener('change',()=>{ save(); scheduleWeather(150); }));
['routeColor','showArrows','arrowsAll'].forEach(id=>$(id).addEventListener('change',()=>{ save(); renderAll(); }));
document.querySelectorAll('[data-shift]').forEach(b=>b.onclick=()=>{
  const v=b.dataset.shift; setStartUnix(v==='now'?nextFullHour():startUnix()+(+v)*3600);
});
document.querySelectorAll('#tabs [data-pane]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs [data-pane]').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id===b.dataset.pane));
  showBottom();
  setTimeout(()=>{map.invalidateSize(); [chart,wxChart,bestChart].forEach(c=>c.resize());},0);
});
['chart','wxChart'].forEach(id=>$(id).addEventListener('mouseleave',()=>map.removeLayer(hoverMarker)));
document.addEventListener('keydown',e=>{
  // Nur „Entf“ und nur, wenn Karte/Seite den Fokus hat (nicht nach Klick auf einen Button o. Ä.)
  const ae=document.activeElement;
  if(e.key==='Delete' && state.selectedId && (!ae||ae===document.body||$('map').contains(ae))) removeTarget(state.selectedId);
  if(e.key==='Escape'&&state.pickStart){ state.pickStart=false; $('pickStartBtn').classList.remove('active'); setMsg(''); }
});

// Schublade (schmale Ansicht)
const narrow=()=>matchMedia('(max-width:900px)').matches;
const openSide=o=>{ document.body.classList.toggle('side-open',o); };
$('menuBtn').onclick=()=>openSide(true);
$('closeSide').onclick=()=>openSide(false);
$('backdrop').onclick=()=>openSide(false);
// nach Auswahl eines Suchtreffers die Karte zeigen
['startResults','targetResults'].forEach(id=>$(id).addEventListener('click',()=>{ if(narrow()) setTimeout(()=>openSide(false),150); }));
$('routes').addEventListener('click',e=>{ if(narrow()&&e.target.closest('[data-act="zoom"]')) openSide(false); });
window.addEventListener('resize',()=>{ if(!narrow()) openSide(false); setTimeout(()=>{map.invalidateSize(); [chart,wxChart,bestChart].forEach(c=>c.resize());},200); });

// Offline-Start & Installation als Web-App (nur über https/localhost)
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

initBottom();  // unterer Bereich: Griff, Ausblenden, gespeicherte Höhe
initPhone();   // iPhone-Layout einrichten (Bereiche ggf. ins Panel umhängen)
initShare();
initWindMap();  // Windkarte (Overlay mit Zeitregler)
if(!openSharedFromHash()) restore();   // geteilter Link hat Vorrang vor der gespeicherten Planung
renderAll();
if(state.start||isPhone()) setMsg('');   // iPhone: Hinweis steht in der Kurzinfo des Panels
else if(narrow()) setMsg('Tippe in die Karte, um den Startpunkt zu setzen – oder öffne ☰ für die Suche.');
