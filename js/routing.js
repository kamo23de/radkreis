// Radrouten-Radar – Modul „routing“
import { bearing, climb, cumDist, destination, haversine, interpolate, overlapShare, parseTags, surfaceClass } from './core.js';
import { LEG_M, MAX_PARALLEL, SEGMENT_THRESHOLD_M, SERVERS } from './config.js';
import { state } from './state.js';
import { $ } from './util.js';
import { buildSamples, scheduleWeather } from './weather.js';
import { drawRoute } from './targets.js';
import { renderList } from './list.js';
import { wayStats } from './ranking.js';
import { renderAll } from './render.js';

/* ================================================================ Routing (BRouter) */
let active=0; const waiting=[];
function limit(fn){
  return new Promise((resolve,reject)=>{
    const run=async()=>{active++; try{resolve(await fn());}catch(e){reject(e);}finally{active--; if(waiting.length) waiting.shift()();}};
    active<MAX_PARALLEL?run():waiting.push(run);
  });
}
export function profileName(){ const v=$('profile').value; return v==='__custom' ? ($('customProfile').value.trim()||'trekking') : v; }
function serverList(){
  const v=$('server').value;
  if(v==='custom'){ const u=$('customServer').value.trim(); return u?[{name:'eigener Server',url:u}]:[SERVERS.brouter]; }
  if(v==='bikerouter') return [SERVERS.bikerouter];
  if(v==='brouter') return [SERVERS.brouter];
  return [SERVERS.bikerouter, SERVERS.brouter];
}
export const deadServers=new Set();
async function fetchLeg(a,b,signal,{timeout=90000,alt=0}={}){
  let servers=serverList();
  if($('server').value==='auto'){ const alive=servers.filter(s=>!deadServers.has(s.url)); if(alive.length) servers=alive; }
  let lastErr;
  for(const s of servers){
    const url=`${s.url}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${encodeURIComponent(profileName())}&alternativeidx=${alt}&format=geojson`;
    try{
      return await limit(async()=>{
        const tc=new AbortController(); let timedOut=false;
        const onAbort=()=>tc.abort(); signal&&signal.addEventListener('abort',onAbort,{once:true});
        const tm=setTimeout(()=>{ timedOut=true; tc.abort(); },timeout);
        let resp,txt;
        try{ resp=await fetch(url,{signal:tc.signal}); txt=await resp.text(); }
        catch(err){ if(timedOut){ const e=new Error('Zeitüberschreitung beim Routing-Server'); e.server=true; throw e; } throw err; }
        finally{ clearTimeout(tm); signal&&signal.removeEventListener('abort',onAbort); }
        if(!resp.ok){ const e=new Error(txt.trim().slice(0,300)||('HTTP '+resp.status)); e.server=true; throw e; }
        let gj; try{ gj=JSON.parse(txt); }catch{ const e=new Error(txt.trim().slice(0,300)); e.server=true; throw e; }
        const f=gj.features&&gj.features[0]; if(!f) throw new Error('Leere Antwort vom Routing-Server');
        return {coords:f.geometry.coordinates, props:f.properties||{}, server:s.name};
      });
    }catch(e){
      if(e.name==='AbortError') throw e;
      lastErr=e;
      if(!e.server && servers.length>1) deadServers.add(s.url);
      if(e.server && /not mapped|island/i.test(e.message)) throw e;
    }
  }
  throw lastErr;
}
const isPointProblem = e => /not mapped|island|position/i.test(e.message||'');
async function routeLeg(a,b,signal,depth=0,alt=0){
  try{ return [await fetchLeg(a,b,signal,{alt})]; }
  catch(e){
    if(e.name==='AbortError'||depth>=2||isPointProblem(e)||!e.server||haversine(a,b)<40e3) throw e;
    const m=interpolate(a,b,.5);
    return [...await routeLeg(a,m,signal,depth+1,alt), ...await routeLeg(m,b,signal,depth+1,alt)];
  }
}
async function computeLegs(pts,signal,onProgress,alt=0){
  const n=pts.length-1, res=new Array(n), base=pts.map(p=>({...p}));
  const offsets=[25,-25,50,-50,90,-90].map(k=>k*1000), tries=new Array(pts.length).fill(0);
  const axis=bearing(base[0],base[n]);
  let todo=[...Array(n).keys()];
  for(let round=0; round<8 && todo.length; round++){
    const results=await Promise.allSettled(todo.map(i=>routeLeg(pts[i],pts[i+1],signal,0,alt).then(r=>{res[i]=r; onProgress&&onProgress(res.filter(Boolean).length,n); return r;})));
    const next=new Set();
    for(let k=0;k<results.length;k++){
      const r=results[k], i=todo[k];
      if(r.status==='fulfilled') continue;
      const e=r.reason; if(e.name==='AbortError') throw e;
      res[i]=undefined;
      let cand=/from/i.test(e.message)?[i]:/to-?pos|target/i.test(e.message)?[i+1]:[i,i+1];
      cand=cand.filter(j=>j>0&&j<n);
      if(!cand.length||n===1) throw e;
      for(const j of cand){
        if(tries[j]>=offsets.length) throw e;
        pts[j]=destination(base[j],axis+90,offsets[tries[j]++]);
        next.add(j-1); next.add(j);
      }
    }
    todo=[...next].filter(i=>i>=0&&i<n);
  }
  if(res.some(x=>!x)) throw new Error('Route konnte nicht vollständig berechnet werden.');
  return res.flat();
}
function friendlyError(e){
  const m=e.message||String(e);
  if(e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(m)){
    const cs=$('server').value==='custom'?$('customServer').value.trim():'';
    if(location.protocol==='https:'&&/^http:/i.test(cs))
      return 'Der eigene Routing-Server nutzt http://. Von einer https-Seite aus blockiert der Browser solche Anfragen (Mixed Content) – Server per https:// erreichbar machen.';
    return 'Routing-Server nicht erreichbar (Netzwerk oder CORS). Anderen Server unter „Routing-Server“ wählen oder die Seite über http:// statt file:// öffnen.';
  }
  if(/not mapped/i.test(m)) return 'Punkt liegt zu weit von einem routbaren Weg entfernt (oder außerhalb der Kartendaten). Marker etwas verschieben.';
  if(/island/i.test(m)) return 'Punkt liegt auf einer „Insel“ ohne Wegverbindung. Marker verschieben.';
  if(/profile/i.test(m)) return 'Profil auf diesem Server unbekannt (Spezialprofile gibt es nur bei bikerouter.de): '+m;
  return m;
}
export const RET_MODES={none:'kein Rückweg', best:'optimal berechnet', same:'gleiche Strecke zurück', alt:'andere Strecke zurück'};
function legPoints(a,b){
  const d=haversine(a,b); if(d<=SEGMENT_THRESHOLD_M) return [a,b];
  const n=Math.ceil(d/LEG_M), pts=[]; for(let i=0;i<=n;i++) pts.push(i===0?a:i===n?b:interpolate(a,b,i/n)); return pts;
}
function joinLegs(legs){
  const coords=[]; let len=0,time=0; const servers=new Set();
  legs.forEach((L,k)=>{ (k?L.coords.slice(1):L.coords).forEach(p=>coords.push(p)); len+=+L.props['track-length']||0; time+=+L.props['total-time']||0; servers.add(L.server); });
  return {coords,len,time,servers};
}
function surfParts(legs){ // [[Länge, Untergrundklasse], …] in Fahrtrichtung aus den BRouter-Meldungen
  const parts=[];
  legs.forEach(L=>{
    const m=L.props&&L.props.messages; if(!Array.isArray(m)||m.length<2) return;
    const iD=m[0].indexOf('Distance'), iT=m[0].indexOf('WayTags'); if(iD<0||iT<0) return;
    for(let i=1;i<m.length;i++){ const d=+m[i][iD]||0; if(d>0) parts.push([d,surfaceClass(parseTags(m[i][iT]))]); }
  });
  return parts;
}
function placeSurf(parts,from,len,out){ // Abschnitte auf die Routendistanz [from, from+len] skalieren
  const tot=parts.reduce((a,p)=>a+p[0],0);
  if(!tot){ out.ends.push(from+len); out.cls.push('unknown'); return; }
  let acc=from; parts.forEach(([d,c])=>{ acc+=d/tot*len; out.ends.push(acc); out.cls.push(c); });
}
export async function computeRoute(r){
  if(!state.start) return;
  r.ctrl&&r.ctrl.abort();
  const ctrl=new AbortController(); r.ctrl=ctrl;
  r.status='loading'; r.error=null; r.progress=null; r.samples=null; r.wx=null; r.retError=null; renderAll();
  const mode=r.retMode||'none';
  try{
    if(!isFinite(r.latlng.lat)||!isFinite(r.latlng.lng)) throw new Error('Ungültige Zielkoordinaten.');
    const a=state.start, b=r.latlng, d=haversine(a,b);
    // Hinweg – bei unveränderten Eingaben aus dem Zwischenspeicher (z. B. wenn nur der Rückweg-Modus wechselt)
    const outKey=[a.lat,a.lng,b.lat,b.lng,profileName(),$('server').value,$('customServer').value].join('|');
    let outLegs=r._out&&r._out.key===outKey?r._out.legs:null;
    if(!outLegs){
      const pts=legPoints(a,b);
      outLegs=await computeLegs(pts,ctrl.signal,(done,n)=>{ if(n>1&&ctrl===r.ctrl){ r.progress=`Hinweg ${done}/${n} Etappen`; renderList(); }});
      if(ctrl!==r.ctrl) return;
      r._out={key:outKey,legs:outLegs};
    }
    const out=joinLegs(outLegs);
    let coords=out.coords, len=out.len||0, time=out.time, legsAll=outLegs, retLen=0, overlap=null;
    if(!len){ const c=cumDist(out.coords); len=c[c.length-1]; }
    const outLen=len;
    // Rückweg
    if(mode!=='none'){
      let ret;
      if(mode==='same'){
        ret={coords:out.coords.slice().reverse(), len:outLen, time:out.time, servers:out.servers}; legsAll=outLegs.concat(outLegs); overlap=1;
      } else {
        const pts=legPoints(b,a);
        const onP=(done,n)=>{ if(ctrl===r.ctrl){ r.progress=`Rückweg ${done}/${n} Etappe${n>1?'n':''}`; renderList(); }};
        let retLegs;
        try{ retLegs=await computeLegs(pts,ctrl.signal,onP,mode==='alt'?1:0); }
        catch(e){ if(e.name==='AbortError') throw e; if(mode!=='alt') throw e; retLegs=await computeLegs(pts,ctrl.signal,onP,0); r.retError='Keine Alternative gefunden – optimaler Rückweg verwendet.'; }
        if(ctrl!==r.ctrl) return;
        ret=joinLegs(retLegs); legsAll=outLegs.concat(retLegs);
        overlap=overlapShare(out.coords,ret.coords);
      }
      if(!ret.len){ const c=cumDist(ret.coords); ret.len=c[c.length-1]; }
      coords=out.coords.concat(ret.coords.slice(1)); retLen=ret.len; len=outLen+retLen; time=out.time+ret.time;
    }
    const cum=cumDist(coords);
    // Hin- und Rückweg getrennt auf die BRouter-Längen skalieren
    const oi=out.coords.length-1, rawOut=cum[oi]||1, rawRet=(cum[cum.length-1]-cum[oi])||1;
    const cumS=cum.map((x,i)=>i<=oi? x*outLen/rawOut : outLen+(x-cum[oi])*(retLen||rawRet)/rawRet);
    const eles=coords.map(p=>p.length>2?p[2]:null), valid=eles.filter(e=>e!=null);
    const {up,down}=climb(eles);
    // Untergrund entlang der Route (für den Rollwiderstand im Tempo-Modell)
    const outParts=surfParts(outLegs);
    const retParts=mode==='none'?[]:mode==='same'?outParts.slice().reverse():surfParts(legsAll.slice(outLegs.length));
    const surfProf={ends:[],cls:[]}; placeSurf(outParts,0,outLen,surfProf); if(retLen) placeSurf(retParts,outLen,retLen,surfProf);
    Object.assign(r,{surfProf, status:'ok', coords, cum:cumS, lengthM:len, outLen, retLen, outIdx:oi, overlap, retModeUsed:mode, timeS:time, ascent:up, descent:down,
      maxEle:valid.length?Math.max(...valid):null, minEle:valid.length?Math.min(...valid):null, beeline:d, legs:legsAll.length});
    buildSamples(r);
    r.way=wayStats(r,legsAll);
  }catch(e){
    if(e.name==='AbortError'||ctrl!==r.ctrl) return;
    r.status='error'; r.error=friendlyError(e); r.coords=null; r.way=null;
  }
  r.progress=null;
  drawRoute(r); renderAll();
  if(r.status==='ok') scheduleWeather(200);
}

export function toggleCustom(){
  $('customProfile').style.display=$('profile').value==='__custom'?'block':'none';
  $('customServer').style.display=$('server').value==='custom'?'block':'none';
}
