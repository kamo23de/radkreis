// Radrouten-Radar – Modul „weather“
import { bearing, deg, elapsedHours, idxAt, movingHoursWithin, parseDurationH, rad, shiftYears } from './core.js';
import { CLIM_YEARS, OM_ARCHIVE, OM_FORECAST, OM_VARS_AR, OM_VARS_FC, RAIN_WEIGHT } from './config.js';
import { state } from './state.js';
import { $ } from './util.js';
import { renderWxStatus } from './charts.js';
import { renderAll } from './render.js';
import { save } from './storage.js';

/* ================================================================ Wetter (Open-Meteo) */
const fcCache=new Map();     // key -> Vorhersage-Zeitreihe
const climCache=new Map();   // key|jahr -> ERA5-Zeitreihe
export let wxToken=0, wxTimer=null, wxInfo={state:'idle'};

const gridKey=(lat,lng)=>`${(Math.round(lat*10)/10).toFixed(1)},${(Math.round(lng*10)/10).toFixed(1)}`;
export const speedKmh=()=>Math.min(60,Math.max(5,parseFloat($('speed').value)||25));
export const hoursPerDay=()=>Math.min(24,Math.max(1,parseFloat($('hpd').value)||24));
export const wxMode=()=>$('wxMode').value;
export function toLocalInput(d){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
export function startUnix(){ const v=$('startTime').value; const t=v?new Date(v).getTime():NaN; return isFinite(t)?t/1000:Math.ceil(Date.now()/3.6e6)*3600; }
export function setStartUnix(u){ $('startTime').value=toLocalInput(new Date(u*1000)); save(); scheduleWeather(150); }
export const nextFullHour=()=>Math.ceil(Date.now()/3.6e6)*3600;
function isoDate(u){ return new Date(u*1000).toISOString().slice(0,10); }
export function climYears(){ const Y=new Date().getUTCFullYear(); return Array.from({length:CLIM_YEARS},(_,i)=>Y-1-i); }
// Alle Zeitpunkte einer Tour um denselben Jahresabstand verschieben (bezogen auf das Jahr der Startzeit),
// damit eine Tour über den Jahreswechsel zusammenhängend bleibt.
const climBaseYear=()=>new Date(startUnix()*1000).getUTCFullYear();
const climShift=(t,y,base=climBaseYear())=>shiftYears(t,base-y);

function ptAt(r,d){ const i=idxAt(r.cum,Math.max(0,Math.min(r.lengthM,d))); const p=r.coords[i]; return {lat:p[1],lng:p[0]}; }
function buildTourSamples(r){ // je Richtung eigene Stützpunkte, damit die Fahrtrichtung am Wendepunkt stimmt
  const W=1500;
  const mk=(d0,d1,n)=>{ const a=[]; for(let k=0;k<=n;k++){ const d=d0+(d1-d0)*k/n, p=ptAt(r,d);
    a.push({d, lat:p.lat, lng:p.lng, heading:headingBetween(r,Math.max(d0,d-W),Math.min(d1,d+W)), key:gridKey(p.lat,p.lng)}); } return a; };
  const nO=Math.max(1,Math.round(r.outLen/Math.max(5000,r.lengthM/40))), nR=Math.max(1,Math.round(r.retLen/Math.max(5000,r.lengthM/40)));
  const A=mk(0,r.outLen,nO), B=mk(r.outLen,r.lengthM,nR);
  B[0].d=r.outLen+1;           // Rückweg-Start minimal hinter dem Wendepunkt (Pause greift)
  r.samples=A.concat(B);
}
function headingBetween(r,dA,dB){ // Richtung zwischen zwei Distanzen, ohne den Wendepunkt zu überschreiten
  const n=r.coords.length; let i0=Math.min(n-1,idxAt(r.cum,dA)), i1=Math.min(n-1,idxAt(r.cum,dB));
  if(i1<=i0) i1=Math.min(n-1,i0+1); if(i1<=i0) i0=Math.max(0,i1-1);
  const a=r.coords[i0], b=r.coords[i1]; return bearing({lat:a[1],lng:a[0]},{lat:b[1],lng:b[0]});
}
function headingAt(r,d,W=1500){ // Fahrtrichtung aus zwei sicher verschiedenen Punkten rund um d
  const n=r.coords.length; let i0=Math.max(0,idxAt(r.cum,d-W)-1), i1=Math.min(n-1,idxAt(r.cum,d+W));
  if(i1<=i0){ if(i1<n-1) i1=i0+1; else i0=Math.max(0,i1-1); }
  const a=r.coords[i0], b=r.coords[i1];
  return bearing({lat:a[1],lng:a[0]},{lat:b[1],lng:b[0]});
}
export function buildSamples(r){ // Stützpunkte entlang der Route (≤ ~40, mind. alle 5 km)
  if(r.retLen) return buildTourSamples(r);
  const L=r.lengthM, n=Math.max(1,Math.round(L/Math.max(5000,L/40)));
  r.samples=[];
  for(let k=0;k<=n;k++){
    const d=L*k/n, p=ptAt(r,d);
    r.samples.push({d, lat:p.lat, lng:p.lng, heading:headingAt(r,d), key:gridKey(p.lat,p.lng)});
  }
}
function parseOM(d){
  const h=d.hourly||{};
  return {t0:h.time?h.time[0]:0, n:h.time?h.time.length:0, ws:h.wind_speed_10m||[], wd:h.wind_direction_10m||[], g:h.wind_gusts_10m||[],
    p:h.precipitation||[], pp:h.precipitation_probability||[], tmp:h.temperature_2m||[], fetched:Date.now()};
}
async function omFetch(base,keys,vars,extra){
  const out=[];
  for(let i=0;i<keys.length;i+=50){
    const ch=keys.slice(i,i+50);
    const lat=ch.map(k=>k.split(',')[0]).join(','), lng=ch.map(k=>k.split(',')[1]).join(',');
    const url=`${base}?latitude=${lat}&longitude=${lng}&hourly=${vars}&timezone=GMT&timeformat=unixtime&wind_speed_unit=kmh&${extra}`;
    const r=await fetch(url); const j=await r.json().catch(()=>({error:true,reason:'Ungültige Antwort'}));
    if(!r.ok||j.error) throw new Error('Open-Meteo: '+(j.reason||('HTTP '+r.status)));
    (Array.isArray(j)?j:[j]).forEach((d,k)=>out.push([ch[k],d]));
  }
  return out;
}
async function ensureForecast(keys){
  const missing=keys.filter(k=>{const c=fcCache.get(k); return !c||Date.now()-c.fetched>3600e3;});
  if(!missing.length) return;
  (await omFetch(OM_FORECAST,missing,OM_VARS_FC,'forecast_days=16&past_days=1')).forEach(([k,d])=>fcCache.set(k,parseOM(d)));
}
async function ensureClimate(samples){
  const limitU=Date.now()/1000-6*86400;   // ERA5 liegt einige Tage zurück
  const base=climBaseYear();
  await Promise.all(climYears().map(async y=>{
    const need=new Map();
    for(const s of samples){ const ty=climShift(s.t,y,base); const m=need.get(s.key); need.set(s.key,m?[Math.min(m[0],ty),Math.max(m[1],ty)]:[ty,ty]); }
    const missing=[]; let lo=Infinity,hi=-Infinity;
    need.forEach(([mn,mx],k)=>{
      const c=climCache.get(k+'|'+y);
      if(c&&c.n&&mn>=c.t0&&mx<=c.t0+(c.n-1)*3600) return;
      missing.push(k); lo=Math.min(lo,mn); hi=Math.max(hi,mx);
    });
    if(!missing.length||lo>limitU) return;
    const res=await omFetch(OM_ARCHIVE,missing,OM_VARS_AR,`start_date=${isoDate(lo-86400)}&end_date=${isoDate(Math.min(hi+86400,limitU))}`);
    res.forEach(([k,d])=>climCache.set(k+'|'+y,parseOM(d)));
  }));
}
function fcAt(key,t,heading){
  const f=fcCache.get(key); if(!f) return null;
  const i=Math.round((t-f.t0)/3600);
  if(i<0||i>=f.n||f.ws[i]==null||f.wd[i]==null) return null;
  return {ws:f.ws[i], wd:f.wd[i], g:f.g[i]??f.ws[i], p:f.p[i]??0, pp:f.pp[i]??null, tmp:f.tmp[i], hw:f.ws[i]*Math.cos(rad(f.wd[i]-heading)), src:'fc'};
}
function climAt(key,t,heading){ // Mittel über die letzten Jahre zur gleichen Kalenderzeit
  let n=0,u=0,v=0,ws=0,g=0,p=0,wet=0,tmp=0,hw=0; const base=climBaseYear();
  for(const y of climYears()){
    const c=climCache.get(key+'|'+y); if(!c) continue;
    const i=Math.round((climShift(t,y,base)-c.t0)/3600);
    if(i<0||i>=c.n||c.ws[i]==null||c.wd[i]==null) continue;
    n++; ws+=c.ws[i]; u+=c.ws[i]*Math.sin(rad(c.wd[i])); v+=c.ws[i]*Math.cos(rad(c.wd[i]));
    hw+=c.ws[i]*Math.cos(rad(c.wd[i]-heading)); g+=c.g[i]??c.ws[i]; p+=c.p[i]||0; if((c.p[i]||0)>=0.1) wet++; tmp+=c.tmp[i]??0;
  }
  if(!n) return null;
  return {ws:ws/n, wd:(deg(Math.atan2(u,v))+360)%360, g:g/n, p:p/n, pp:wet/n*100, tmp:tmp/n, hw:hw/n, src:'clim', years:n};
}
function wxAt(key,t,heading){ return (wxMode()!=='clim'&&fcAt(key,t,heading)) || climAt(key,t,heading); }
/* ---- Zeitplan: max. Dauer, Pausenanteil je Route, benötigtes Tempo
   Pausenanteil p = Standzeit / Zeit unterwegs (ohne Nachtruhe) → reine Fahrzeit = Zeit unterwegs · (1 − p).
   Rechenmodell siehe core.js (elapsedHours / movingHoursWithin). */
export const maxDurationH=()=>parseDurationH($('maxDur').value);
const pauseFrac=r=>Math.min(0.9,Math.max(0,(+r.pausePct||0)/100));
export function timePlan(r){ // Kennzahlen für die ganze Tour (mit Rückweg: Hin + Rück)
  if(r.status!=='ok'||!r.lengthM) return null;
  const Lkm=r.lengthM/1000, p=pauseFrac(r), T=maxDurationH(), v=speedKmh(), hpd=hoursPerDay();
  const moveAtSpeed=Lkm/v, durAtSpeed=elapsedHours(Lkm,{v,hpd,p});     // Dauer bei eingestelltem Ø-Tempo inkl. Pausen und Nachtruhe
  const pauseAtSpeed=moveAtSpeed*p/(1-p), nightAtSpeed=Math.max(0,durAtSpeed-moveAtSpeed-pauseAtSpeed);
  const plan={p, T, Lkm, v, hpd, durAtSpeed, moveAtSpeed, pauseAtSpeed, nightAtSpeed};
  if(T){
    plan.vReq=Lkm/movingHoursWithin(T,{hpd,p});                         // mindestens nötiges Ø-Tempo in Bewegung
    plan.ok=plan.vReq<=v+1e-9;
    plan.buffer=T-durAtSpeed;                                            // Zeitreserve mit eigenem Tempo (negativ = zu knapp)
  }
  return plan;
}
function tourElapsedH(r,d){ // Zeit (h) vom Start bis Distanz d (m) mit eigenem Ø-Tempo, inkl. anteiliger Pausen und Nachtruhe
  // (Die max. Dauer ändert die Zeitpunkte nicht – sie liefert nur das nötige Ø-Tempo und die Machbarkeit.)
  return elapsedHours(d/1000,{v:speedKmh(),hpd:hoursPerDay(),p:pauseFrac(r)});
}
export const fmtH=h=>{ if(h==null||!isFinite(h)) return '–'; const t=Math.round(h*60); return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')} h`; };
function assignTimes(r,t0=startUnix()){ r.samples.forEach(s=>{ s.t=t0+tourElapsedH(r,s.d)*3600; }); }
function summarize(S,spMove){
  let wsum=0,hw=0,rain=0,wetKm=0,gmax=null,tmin=null,tmax=null,cov=0,clim=0;
  const sp=spMove||speedKmh();
  for(const s of S){ const w=s.wx; if(!w) continue; cov++; if(w.src==='clim') clim++;
    gmax=Math.max(gmax??-Infinity,w.g); if(w.tmp!=null){ tmin=Math.min(tmin??Infinity,w.tmp); tmax=Math.max(tmax??-Infinity,w.tmp); } }
  for(let i=0;i<S.length-1;i++){
    const a=S[i].wx,b=S[i+1].wx; if(!a||!b) continue;
    const segKm=(S[i+1].d-S[i].d)/1000, p=(a.p+b.p)/2;
    wsum+=segKm; hw+=(a.hw+b.hw)/2*segKm; rain+=p*segKm/sp; if(p>=0.2) wetKm+=segKm;
  }
  if(S.length===1&&S[0].wx){ wsum=1; hw=S[0].wx.hw; }
  return {avgHead:wsum?hw/wsum:null, rainMm:wsum?rain:null, wetPct:wsum?wetKm/wsum*100:null, maxGust:gmax, tMin:tmin, tMax:tmax,
    coverage:S.length?cov/S.length:0, climShare:cov?clim/cov:0, arrival:S.length?S[S.length-1].t:null};
}
function applyWeather(r){
  if(!r.samples) return;
  assignTimes(r);
  r.samples.forEach(s=>{ s.wx=wxAt(s.key,s.t,s.heading); });
  r.wx=summarize(r.samples,speedKmh());
}
export function scheduleWeather(delay=400){ clearTimeout(wxTimer); wxTimer=setTimeout(updateWeather,delay); }
async function updateWeather(){
  const tok=++wxToken;
  const routes=state.routes.filter(r=>r.status==='ok'&&r.samples);
  if(!routes.length){ wxInfo={state:'idle'}; renderAll(); return; }
  wxInfo={state:'loading'}; renderWxStatus();
  try{
    routes.forEach(r=>assignTimes(r));
    if(wxMode()!=='clim') await ensureForecast([...new Set(routes.flatMap(r=>r.samples.map(s=>s.key)))]);
    const need=routes.flatMap(r=>r.samples.filter(s=>wxMode()==='clim'||!fcAt(s.key,s.t,s.heading)));
    if(need.length) await ensureClimate(need);
    if(tok!==wxToken) return;
    routes.forEach(applyWeather);
    wxInfo={state:'ok', at:Date.now(), clim:need.length>0};
  }catch(e){
    if(tok!==wxToken) return;
    routes.forEach(applyWeather);
    wxInfo={state:'error', msg:/Failed to fetch|NetworkError|Load failed/i.test(e.message)?'Open-Meteo nicht erreichbar.':e.message};
  }
  renderAll();
}
export function bestStartSeries(r){ // Score je möglicher Startstunde innerhalb des Vorhersagehorizonts
  if(!r||!r.samples||wxMode()==='clim') return null;
  const fs=r.samples.map(s=>fcCache.get(s.key)); if(fs.some(f=>!f||!f.n)) return null;
  const fEnd=Math.min(...fs.map(f=>f.t0+(f.n-1)*3600));
  const offs=r.samples.map(s=>tourElapsedH(r,s.d)*3600), dur=offs[offs.length-1];
  const out=[];
  for(let t=nextFullHour(); t+dur<=fEnd; t+=3600){
    const S=r.samples.map((s,i)=>({d:s.d, t:t+offs[i], wx:fcAt(s.key,t+offs[i],s.heading)}));
    if(S.some(s=>!s.wx)) continue;
    const sm=summarize(S,speedKmh());
    out.push({t, head:sm.avgHead, rain:sm.rainMm, score:sm.avgHead+RAIN_WEIGHT*sm.rainMm});
  }
  return out;
}
