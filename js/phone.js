// Radrouten-Radar – Modul „phone“: iPhone-Layout (Bildschirmbreite ≤ 600 px).
// Gleiche Bedienelemente wie auf iPad/Desktop – sie werden auf schmalen Bildschirmen in ein Panel
// von unten (Bottom Sheet) umgehängt und beim Verbreitern wieder an ihren Platz zurückgesetzt.
import { state } from './state.js';
import { $, dtf, esc, km, nf0, nf1 } from './util.js';
import { map } from './map.js';
import { setupSearch } from './geocode.js';
import { fitCircle, setStart } from './start.js';
import { computeRoute, profileName } from './routing.js';
import { fmtH, maxDurationH, scheduleWeather, speedKmh, startUnix, timePlan, wxInfo } from './weather.js';
import { legend } from './wxmap.js';
import { addTarget, label, toast } from './targets.js';
import { bestChart, chart, wxChart } from './charts.js';
import { renderAll } from './render.js';
import { fmtV, paceModel } from './pace.js';

const phoneMQ=matchMedia('(max-width:600px)');
export const isPhone=()=>document.body.classList.contains('phone');
const resizeCharts=()=>[chart,wxChart,bestChart].forEach(c=>c.resize());

/* ---- Umhängen der vorhandenen Bereiche in das Panel */
let PHONE_PARTS=[];         // [Element, Ziel-Reiter]
const homes=new Map();      // Element → Platzhalter am ursprünglichen Ort
function applyPhone(on){
  if(on===isPhone()) return;
  if(on){
    PHONE_PARTS.forEach(([el,sp])=>{ const ph=document.createComment('home'); el.parentNode.insertBefore(ph,el); homes.set(el,ph);
      document.querySelector(`#sheetBody .sp[data-sp="${sp}"]`).appendChild(el); });
    document.body.classList.add('phone'); document.body.classList.remove('side-open');
    legend.setPosition('topleft');      // oben links ist frei (Zoom-Tasten sind ausgeblendet)
  } else {
    PHONE_PARTS.forEach(([el])=>{ const ph=homes.get(el); if(ph){ ph.parentNode.insertBefore(el,ph); ph.remove(); } });
    homes.clear(); document.body.classList.remove('phone'); document.body.style.removeProperty('--sheetH');
    legend.setPosition('bottomleft');
  }
  setTimeout(()=>{ map.invalidateSize(); resizeCharts(); sheetTo($('sheet').dataset.state||'peek'); },60);
  renderAll();
}

/* ---- Panel: drei Höhen (peek / half / full), ziehen oder antippen */
const SHEET_STATES=['peek','half','full'];
function sheetHeights(){ const H=window.innerHeight; return {peek:96, half:Math.round(H*0.48), full:Math.round(H-($('phoneTop').offsetHeight||100)+8)}; }
export function sheetTo(st){
  const sh=$('sheet'); if(!SHEET_STATES.includes(st)) st='peek';
  sh.dataset.state=st; const h=sheetHeights()[st];
  sh.style.height=h+'px'; document.body.style.setProperty('--sheetH',(isPhone()?h:0)+'px');
  if(st!=='peek') setTimeout(resizeCharts,280);
}
// Kartenausschnitt so wählen, dass Kopfleiste und Panel nichts verdecken
export function fitOpts(pad=20){
  if(!isPhone()) return {padding:[pad,pad]};
  const top=($('phoneTop').offsetHeight||110)+6, bottom=(sheetHeights()[$('sheet').dataset.state]||96)+10;
  return {paddingTopLeft:[pad,top], paddingBottomRight:[pad,bottom]};
}
function wireSheetDrag(){
  const sh=$('sheet'), grab=[$('sheetHandle'),$('sheetPeek')];
  let y0=null,h0=0,t0=0,moved=false;
  const start=e=>{ const p=e.touches?e.touches[0]:e; y0=p.clientY; h0=sh.offsetHeight; t0=Date.now(); moved=false; sh.classList.add('drag'); };
  const move=e=>{ if(y0==null) return; const p=e.touches?e.touches[0]:e; const dy=y0-p.clientY; if(Math.abs(dy)>4) moved=true;
    const H=sheetHeights(); sh.style.height=Math.max(H.peek,Math.min(H.full,h0+dy))+'px'; if(e.cancelable) e.preventDefault(); };
  const end=()=>{ if(y0==null) return; sh.classList.remove('drag');
    const H=sheetHeights(), h=sh.offsetHeight, v=(h-h0)/Math.max(1,Date.now()-t0);  // px/ms
    let st;
    if(!moved) st=sh.dataset.state==='peek'?'half':sh.dataset.state==='half'?'full':'half';
    else if(Math.abs(v)>0.5) st=v>0?(h0<H.half?'half':'full'):(h0>H.half?'half':'peek');
    else st=SHEET_STATES.reduce((a,k)=>Math.abs(H[k]-h)<Math.abs(H[a]-h)?k:a,'peek');
    y0=null; sheetTo(st); };
  grab.forEach(g=>{ g.addEventListener('touchstart',start,{passive:true}); g.addEventListener('mousedown',start); });
  window.addEventListener('touchmove',move,{passive:false}); window.addEventListener('mousemove',move);
  window.addEventListener('touchend',end); window.addEventListener('mouseup',end);
}
function showSeg(sp){
  document.querySelectorAll('#sheetSeg button').forEach(b=>b.classList.toggle('on',b.dataset.sp===sp));
  document.querySelectorAll('#sheetBody .sp').forEach(x=>x.classList.toggle('on',x.dataset.sp===sp));
  $('sheetBody').scrollTop=0;
  setTimeout(resizeCharts,30);
}
export function phoneFocusRoute(id){
  showSeg('routes'); if($('sheet').dataset.state==='peek') sheetTo('half');
  setTimeout(()=>{ const c=document.querySelector(`#sheetBody .card[data-id="${id}"]`); if(c) c.scrollIntoView({block:'nearest',behavior:'smooth'}); },80);
}

/* ---- Kopfleiste (Chips) und Kurzinfo im eingeklappten Panel */
function goSetting(id){
  showSeg('settings'); sheetTo('full');
  setTimeout(()=>{ const el=$(id); if(!el) return; el.scrollIntoView({block:'center',behavior:'smooth'}); el.focus({preventScroll:true}); },300);
}
export function renderPhone(){
  if(!isPhone()) return;
  const T=maxDurationH(), prof=$('profile').selectedOptions[0];
  $('phoneChips').innerHTML=[
    ['radius',`⭕ ${nf0.format(state.radiusKm)} km`],
    ['startTime',`🕑 ${dtf.format(new Date(startUnix()*1000))}`],
    ['maxDur',T?`⏱ max. ${fmtH(T)}`:'⏱ ohne Zeitlimit'],
    ['speed',paceModel()==='phys'?`🚴 ${nf1.format(speedKmh())} km/h Ebene`:`🚴 Ø ${nf1.format(speedKmh())} km/h`],
    ['profile',`🚲 ${prof?prof.textContent.replace(/\s*\(.*\)/,''):profileName()}`],
    ['retDefault',`↩ ${({none:'ohne Rückweg',best:'Rückweg optimal',same:'Rückweg gleich',alt:'Rückweg anders'})[$('retDefault').value]}`]
  ].map(([id,t])=>`<button class="chip" data-goto="${id}">${esc(t)}</button>`).join('');
  $('phoneChips').querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>goSetting(b.dataset.goto));
  const ok=state.routes.filter(r=>r.status==='ok'), busy=state.routes.filter(r=>r.status==='loading').length, R=state.ranking||[];
  let html;
  if(!state.start) html='<span class="pk">📍 Tippe in die Karte, um den <b>Start</b> zu setzen</span>';
  else if(!state.routes.length) html=`<span class="pk">🎯 Start: <b>${esc(state.startName)}</b> · tippe in die Karte für Ziele</span>`;
  else if(R.length>1){
    const b=R[0], pl=timePlan(b.r);
    html=`<span class="rank r1">1</span><span class="pk"><b>${esc(label(b.r))}</b> · ${nf0.format(b.score.total)} Pkt · ${km(b.r.lengthM)} km${pl&&pl.T?` · ${pl.ok?'✓':'⚠'} ${esc(fmtV(pl.vReq))}`:pl?` · ${fmtH(pl.durAtSpeed)}`:''}</span>`+
      `<span style="color:var(--muted);font-size:12.5px">${ok.length} Routen${busy?` · <span class="spin"></span> ${busy}`:''}</span>`;
  } else if(ok.length===1&&!busy){
    const r=ok[0], pl=timePlan(r);
    html=`<span class="pk"><b>${esc(label(r))}</b> · ${km(r.lengthM)} km · ${nf0.format(r.ascent)} hm${pl?` · ${fmtH(pl.durAtSpeed)}`:''}</span><span style="color:var(--muted);font-size:12.5px">Rangliste ab 2 Routen</span>`;
  } else html=`<span class="pk">${busy?`<span class="spin"></span> ${busy} Route${busy>1?'n werden':' wird'} berechnet …`:`${ok.length} Route${ok.length!==1?'n':''}`}</span>`;
  $('sheetPeek').innerHTML=html;
  $('fabWind').classList.toggle('active',$('showArrows').checked);
}
function fitAll(){
  const ls=state.routes.map(r=>r.line).filter(Boolean);
  if(ls.length) map.fitBounds(L.featureGroup(ls).getBounds(),fitOpts(30)); else fitCircle();
}

/* ---- Einrichtung (einmal beim Start, vor dem Wiederherstellen der Planung) */
export function initPhone(){
  PHONE_PARTS=[
    ...[...document.querySelectorAll('#side > section')].map(el=>[el,'settings']),
    [$('routes'),'routes'], [$('rankPane'),'rank'], [$('paneProfile'),'profile'], [$('paneWeather'),'weather'], [$('paneTable'),'table']
  ];
  wireSheetDrag();
  document.querySelectorAll('#sheetSeg button').forEach(b=>b.onclick=()=>{ showSeg(b.dataset.sp); if($('sheet').dataset.state==='peek') sheetTo('half'); });
  setupSearch('phoneQuery','phoneSearchBtn','phoneResults',(ll,lbl)=>{ $('phoneQuery').blur(); if(!state.start) setStart(ll,lbl); else addTarget(ll,lbl); });
  $('fabLocate').onclick=()=>$('locateBtn').click();
  $('fabWind').onclick=()=>{ const c=$('showArrows'); c.checked=!c.checked; c.dispatchEvent(new Event('change')); };
  $('fabFit').onclick=fitAll;
  $('spAll').onclick=()=>{ sheetTo('peek'); fitAll(); };
  $('spExport').onclick=()=>$('exportAllBtn').click();
  // Installationshinweis (iOS Safari, nicht als Home-Bildschirm-App gestartet)
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  let seen=false; try{ seen=localStorage.getItem('rr-install-hint')==='1'; }catch{}
  if(ios&&!standalone&&!seen) $('installHint').classList.add('on');
  $('installClose').onclick=()=>{ $('installHint').classList.remove('on'); try{ localStorage.setItem('rr-install-hint','1'); }catch{} };
  // Nach App-Wechsel/Sperrbildschirm: wegen Netzabbruch fehlgeschlagene Berechnungen fortsetzen
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible') return;
    const broken=state.routes.filter(r=>r.status==='error'&&/nicht erreichbar|Failed|Load failed|Netzwerk/i.test(r.error||''));
    if(broken.length){ toast(`${broken.length} Route${broken.length>1?'n werden':' wird'} fortgesetzt …`); broken.forEach(computeRoute); }
    if(wxInfo.state==='error') scheduleWeather(300);
  });
  phoneMQ.addEventListener('change',e=>applyPhone(e.matches));
  window.addEventListener('resize',()=>{ if(isPhone()) sheetTo($('sheet').dataset.state); });
  applyPhone(phoneMQ.matches);
}
