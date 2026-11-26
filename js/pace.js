// Radrouten-Radar – Modul „pace“: Tempo-Modell (Steigung, Wind, Untergrund) und Fahrzeit-Profile je Route.
// Ein Profil enthält die kumulierte reine Fahrzeit (Stunden) an Stützstellen entlang der Route:
//   {ends:[m …], mt:[h …]} – daraus ergeben sich Ankunftszeiten, Dauer und Ø-Tempo.
import { BIKES, buildSegments, flatPower, idxAt, movingProfile, rad, valueAt, WIND_RIDER_FACTOR } from './core.js';
import { $, nf0, nf1 } from './util.js';
import { profileName } from './routing.js';
import { speedKmh } from './weather.js';

export const paceModel=()=>$('paceModel').value==='const'?'const':'phys';
export const massKg=()=>Math.min(200,Math.max(30,parseFloat(String($('mass').value).replace(',','.'))||85));
export function bikeType(){ const p=profileName().toLowerCase(); return /gravel|mtb/.test(p)?'offroad':/trekking|safety|hiking/.test(p)?'mixed':'road'; }
const bike=()=>BIKES[bikeType()];
export const riderPower=()=>{ const b=bike(); return flatPower(speedKmh(),{m:massKg(),cda:b.cda,crr:b.crr.paved}); };
export const paceKey=()=>[paceModel(),speedKmh(),massKg(),bikeType()].join('|');

/* ---- Abschnitte der Route (Steigung, Richtung, Untergrund) – je Route zwischengespeichert */
function surfAt(r,d){ const sp=r.surfProf; if(!sp||!sp.ends.length) return 'unknown'; return sp.cls[Math.min(sp.cls.length-1,idxAt(sp.ends,d))]; }
function segsOf(r){
  if(r._segs&&r._segs.coords===r.coords) return r._segs;
  const segs=r.retLen
    ? [...buildSegments(r.coords,r.cum,{from:0,to:r.outLen}), ...buildSegments(r.coords,r.cum,{from:r.outLen,to:r.lengthM})]
    : buildSegments(r.coords,r.cum);
  segs.forEach(s=>{ s.surf=surfAt(r,(s.d0+s.d1)/2); });
  r._segs={coords:r.coords, segs, ends:[segs.length?segs[0].d0:0, ...segs.map(s=>s.d1)]};
  return r._segs;
}
function segSamples(r,segs){ // je Abschnitt der nächstgelegene Wetter-Stützpunkt (gleiche Fahrtrichtung)
  if(r._segSmp&&r._segSmp.samples===r.samples&&r._segSmp.segs===segs) return r._segSmp.idx;
  const ds=r.samples.map(s=>s.d), idx=new Int32Array(segs.length);
  segs.forEach((s,i)=>{
    const mid=(s.d0+s.d1)/2; let k=idxAt(ds,mid);
    const side=d=>!r.retLen||d<=r.outLen;      // Hin- bzw. Rückweg
    if(k>0&&mid-ds[k-1]<ds[k]-mid&&side(ds[k-1])===side(mid)) k--;
    idx[i]=Math.min(k,ds.length-1);
  });
  r._segSmp={samples:r.samples, segs, idx};
  return idx;
}

/* ---- Fahrzeit-Profile */
export function computeProfile(r,{wxOf=null,v0=speedKmh()}={}){
  // wxOf(i) = Wetter am Stützpunkt i (oder null) → Gegenwind je Abschnitt
  if(paceModel()==='const') return {ends:[0,r.lengthM], mt:[0,r.lengthM/1000/v0]};
  const {segs,ends}=segsOf(r), b=bike(), m=massKg(), P=flatPower(v0,{m,cda:b.cda,crr:b.crr.paved});
  let windOf=null;
  if(wxOf&&r.samples){
    const si=segSamples(r,segs);
    windOf=i=>{ const w=wxOf(si[i]); return w?w.ws*WIND_RIDER_FACTOR/3.6*Math.cos(rad(w.wd-segs[i].heading)):0; };
  }
  const mt=movingProfile(segs,{P,m,cda:b.cda,crrOf:s=>b.crr[s.surf]??b.crr.unknown,vmaxKmh:b.vmax,windOf});
  return {ends,mt};
}
export function baseProfile(r){ // ohne Wind – vor dem Laden der Wetterdaten
  const key=paceKey();
  if(r._base&&r._base.key===key&&r._base.coords===r.coords) return r._base;
  return r._base={...computeProfile(r),key,coords:r.coords,windy:false};
}
export function windProfile(r){ // mit Wind an den aktuellen Wetter-Stützpunkten
  return {...computeProfile(r,{wxOf:i=>r.samples[i]&&r.samples[i].wx}),key:paceKey(),coords:r.coords,windy:true};
}
export function currentProfile(r){ // zuletzt mit Wetter berechnetes Profil, sonst ohne Wind
  return r._prof&&r._prof.key===paceKey()&&r._prof.coords===r.coords ? r._prof : baseProfile(r);
}
export const movingAt=(prof,d)=>valueAt(prof.ends,prof.mt,d);
export const movingTotal=prof=>prof.mt[prof.mt.length-1];

export const V_MIN_SEARCH=5, V_MAX_SEARCH=80;
export function requiredFlatSpeed(r,moveH){ // Tempo in der Ebene, mit dem die reine Fahrzeit höchstens moveH beträgt
  const prof=currentProfile(r), key=[prof.key,prof.windy?r.samples:null,moveH].join('|');
  if(r._vreq&&r._vreq.key===key&&r._vreq.prof===prof) return r._vreq.v;
  const wxOf=prof.windy?(i=>r.samples[i]&&r.samples[i].wx):null;
  const mv=v0=>{ const p=computeProfile(r,{wxOf,v0}); return p.mt[p.mt.length-1]; };
  let v;
  if(mv(V_MAX_SEARCH)>moveH) v=Infinity;
  else if(mv(V_MIN_SEARCH)<=moveH) v=V_MIN_SEARCH;
  else { let lo=V_MIN_SEARCH,hi=V_MAX_SEARCH; for(let k=0;k<22;k++){ const mid=(lo+hi)/2; if(mv(mid)>moveH) lo=mid; else hi=mid; } v=hi; }
  r._vreq={key,prof,v};
  return v;
}

/* ---- Texte für die Oberfläche */
export const vReqTitle=()=>paceModel()==='phys'?'nötiges Tempo (Ebene)':'nötiges Ø';
export const fmtV=v=>v==null?'–':!isFinite(v)?'nicht erreichbar':v<=V_MIN_SEARCH?`≤ ${nf0.format(V_MIN_SEARCH)} km/h`:`${nf1.format(v)} km/h`;
export const paceShort=()=>paceModel()==='phys'
  ? `Tempo-Modell: ${nf1.format(speedKmh())} km/h in der Ebene, ${nf0.format(massKg())} kg`
  : `${nf1.format(speedKmh())} km/h`;
export function updatePaceUI(){
  const phys=paceModel()==='phys', b=bike();
  $('speedLbl').textContent=phys?'Tempo Ebene (km/h)':'Ø Tempo (km/h)';
  $('speed').title=phys?'Dein Dauertempo auf ebenem Asphalt bei Windstille – daraus wird deine Leistung berechnet.':'Durchschnittstempo in Bewegung, unabhängig von Steigung und Wind.';
  $('mass').disabled=!phys;
  $('paceInfo').innerHTML=phys
    ? `≈ <b>${nf0.format(riderPower())} W</b> Dauerleistung · Radtyp ${b.name} (aus dem Routing-Profil). Bergauf langsamer (mit etwas mehr Kraft), bergab rollen bis ${b.vmax} km/h; Wind in Fahrerhöhe ≈ ${nf0.format(WIND_RIDER_FACTOR*100)} % des 10-m-Werts; Schotter und Pflaster bremsen.`
    : 'Fahrzeit = Strecke ÷ Ø-Tempo – Steigung, Wind und Untergrund bleiben unberücksichtigt.';
}
