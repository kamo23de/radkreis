// Radrouten-Radar – Modul „list“
import { haversine } from './core.js';
import { CLIM_YEARS } from './config.js';
import { state } from './state.js';
import { $, esc, fmtDT, fmtTime, headTxt, km, nf0, nf1, nf2 } from './util.js';
import { computeRoute, RET_MODES } from './routing.js';
import { fmtH, hoursPerDay, scheduleWeather, speedKmh, startUnix, timePlan, wxInfo } from './weather.js';
import { label, removeTarget, select } from './targets.js';
import { bikerouterLink, exportOne, sendTo } from './export.js';
import { rankOf, retRowHtml, timeRowHtml, wayRowHtml } from './ranking.js';
import { renderAll } from './render.js';
import { save } from './storage.js';

/* ================================================================ Darstellung: Liste & Tabelle */
function metrics(r){
  const ok=r.status==='ok', w=ok&&r.wx?r.wx:null;
  return {
    num:r.num, name:label(r), color:r.color, ok,
    beeline:haversine(state.start,r.latlng),
    length:ok?r.lengthM:null,
    pctRadius:ok?(r.outLen||r.lengthM)/(state.radiusKm*1000)*100:null,
    detour:ok?(r.outLen||r.lengthM)/Math.max(1,haversine(state.start,r.latlng)):null,
    ascent:ok?r.ascent:null, descent:ok?r.descent:null,
    hmPer100:ok&&r.lengthM?r.ascent/(r.lengthM/100e3):null,
    maxEle:ok?r.maxEle:null,
    arrival:ok&&r.samples&&r.samples.length&&r.samples[0].t!=null?r.samples[r.samples.length-1].t:null,
    dur:ok?(timePlan(r)||{}).durAtSpeed:null, vReq:ok?(timePlan(r)||{}).vReq??null:null,
    head:w?w.avgHead:null, gust:w?w.maxGust:null, rain:w?w.rainMm:null
  };
}
function wxRowHtml(r){
  const w=r.wx; if(!w||w.avgHead==null) return wxInfo.state==='loading'?'<div class="wxrow"><span class="spin"></span> Wetter …</div>':'';
  const cls=w.avgHead>=0.5?'head':w.avgHead<=-0.5?'tail':'';
  return `<div class="wxrow">
    <span class="${cls}" title="Distanzgewichtetes Mittel der Windkomponente entlang der Fahrtrichtung">💨 Ø ${headTxt(w.avgHead)}</span>
    <span title="Stärkste Böe entlang der Route">Böen bis ${nf0.format(w.maxGust)} km/h</span>
    <span class="${w.rainMm>=0.5?'rainv':''}" title="Regenmenge, die während der Fahrt fällt; Anteil der Strecke mit ≥ 0,2 mm/h">🌧 ${nf1.format(w.rainMm)} mm (${nf0.format(w.wetPct)} % nass)</span>
    ${w.tMin!=null?`<span>🌡 ${nf0.format(w.tMin)}–${nf0.format(w.tMax)} °C</span>`:''}
    <span title="Ankunft bei ${nf1.format(speedKmh())} km/h${hoursPerDay()<24?`, ${nf1.format(hoursPerDay())} h/Tag`:''}">🏁 ${fmtDT(w.arrival)}</span>
    ${w.climShare>0?`<span class="badge" title="Ohne Vorhersage: Mittel der letzten ${CLIM_YEARS} Jahre (ERA5)">${w.climShare>=.99?'Klimamittel':'teilw. Klimamittel'}</span>`:''}
    ${w.coverage<0.99?'<span class="badge warn">Wetterdaten lückenhaft</span>':''}
  </div>`;
}
export let listPending=false;
export function renderList(){
  const box=$('routes'), ae=document.activeElement;
  // Während in einem Feld der Liste getippt wird, nicht neu aufbauen (Fokus/Eingabe/Tastatur gingen verloren) – beim Verlassen nachholen.
  if(ae&&ae.tagName==='INPUT'&&box.contains(ae)){ listPending=true; return; }
  listPending=false;
  if(!state.start){ box.innerHTML=''; return; }
  if(!state.routes.length){ box.innerHTML='<div class="empty">Noch keine Ziele.<br>Klicke in die Karte, um ein Ziel zu setzen.</div>'; return; }
  box.innerHTML=state.routes.map(r=>{
    const m=metrics(r), outside=m.beeline>state.radiusKm*1000;
    const over=m.ok&&r.lengthM>state.radiusKm*1000;
    let body='';
    if(r.status==='loading') body=`<div class="hint"><span class="spin"></span> Route wird berechnet${r.progress?' – '+r.progress:''} …</div>`;
    else if(r.status==='error') body=`<div class="err">⚠ ${esc(r.error)}</div>`;
    else if(m.ok) body=`<div class="stats">
        <div><span>${r.retLen?'Tour':'Route'}</span><b>${km(r.lengthM)} km</b>${r.retLen?`<span style="font-size:11px">${km(r.outLen)} hin + ${km(r.retLen)} zurück</span>`:''}</div>
        <div><span>Anstieg</span><b>${nf0.format(r.ascent)} m</b></div>
        <div><span>Abstieg</span><b>${nf0.format(r.descent)} m</b></div>
        <div><span>Luftlinie</span><b>${km(m.beeline)} km</b></div>
        <div><span>max. Höhe</span><b>${m.maxEle!=null?nf0.format(m.maxEle)+' m':'–'}</b></div>
        <div><span>Fahrzeit*</span><b>${fmtTime(r.timeS)}</b></div></div>${timeRowHtml(r)}${retRowHtml(r)}${wayRowHtml(r)}${wxRowHtml(r)}`;
    return `<div class="card${r.id===state.selectedId?' sel':''}" style="--c:${r.color}" data-id="${r.id}">
      <div class="t"><span class="num">${r.num}</span>${rankOf(r)?`<span class="rkb r${rankOf(r)}" title="Rang in der Bewertung">#${rankOf(r)}</span>`:''}<span class="nm" title="${esc(label(r))}">${esc(label(r))}</span>
        ${outside?'<span class="badge warn" title="Ziel liegt außerhalb des Kreises">außerhalb</span>':''}
        ${over&&!outside?'<span class="badge warn" title="Route ist länger als der Radius">&gt; Radius</span>':''}
        ${r.status==='error'?'<span class="badge err">Fehler</span>':''}</div>
      ${body}
      <div class="acts">
        <button class="small" data-act="gpx" ${m.ok?'':'disabled'}>⬇ GPX</button>
        <button class="small svc komoot" data-act="komoot" ${m.ok?'':'disabled'} title="Route nach Komoot übertragen">→ Komoot</button>
        <button class="small svc garmin" data-act="garmin" ${m.ok?'':'disabled'} title="Route als Kurs nach Garmin Connect übertragen">→ Garmin</button>
        <button class="small" data-act="zoom">⌖ Zeigen</button>
        <select class="small retSel" data-ret="${r.id}" title="Rückweg zum Start" style="width:auto;padding:3px 6px;font-size:12.5px;min-height:0">
          ${Object.entries(RET_MODES).map(([k,v])=>`<option value="${k}" ${(r.retMode||'none')===k?'selected':''}>↩ ${v}</option>`).join('')}
        </select>
        ${r.status==='error'?'<button class="small" data-act="retry">↻ Erneut</button>':''}
        <a class="small" href="${bikerouterLink(r)}" target="_blank" rel="noopener" style="font-size:12.5px;align-self:center;margin-left:2px">bikerouter.de ↗</a>
        <span style="flex:1"></span>
        <button class="small" data-act="del" title="Ziel entfernen">✕</button>
      </div></div>`;
  }).join('') + (state.routes.some(r=>r.status==='ok')?'<div class="hint">* Fahrzeit-Schätzung von BRouter (Profil-abhängig). Ankunft &amp; Wetter nutzen dein Ø-Tempo.</div>':'');
  box.querySelectorAll('input[data-pause]').forEach(inp=>{ inp.onclick=e=>e.stopPropagation(); inp.onkeydown=e=>{ if(e.key==='Enter') inp.blur(); }; inp.onchange=()=>{ const r=state.routes.find(x=>x.id===inp.dataset.pause); if(!r) return;
    r.pausePct=Math.min(90,Math.max(0,Math.round(+inp.value||0))); state.defaultPause=r.pausePct; save(); scheduleWeather(150); renderAll(); }; });
  box.querySelectorAll('select[data-ret]').forEach(sel=>sel.onchange=()=>{ const r=state.routes.find(x=>x.id===sel.dataset.ret); if(!r) return; r.retMode=sel.value; save(); computeRoute(r); });
  box.querySelectorAll('.card').forEach(c=>{
    const id=c.dataset.id, r=state.routes.find(x=>x.id===id);
    c.onclick=e=>{
      const act=e.target.closest('[data-act]')?.dataset.act;
      if(e.target.closest('a')||e.target.closest('select')||e.target.closest('input')) return;
      if(act==='del') removeTarget(id);
      else if(act==='gpx') exportOne(r);
      else if(act==='komoot'||act==='garmin') sendTo(act,r);
      else if(act==='zoom') select(id,{zoom:true});
      else if(act==='retry') computeRoute(r);
      else select(id);
    };
  });
}
const COLS=[
  ['num','#',m=>m.num,null],
  ['name','Ziel',m=>`<span class="sw" style="background:${m.color}"></span>${esc(m.name)}`,null],
  ['length','Route',m=>m.length!=null?km(m.length)+' km':'–','min'],
  ['beeline','Luftlinie',m=>km(m.beeline)+' km',null],
  ['detour','Umwegfaktor',m=>m.detour!=null?nf2.format(m.detour):'–','min'],
  ['pctRadius','% Radius',m=>m.pctRadius!=null?nf0.format(m.pctRadius)+' %':'–',null],
  ['ascent','Anstieg',m=>m.ascent!=null?nf0.format(m.ascent)+' m':'–','min'],
  ['descent','Abstieg',m=>m.descent!=null?nf0.format(m.descent)+' m':'–',null],
  ['hmPer100','hm / 100 km',m=>m.hmPer100!=null?nf0.format(m.hmPer100):'–','min'],
  ['maxEle','max. Höhe',m=>m.maxEle!=null?nf0.format(m.maxEle)+' m':'–',null],
  ['head','Ø Wind (+ gegen)',m=>m.head!=null?`<span style="color:${m.head>=0.5?'var(--head)':m.head<=-0.5?'var(--tail)':'inherit'}">${m.head>0?'+':''}${nf1.format(m.head)} km/h</span>`:'–','min'],
  ['gust','max. Böe',m=>m.gust!=null?nf0.format(m.gust)+' km/h':'–','min'],
  ['rain','Regen',m=>m.rain!=null?nf1.format(m.rain)+' mm':'–','min'],
  ['dur','Dauer bei Ø',m=>m.dur!=null?fmtH(m.dur):'–','min'],
  ['vReq','nötiges Ø',m=>m.vReq!=null?`<span style="color:${m.vReq>speedKmh()?'var(--err)':'inherit'}">${nf1.format(m.vReq)} km/h</span>`:'–','min'],
  ['arrival','Ankunft',m=>fmtDT(m.arrival),'min'],
];
export function renderTable(){
  const pane=$('paneTable');
  if(!state.start||!state.routes.length){ pane.innerHTML='<div class="empty">Setze mindestens ein Ziel, um Routen zu vergleichen.</div>'; return; }
  const ms=state.routes.map(r=>({...metrics(r),id:r.id}));
  const best={}; COLS.forEach(([k,,,mode])=>{ if(!mode) return; const v=ms.filter(m=>m[k]!=null).map(m=>m[k]); if(v.length>1) best[k]=Math.min(...v); });
  const {key,dir}=state.sort;
  ms.sort((a,b)=>{const x=a[key],y=b[key]; if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (typeof x==='string'?x.localeCompare(y,'de'):x-y)*dir;});
  pane.innerHTML=`<table><thead><tr>${COLS.map(([k,t])=>`<th data-k="${k}">${t}${k===key?(dir>0?' ▲':' ▼'):''}</th>`).join('')}<th></th></tr></thead><tbody>
    ${ms.map(m=>`<tr data-id="${m.id}" class="${m.id===state.selectedId?'sel':''}">${COLS.map(([k,,f])=>`<td class="${best[k]!=null&&m[k]===best[k]?'best':''}">${f(m)}</td>`).join('')}
    <td><button class="small" data-gpx="${m.id}" ${m.ok?'':'disabled'}>GPX</button>
      <button class="small svc komoot" data-svc="komoot" data-rid="${m.id}" ${m.ok?'':'disabled'}>Komoot</button>
      <button class="small svc garmin" data-svc="garmin" data-rid="${m.id}" ${m.ok?'':'disabled'}>Garmin</button></td></tr>`).join('')}
  </tbody></table><div class="hint">Grün = bester Wert der Spalte. Umwegfaktor = Routenlänge ÷ Luftlinie. Ø Wind: positiv = Gegenwind, negativ = Rückenwind (Start ${fmtDT(startUnix())}, ${nf1.format(speedKmh())} km/h). Spaltenkopf anklicken zum Sortieren.</div>`;
  pane.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{const k=th.dataset.k; state.sort={key:k,dir:state.sort.key===k?-state.sort.dir:1}; renderTable();});
  pane.querySelectorAll('tbody tr').forEach(tr=>tr.onclick=e=>{ const g=e.target.dataset.gpx; if(g){exportOne(state.routes.find(r=>r.id===g)); return;}
    const sv=e.target.dataset.svc; if(sv){ sendTo(sv,state.routes.find(r=>r.id===e.target.dataset.rid)); return; } select(tr.dataset.id,{zoom:true}); });
}
