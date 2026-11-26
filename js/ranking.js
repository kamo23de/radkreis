// Radrouten-Radar – Modul „ranking“
import { haversine, parseTags, surfaceClass, trafficLevel } from './core.js';
import { state } from './state.js';
import { $, esc, fmtDT, km, nf0, nf1 } from './util.js';
import { fmtH, startUnix, timePlan } from './weather.js';
import { label, select } from './targets.js';
import { renderAll } from './render.js';
import { save } from './storage.js';
import { bikeType, fmtV, paceModel, paceShort, vReqTitle } from './pace.js';

/* ================================================================ Routenoptimierung
   Endpunkte (max. 10) auf dem Umkreis setzen, Routen nach gewichteten Kriterien bewerten und ranken.
   Datengrundlage: BRouter-Wegeattribute (highway, surface, smoothness, tracktype, maxspeed, cycleway,
   route_bicycle_*), Höhenprofil und die Wetterauswertung entlang der Route. */
const CRITERIA=[
  {key:'profile',   icon:'⛰',  name:'Streckenprofil & Untergrund',
   desc:'Wenig Höhenmeter und Steilstücke, Belag passend zum gewählten Radprofil (Rennrad: Asphalt, Gravel/MTB: Schotter in Ordnung).'},
  {key:'weather',   icon:'🌦', name:'Wetter',
   desc:'Rücken- statt Gegenwind, wenig Regen, keine Sturmböen, angenehme Temperatur – bezogen auf die eingestellte Startzeit.'},
  {key:'beauty',    icon:'🌳', name:'Schönheit & Verkehrsarmut',
   desc:'Hoher Anteil autofreier Wege und ruhiger Nebenstraßen, wenig Bundes-/Landesstraßen, Bonus für ausgeschilderte Radrouten.'},
  {key:'efficiency',icon:'⏱', name:'Effizienz (Zusatzkriterium)',
   desc:'Geringer Umweg gegenüber der Luftlinie – sinnvoll, wenn der Radius möglichst direkt erreicht werden soll.'}
];
const PRESETS={
  profile:   {profile:60,weather:20,beauty:20,efficiency:0},
  weather:   {profile:20,weather:60,beauty:20,efficiency:0},
  beauty:    {profile:20,weather:20,beauty:60,efficiency:0},
  efficiency:{profile:20,weather:20,beauty:20,efficiency:40}
};
state.optWeights={...PRESETS.beauty};
state.ranking=null;      // [{id,rank,score}]

export function wayStats(r,legs){
  const surf={paved:0,rough:0,good:0,unpaved:0,unknown:0}, traf=[0,0,0,0]; let total=0, cycle=0;
  legs.forEach(L=>{
    const m=L.props&&L.props.messages; if(!Array.isArray(m)||m.length<2) return;
    const iD=m[0].indexOf('Distance'), iT=m[0].indexOf('WayTags'); if(iD<0||iT<0) return;
    for(let i=1;i<m.length;i++){
      const d=+m[i][iD]||0; if(d<=0) continue;
      const t=parseTags(m[i][iT]);
      total+=d; surf[surfaceClass(t)]+=d; traf[trafficLevel(t)]+=d;
      if(Object.keys(t).some(k=>k.startsWith('route_bicycle_'))) cycle+=d;
    }
  });
  // Steigungen über gleitende 200-m-Fenster
  const c=r.coords, cum=r.cum; let j=0, maxGrad=0, steep=0;
  for(let i=1;i<c.length;i++){
    while(j+1<i && cum[i]-cum[j+1]>=200) j++;
    const di=cum[i]-cum[j]; if(di<200||c[i][2]==null||c[j][2]==null) continue;
    const g=(c[i][2]-c[j][2])/di;
    if(g>maxGrad) maxGrad=g;
    if(g>0.08) steep+=cum[i]-cum[i-1];
  }
  if(!total) return {total:0, maxGrad, steepShare:r.lengthM?steep/r.lengthM:0};
  const sh=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v/total]));
  return {total, surf:sh(surf), traf:traf.map(v=>v/total), cycle:cycle/total, maxGrad, steepShare:r.lengthM?steep/r.lengthM:0};
}
const SURF_W={
  road:   {paved:1, rough:.4, good:.35, unpaved:.05, unknown:.75},
  mixed:  {paved:1, rough:.6, good:.8,  unpaved:.4,  unknown:.8},
  offroad:{paved:.85,rough:.6, good:1,   unpaved:.85, unknown:.8}
};
const pct=v=>v==null?'–':nf0.format(v*100)+' %';
export function timeRowHtml(r){
  const pl=timePlan(r); if(!pl) return '';
  const inp=`<label style="display:inline-flex;align-items:center;gap:4px;margin:0;color:var(--text)" title="Standzeit in % der Gesamtdauer (z. B. 20 = 20 % der Zeit stehen)">⏸ Pausen
    <button class="small pstep" data-pstep="-5" data-rid="${r.id}" aria-label="Pausen verringern">−</button><input type="number" class="pauseInp" data-pause="${r.id}" min="0" max="90" step="5" value="${r.pausePct||0}" style="width:56px;padding:3px 6px;min-height:0;font-size:12.5px;text-align:center"><button class="small pstep" data-pstep="5" data-rid="${r.id}" aria-label="Pausen erhöhen">+</button> %</label>`;
  const nightTxt=h=>h>0.01?` + Nachtruhe ${fmtH(h)}`:'';
  let info;
  const phys=paceModel()==='phys';
  const how=phys?`Tempo-Modell mit ${nf1.format(pl.v)} km/h in der Ebene${pl.windy?' und Wind zur Startzeit':' (ohne Wind – Wetter noch nicht geladen)'}`:`bei deinem Ø-Tempo von ${nf1.format(pl.v)} km/h`;
  const durTxt=`<span title="${how}">⏱ Fahrzeit ${fmtH(pl.moveAtSpeed)}${phys?` (Ø ${nf1.format(pl.vAvg)} km/h)`:''} + Pausen ${fmtH(pl.pauseAtSpeed)}${nightTxt(pl.nightAtSpeed)} ≈ <b>${fmtH(pl.durAtSpeed)}</b></span>`;
  if(pl.T){
    info=`<span title="${phys?'Mindestens nötiges Tempo in der Ebene (das Modell rechnet daraus Steigung, Wind und Untergrund hoch)':'Mindestens nötiges Durchschnittstempo während der Fahrt'}, damit ${km(r.lengthM)} km in ${fmtH(pl.T)} inkl. ${nf0.format(pl.p*100)} % Pausen${pl.hpd<24?` und max. ${nf1.format(pl.hpd)} Fahrstunden pro Tag`:''} geschafft werden">
        🎯 ${vReqTitle()} <b>${fmtV(pl.vReq)}</b></span>${durTxt}
      ${pl.ok?`<span class="badge" style="background:#e6f4ea;color:var(--ok)" title="Mit deinem Tempo bleiben von ${fmtH(pl.T)} noch ${fmtH(pl.buffer)} übrig">✓ machbar, ${fmtH(pl.buffer)} Puffer</span>`
             :`<span class="badge warn" title="Mit deinem Tempo (${how}) dauert die Tour ${fmtH(-pl.buffer)} länger als ${fmtH(pl.T)}">⚠ zu knapp: ${fmtH(-pl.buffer)} über ${fmtH(pl.T)}</span>`}`;
  } else {
    info=`${durTxt}<span style="color:var(--muted)">(max. Dauer nicht gesetzt)</span>`;
  }
  return `<div class="waysrow" style="align-items:center">${inp}${info}</div>`;
}
export function retRowHtml(r){
  if(!r.retLen) return '';
  const ov=r.overlap!=null?nf0.format(r.overlap*100):'–';
  const txt=r.retModeUsed==='same'?'Rückweg auf gleicher Strecke':`Rückweg ${r.overlap<0.15?'fast vollständig auf anderer Strecke':r.overlap<0.6?'teilweise auf anderer Strecke':'überwiegend auf dem Hinweg'} (${ov} % Überschneidung)`;
  return `<div class="waysrow">↩ ${txt}, Länge ${km(r.retLen)} km${r.retLen&&r.outLen?` (${r.retLen>=r.outLen?'+':''}${nf1.format((r.retLen-r.outLen)/1000)} km ggü. Hinweg)`:''}${r.retError?` · <span style="color:var(--warn)">${esc(r.retError)}</span>`:''}</div>`;
}
export function wayRowHtml(r){
  const w=r.way; if(!w||!w.total) return '';
  const quiet=w.traf[0]+w.traf[1];
  return `<div class="waysrow">
    <span title="Asphalt, Beton, Pflastersteine (glatt)">🛣 ${pct(w.surf.paved)} befestigt</span>
    <span title="Schotter, Erde, Wiese, verdichtete Wege">🪨 ${pct(w.surf.good+w.surf.unpaved)} unbefestigt</span>
    <span title="Autofreie Wege + ruhige Nebenstraßen">🌳 ${pct(quiet)} verkehrsarm</span>
    <span title="Bundes-, Landes- und Kreisstraßen ohne eigenen Radweg">🚗 ${pct(w.traf[3])} Hauptstraße</span>
    <span title="Steilste 200 m">⛰ max. ${nf0.format(w.maxGrad*100)} %</span>
  </div>`;
}

/* ---- Bewertung (0–100 je Kriterium, gewichtet zusammengeführt) */
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
function scoreRoute(r){
  const w=r.way&&r.way.total?r.way:null, o={};
  const hm100=r.lengthM?r.ascent/(r.lengthM/100e3):0;
  let climbS=100*Math.exp(-hm100/900);
  if(r.way){ climbS-=r.way.steepShare*300; if(r.way.maxGrad>0.12) climbS-=10; }
  climbS=clamp(climbS);
  const W=SURF_W[bikeType()];
  const surfS=w?clamp(100*Object.entries(w.surf).reduce((a,[k,v])=>a+W[k]*v,0)):null;
  o.profile=surfS==null?climbS:0.5*climbS+0.5*surfS; o.climb=climbS; o.surface=surfS;
  if(r.wx&&r.wx.avgHead!=null){
    const head=clamp(50-2.5*r.wx.avgHead), rain=100*Math.exp(-(r.wx.rainMm||0)/2.5);
    let comf=100;
    if(r.wx.maxGust>45) comf-=(r.wx.maxGust-45)*2;
    if(r.wx.tMin!=null&&r.wx.tMin<5) comf-=(5-r.wx.tMin)*5;
    if(r.wx.tMax!=null&&r.wx.tMax>28) comf-=(r.wx.tMax-28)*5;
    o.weather=0.5*head+0.35*rain+0.15*clamp(comf);
  } else o.weather=null;
  o.beauty=w?clamp(88*(w.traf[0]+0.85*w.traf[1]+0.45*w.traf[2]+0.05*w.traf[3])+12*w.cycle):null;
  o.efficiency=clamp(100-((r.outLen||r.lengthM)/Math.max(1,haversine(state.start,r.latlng))-1)*150);
  // Rückweg: Wiederholung derselben Strecke ist weniger abwechslungsreich
  if(o.beauty!=null&&r.retLen&&r.overlap!=null) o.beauty=clamp(o.beauty-10*r.overlap);
  let sw=0,sum=0;
  CRITERIA.forEach(c=>{ const wt=+state.optWeights[c.key]||0; if(wt>0&&o[c.key]!=null){ sw+=wt; sum+=wt*o[c.key]; } });
  o.total=sw?sum/sw:null;
  o.missing=CRITERIA.filter(c=>(+state.optWeights[c.key]||0)>0&&o[c.key]==null).map(c=>c.name);
  return o;
}
export function computeRanking(){
  const rs=state.routes.filter(r=>r.status==='ok');
  const scored=rs.map(r=>({id:r.id,r,score:scoreRoute(r)})).filter(x=>x.score.total!=null)
    .sort((a,b)=>b.score.total-a.score.total);
  scored.forEach((x,i)=>x.rank=i+1);
  return scored;
}
export function rankOf(r){ if(!state.ranking||state.ranking.length<2) return null; const x=state.ranking.find(e=>e.id===r.id); return x?x.rank:null; }
function scoreColor(v){ return v>=70?'#2e9d4f':v>=50?'#8bbf3c':v>=35?'#f0a020':'#d9534f'; }
const sbar=v=>v==null?'<span style="color:var(--muted)">–</span>':`<div class="sbar"><i style="width:${clamp(v)}%;background:${scoreColor(v)}"></i><span>${nf0.format(v)}</span></div>`;

/* ---- Gewichtung: Summe aller Gewichte höchstens 100 % */
const wSum=()=>CRITERIA.reduce((a,c)=>a+(+state.optWeights[c.key]||0),0);
function setWeight(key,val){ // erhöht ein Gewicht; die übrigen werden bei Bedarf anteilig gekürzt
  const W=state.optWeights; W[key]=clamp(Math.round(val/5)*5);
  const others=CRITERIA.map(c=>c.key).filter(k=>k!==key), rest=100-W[key];
  const sumO=others.reduce((a,k)=>a+(+W[k]||0),0);
  if(sumO>rest){
    others.forEach(k=>{ W[k]=sumO?Math.floor((+W[k]||0)*rest/sumO/5)*5:0; });
    let left=rest-others.reduce((a,k)=>a+W[k],0);           // Rundungsrest dem größten übrigen Gewicht geben
    const big=others.slice().sort((a,b)=>W[b]-W[a])[0];
    if(left>0&&W[big]>0) W[big]+=left;
  }
}
export function normalizeWeights(){ const S=wSum(); if(S>100) CRITERIA.forEach(c=>{ state.optWeights[c.key]=Math.floor((+state.optWeights[c.key]||0)*100/S/5)*5; }); }
const mainCrit=()=>CRITERIA.reduce((a,c)=>(+state.optWeights[c.key]||0)>(+state.optWeights[a.key]||0)?c:a).key;

export function renderRanking(){
  const pane=$('rankPane'); if(!pane) return;
  const rs=state.routes.filter(r=>r.status==='ok');
  const R=state.ranking;
  const weights=`<div class="weights"><b>Gewichtung</b>
    <label>Schwerpunkt <select id="rkPreset">${CRITERIA.map(c=>`<option value="${c.key}" ${c.key===mainCrit()?'selected':''}>${c.icon} ${c.name.replace(' (Zusatzkriterium)','')}</option>`).join('')}</select></label>
    ${CRITERIA.map(c=>`<label title="${c.desc}">${c.icon} ${c.name.replace(' (Zusatzkriterium)','').replace(' & ',' &amp; ')} <input type="range" min="0" max="100" step="5" value="${state.optWeights[c.key]}" data-rw="${c.key}" aria-label="Gewicht ${c.name}"> <span data-wv="${c.key}">${state.optWeights[c.key]} %</span></label>`).join('')}
    <span class="wsum" id="rkSum">Σ ${wSum()} %</span></div>`;
  if(!rs.length){ pane.innerHTML=weights+'<div class="empty">Noch keine Routen. Setze Ziele auf der Karte – sie werden automatisch verglichen.</div>'; wireRankPane(); return; }
  if(!R||!R.length){ pane.innerHTML=weights+'<div class="empty">Bitte mindestens ein Kriterium gewichten.</div>'; wireRankPane(); return; }
  const act=CRITERIA.filter(c=>+state.optWeights[c.key]>0);
  pane.innerHTML=weights+`<table><thead><tr><th>Rang</th><th>Ziel</th><th>Gesamt</th>${act.map(c=>`<th title="${c.desc}">${c.icon} ${c.name.split(' ')[0]}</th>`).join('')}
    <th>Länge</th><th>${vReqTitle()}</th><th>hm</th><th>befestigt</th><th>verkehrsarm</th><th>Hauptstr.</th><th>max. Steig.</th><th>Ø Wind</th><th>Regen</th></tr></thead><tbody>
    ${R.map(x=>{ const r=x.r,w=r.way&&r.way.total?r.way:null; return `<tr data-id="${r.id}" class="${r.id===state.selectedId?'sel':''}" style="cursor:pointer">
      <td><span class="rank r${x.rank}">${x.rank}</span></td><td><span class="sw" style="background:${r.color}"></span>${r.num} · ${esc(label(r))}</td>
      <td>${sbar(x.score.total)}</td>${act.map(c=>`<td>${sbar(x.score[c.key])}</td>`).join('')}
      <td>${km(r.lengthM)} km</td><td>${(pl=>pl&&pl.T?`<span style="color:${pl.ok?'inherit':'var(--err)'}" title="${pl.ok?'machbar':'mit deinem Tempo zu knapp'}">${fmtV(pl.vReq)}${pl.ok?'':' ⚠'}</span>`:'–')(timePlan(r))}</td><td>${nf0.format(r.ascent)}</td><td>${w?pct(w.surf.paved):'–'}</td><td>${w?pct(w.traf[0]+w.traf[1]):'–'}</td><td>${w?pct(w.traf[3]):'–'}</td>
      <td>${r.way?nf0.format(r.way.maxGrad*100)+' %':'–'}</td>
      <td>${r.wx&&r.wx.avgHead!=null?`<span style="color:${r.wx.avgHead>=0.5?'var(--head)':r.wx.avgHead<=-0.5?'var(--tail)':'inherit'}">${r.wx.avgHead>0?'+':''}${nf1.format(r.wx.avgHead)}</span>`:'–'}</td>
      <td>${r.wx&&r.wx.rainMm!=null?nf1.format(r.wx.rainMm)+' mm':'–'}</td></tr>`; }).join('')}
  </tbody></table><div class="hint">Scores 0–100 (höher = besser). Profil berücksichtigt Radtyp „${bikeType()==='road'?'Rennrad':bikeType()==='offroad'?'Gravel/MTB':'Trekking'}“ (aus dem Routing-Profil). Wetter bezogen auf Start ${fmtDT(startUnix())} (${esc(paceShort())}). Die Rangliste aktualisiert sich automatisch bei neuen Zielen und bei Änderung von Gewichten, Startzeit oder Tempo. Die Gewichte ergeben zusammen höchstens 100 %.</div>`;
  wireRankPane();
}
function wireRankPane(){
  const pane=$('rankPane');
  const sync=()=>{ // Regler und Anzeigen nach Kopplung aktualisieren, ohne neu zu zeichnen (Ziehen bleibt flüssig)
    pane.querySelectorAll('input[data-rw]').forEach(x=>{ x.value=state.optWeights[x.dataset.rw]; });
    pane.querySelectorAll('[data-wv]').forEach(x=>{ x.textContent=state.optWeights[x.dataset.wv]+' %'; });
    $('rkSum').textContent='Σ '+wSum()+' %';
  };
  pane.querySelectorAll('input[data-rw]').forEach(sl=>{
    sl.oninput=()=>{ setWeight(sl.dataset.rw,+sl.value); sync(); };
    sl.onchange=()=>{ setWeight(sl.dataset.rw,+sl.value); save(); renderAll(); };
  });
  const pr=$('rkPreset'); if(pr) pr.onchange=()=>{ Object.assign(state.optWeights,PRESETS[pr.value]); save(); renderAll(); };
  pane.querySelectorAll('tbody tr').forEach(tr=>tr.onclick=()=>select(tr.dataset.id,{zoom:true}));
}
