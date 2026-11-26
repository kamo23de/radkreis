// Radrouten-Radar – reine Rechenfunktionen ohne DOM-Zugriff.
// ES-Modul: im Browser von den übrigen Modulen importiert, in Node direkt testbar (siehe tests/).

/* ================================================================ Geo */
export const R_EARTH = 6371008.8;
export const rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
export function haversine(a,b){
  const dLat=rad(b.lat-a.lat), dLng=rad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R_EARTH*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function destination(p,brngDeg,dist){
  const d=dist/R_EARTH, b=rad(brngDeg), f1=rad(p.lat), l1=rad(p.lng);
  const f2=Math.asin(Math.sin(f1)*Math.cos(d)+Math.cos(f1)*Math.sin(d)*Math.cos(b));
  const l2=l1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(f1),Math.cos(d)-Math.sin(f1)*Math.sin(f2));
  return {lat:deg(f2), lng:((deg(l2)+540)%360)-180};
}
export function bearing(a,b){
  const f1=rad(a.lat), f2=rad(b.lat), dl=rad(b.lng-a.lng);
  return (deg(Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl)))+360)%360;
}
export function interpolate(a,b,f){ // Punkt auf der Großkreislinie
  const d=haversine(a,b)/R_EARTH; if(d===0) return {...a};
  const A=Math.sin((1-f)*d)/Math.sin(d), B=Math.sin(f*d)/Math.sin(d);
  const f1=rad(a.lat),l1=rad(a.lng),f2=rad(b.lat),l2=rad(b.lng);
  const x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2);
  const y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2);
  const z=A*Math.sin(f1)+B*Math.sin(f2);
  return {lat:deg(Math.atan2(z,Math.hypot(x,y))), lng:deg(Math.atan2(y,x))};
}
export function geodesicCircle(c,rKm,n=360){
  const pts=[]; for(let i=0;i<=n;i++){const p=destination(c,i*360/n,rKm*1000); pts.push([p.lat,p.lng]);}
  for(let i=1;i<pts.length;i++){while(pts[i][1]-pts[i-1][1]>180)pts[i][1]-=360;while(pts[i][1]-pts[i-1][1]<-180)pts[i][1]+=360;}
  return pts;
}

/* ================================================================ Linien ([lng,lat,ele]-Koordinaten wie GeoJSON) */
export const llOf = p => ({lat:p[1], lng:p[0]});
export function cumDist(coords){ // kumulierte Distanz (m) je Punkt
  const c=[0]; for(let i=1;i<coords.length;i++) c.push(c[i-1]+haversine(llOf(coords[i-1]),llOf(coords[i])));
  return c;
}
export function idxAt(cum,d){ let lo=0,hi=cum.length-1; while(lo<hi){const m=(lo+hi)>>1; if(cum[m]<d) lo=m+1; else hi=m;} return lo; }
export function climb(eles,T=5){ // Höhenmeter mit Hysterese T (m) gegen Rauschen
  let up=0,down=0,ref=null;
  for(const e of eles){ if(e==null) continue; if(ref==null){ref=e;continue;} if(e-ref>=T){up+=e-ref;ref=e;} else if(ref-e>=T){down+=ref-e;ref=e;} }
  return {up,down};
}
export function overlapShare(outC,retC){ // Anteil des Rückwegs, der auf dem Hinweg verläuft (Raster ~40 m)
  const key=p=>Math.round(p[1]*2500)+','+Math.round(p[0]*1600);
  const set=new Set(); outC.forEach(p=>set.add(key(p)));
  let hit=0,tot=0;
  for(let i=1;i<retC.length;i++){ const d=haversine(llOf(retC[i-1]),llOf(retC[i])); tot+=d; if(set.has(key(retC[i]))) hit+=d; }
  return tot?hit/tot:0;
}
export function simplifyCoords(coords,tol=2,maxPts=10000){ // Douglas-Peucker in Metern, entfernt nur redundante Punkte
  const n=coords.length; if(n<3) return coords;
  const lat0=rad(coords[0][1]), kx=111320*Math.cos(lat0), ky=110540;
  const P=coords.map(c=>[c[0]*kx,c[1]*ky]);
  const run=t=>{
    const keep=new Uint8Array(n); keep[0]=keep[n-1]=1; const stack=[[0,n-1]], t2=t*t;
    while(stack.length){ const [a,b]=stack.pop(); let md=0,mi=-1;
      const [ax,ay]=P[a],[bx,by]=P[b], dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy;
      for(let i=a+1;i<b;i++){ const [px,py]=P[i]; let u=L?((px-ax)*dx+(py-ay)*dy)/L:0; u=Math.max(0,Math.min(1,u));
        const ex=ax+u*dx-px, ey=ay+u*dy-py, d=ex*ex+ey*ey; if(d>md){md=d;mi=i;} }
      if(md>t2&&mi>0){ keep[mi]=1; stack.push([a,mi],[mi,b]); } }
    return coords.filter((_,i)=>keep[i]);
  };
  let out=run(tol); while(out.length>maxPts&&tol<200){ tol*=1.6; out=run(tol); }
  return out;
}

/* ================================================================ Zeitmodell
   v   = Ø-Tempo in Bewegung (km/h)
   hpd = reine Fahrstunden pro Tag (24 = durchfahren)
   p   = Pausenanteil an der Zeit unterwegs (Pausen / (Fahrzeit + Pausen))
   Pausen finden innerhalb des Fahrtags statt; ein Tag „unterwegs“ dauert hpd/(1−p) Stunden,
   der Rest bis 24 h ist Nachtruhe. */
export function dayOnRoadH(hpd,p){ return Math.min(24,hpd/(1-p)); }
export function elapsedFromMoving(moveH,{hpd=24,p=0}){ // Gesamtdauer (h) für moveH Stunden reine Fahrzeit inkl. Pausen und Nachtruhe
  const road=moveH/(1-p), day=dayOnRoadH(hpd,p);
  if(day>=24) return road;
  const days=Math.floor(road/day+1e-9), rest=Math.max(0,road-days*day);
  return rest<1e-9&&days>0 ? (days-1)*24+day : days*24+rest;
}
export function elapsedHours(distKm,{v,hpd=24,p=0}){ // Gesamtdauer (h) für distKm bei konstantem Tempo v
  return elapsedFromMoving(distKm/v,{hpd,p});
}
export function movingHoursWithin(T,{hpd=24,p=0}){ // reine Fahrzeit (h), die in T Stunden Gesamtdauer möglich ist
  const day=dayOnRoadH(hpd,p);
  const road=day>=24 ? T : Math.floor(T/24)*day+Math.min(T%24,day);
  return road*(1-p);
}
export function parseDurationH(s){ // „6“, „5,5“, „5:30“ → Stunden; leer/ungültig → null
  const v=String(s??'').trim().replace(',','.'); if(!v) return null;
  const m=v.match(/^(\d+):(\d{1,2})$/); const h=m?(+m[1])+(+m[2])/60:Number(v);
  return isFinite(h)&&h>0?h:null;
}

/* ================================================================ Fahrphysik (Tempo-Modell)
   Leistungsbilanz: P·η = v·m·g·(sin θ + Crr·cos θ) + ½·ρ·CdA·(v+w)·|v+w|·v
   v = Fahrtempo, w = Gegenwind in Fahrerhöhe (negativ = Rückenwind), θ = Steigungswinkel.
   Die Dauerleistung P wird aus dem Tempo in der Ebene bei Windstille kalibriert. */
const G=9.81, ETA=0.97, RHO0=1.2;
export const WIND_RIDER_FACTOR=0.7;            // Wind in ca. 1,5 m Höhe ≈ 70 % des 10-m-Werts (offenes Gelände)
export const rhoAt=ele=>RHO0*Math.exp(-(ele||0)/8400);  // Luftdichte nach Höhe über NN
export const BIKES={                            // CdA (m²), Rollwiderstand je Untergrund, Höchsttempo bergab (km/h)
  road:   {name:'Rennrad',    cda:0.40, vmax:50, crr:{paved:.006, rough:.011, good:.011, unpaved:.016, unknown:.007}},
  mixed:  {name:'Trekking',   cda:0.55, vmax:40, crr:{paved:.007, rough:.011, good:.0095,unpaved:.013, unknown:.008}},
  offroad:{name:'Gravel/MTB', cda:0.50, vmax:35, crr:{paved:.009, rough:.011, good:.0095,unpaved:.012, unknown:.0095}}
};
// Leistung je Steigung relativ zur Dauerleistung: bergauf wird mehr getreten (bis +60 % ab 8 %),
// bergab weniger (ab −5 % nur noch rollen).
export const powerFactor=g=>g>=0 ? 1+0.6*Math.min(g,0.08)/0.08 : Math.max(0,1+g/0.05);
export function powerAt(v,{grade=0,wind=0,rho=RHO0,m,cda,crr}){ // nötige Tretleistung (W) bei Tempo v (m/s)
  const c=1/Math.sqrt(1+grade*grade), sn=grade*c, va=v+wind;
  return (v*m*G*(sn+crr*c)+0.5*rho*cda*va*Math.abs(va)*v)/ETA;
}
export function speedFor(P,opts,vmin=1.1,vmax=16.7){ // Tempo (m/s), bei dem die Leistung P erreicht wird
  // Für P ≥ 0 ist {v > 0 : powerAt(v) ≥ P} ein Intervall [v*, ∞) → Bisektion ist eindeutig.
  if(powerAt(vmax,opts)<=P) return vmax;      // bergab/Rückenwind: Höchsttempo (Bremsen)
  if(powerAt(vmin,opts)>=P) return vmin;      // sehr steil: Schiebetempo
  let lo=vmin,hi=vmax;
  for(let k=0;k<26;k++){ const mid=(lo+hi)/2; if(powerAt(mid,opts)<P) lo=mid; else hi=mid; }
  return (lo+hi)/2;
}
export function flatPower(v0kmh,{m,cda,crr}){ return powerAt(v0kmh/3.6,{m,cda,crr}); }

function posAt(coords,cum,d){ // interpolierter Punkt [lng,lat,ele] bei Distanz d
  const i=idxAt(cum,d); if(i===0) return coords[0];
  const a=coords[i-1], b=coords[i], f=(cum[i]-cum[i-1])>0?(d-cum[i-1])/(cum[i]-cum[i-1]):0;
  const ea=a.length>2?a[2]:null, eb=b.length>2?b[2]:null;
  return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, ea==null||eb==null?(ea??eb):ea+(eb-ea)*f];
}
export function buildSegments(coords,cum,{from=0,to=cum[cum.length-1],segLen=250,maxSegs=800}={}){
  // Route in Abschnitte von mind. segLen Metern teilen (Steigung über den Abschnitt geglättet)
  const L=to-from; if(!(L>0)) return [];
  const n=Math.max(1,Math.round(L/Math.max(segLen,L/maxSegs))), out=[];
  let p0=posAt(coords,cum,from);
  for(let k=0;k<n;k++){
    const d0=from+L*k/n, d1=from+L*(k+1)/n, p1=posAt(coords,cum,d1), len=d1-d0;
    const grade=p0[2]!=null&&p1[2]!=null&&len>0?Math.max(-0.25,Math.min(0.25,(p1[2]-p0[2])/len)):0;
    out.push({d0,d1,len,grade,heading:bearing(llOf(p0),llOf(p1)),ele:p0[2]!=null&&p1[2]!=null?(p0[2]+p1[2])/2:(p0[2]??p1[2]??0)});
    p0=p1;
  }
  return out;
}
export function movingProfile(segs,{P,m,cda,crrOf,vmaxKmh,windOf}){
  // kumulierte reine Fahrzeit (h) an den Abschnittsenden; windOf(i) = Gegenwind (m/s) in Fahrerhöhe
  const mt=new Float64Array(segs.length+1), vmax=vmaxKmh/3.6;
  for(let i=0;i<segs.length;i++){
    const s=segs[i];
    const v=speedFor(P*powerFactor(s.grade),{grade:s.grade,wind:windOf?windOf(i):0,rho:rhoAt(s.ele),m,cda,crr:crrOf?crrOf(s):0.005},1.1,vmax);
    mt[i+1]=mt[i]+s.len/v/3600;
  }
  return mt;
}
export function valueAt(ends,vals,d){ // lineare Interpolation über aufsteigende Stützstellen
  const n=ends.length; if(d<=ends[0]) return vals[0]; if(d>=ends[n-1]) return vals[n-1];
  const i=idxAt(ends,d), f=(d-ends[i-1])/(ends[i]-ends[i-1]||1);
  return vals[i-1]+(vals[i]-vals[i-1])*f;
}

/* ================================================================ Klima: Zeitpunkte in frühere Jahre verschieben */
export function shiftYears(u,n){ // Unix-Sekunden um n Jahre zurück, gleicher Kalendertag/Uhrzeit (UTC); 29.02. → 28.02.
  if(!n) return u;
  const d=new Date(u*1000), y=d.getUTCFullYear()-n, m=d.getUTCMonth();
  const dim=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return Date.UTC(y,m,Math.min(d.getUTCDate(),dim),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())/1000;
}

/* ================================================================ Teilbare Planungs-Links
   Kompaktes Format (Version 1), als JSON → UTF-8 → base64url hinter „#p=“:
   {v:1, s:[lat,lng,name], r:radius, p:profil, t:start(unix), sp:tempo, h:fahrstd/tag, d:max.dauer,
    w:'c'=klima, m:'c'=konstant, kg:gewicht, rd:rückweg, ow:[gewichte], z:[[lat,lng,name,rückweg,pausen%], …]}
   Standardwerte werden weggelassen, Koordinaten auf 5 Nachkommastellen (≈ 1 m) gerundet. */
export const MAX_SHARED_TARGETS=30;
const SHARE_WKEYS=['profile','weather','beauty','efficiency'];
const RET_CODE={none:'n',best:'b',same:'s',alt:'a'}, RET_NAME={n:'none',b:'best',s:'same',a:'alt'};
const r5=x=>Math.round(x*1e5)/1e5;
const cut=(x,max=120)=>typeof x==='string'&&x.trim()?x.trim().slice(0,max):null;
export function planToShare(p){
  const c={v:1, s:[r5(p.start.lat),r5(p.start.lng)]};
  const sn=cut(p.startName); if(sn) c.s.push(sn);
  if(+p.radiusKm&&+p.radiusKm!==100) c.r=+p.radiusKm;
  if(p.profile) c.p=p.profile;
  if(p.startUnix) c.t=Math.round(p.startUnix);
  if(+p.speed) c.sp=+p.speed;
  if(+p.hpd&&+p.hpd!==24) c.h=+p.hpd;
  const d=cut(String(p.maxDur??''),10); if(d) c.d=d;
  if(p.wxMode==='clim') c.w='c';
  if(p.paceModel==='const') c.m='c';
  if(+p.mass&&+p.mass!==85) c.kg=+p.mass;
  if(p.retDefault&&p.retDefault!=='none') c.rd=RET_CODE[p.retDefault];
  if(p.optWeights) c.ow=SHARE_WKEYS.map(k=>Math.round(+p.optWeights[k]||0));
  c.z=(p.targets||[]).slice(0,MAX_SHARED_TARGETS).map(t=>{
    const a=[r5(t.lat),r5(t.lng),cut(t.name)||0], rc=RET_CODE[t.retMode]||'n', pp=Math.round(+t.pausePct||0);
    if(rc!=='n'||pp) a.push(rc); if(pp) a.push(pp);
    return a;
  });
  return c;
}
export function shareToPlan(c){ // prüft den (fremden) Inhalt eines Links; ungültig → null
  if(!c||typeof c!=='object'||c.v!==1||!Array.isArray(c.s)) return null;
  const num=(x,lo,hi)=>{ if(x==null||x==='') return null; const n=Number(x); return isFinite(n)&&n>=lo&&n<=hi?n:null; };
  const ll=a=>Array.isArray(a)&&num(a[0],-90,90)!=null&&num(a[1],-180,180)!=null?{lat:+a[0],lng:+a[1]}:null;
  const start=ll(c.s); if(!start) return null;
  const p={
    start, startName:cut(c.s[2])||'',
    radiusKm:num(c.r,1,2000)??100,
    profile:typeof c.p==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(c.p)?c.p:'trekking',
    startUnix:num(c.t,1e9,1e10),
    speed:String(num(c.sp,5,60)??25),
    hpd:String(num(c.h,1,24)??24),
    maxDur:typeof c.d==='string'&&parseDurationH(c.d)?c.d.trim().slice(0,10):'',
    wxMode:c.w==='c'?'clim':'auto',
    paceModel:c.m==='c'?'const':'phys',
    mass:String(num(c.kg,30,200)??85),
    retDefault:RET_NAME[c.rd]||'none'
  };
  if(Array.isArray(c.ow)&&c.ow.length===SHARE_WKEYS.length&&c.ow.every(x=>num(x,0,100)!=null))
    p.optWeights=Object.fromEntries(SHARE_WKEYS.map((k,i)=>[k,+c.ow[i]]));
  p.targets=(Array.isArray(c.z)?c.z:[]).slice(0,MAX_SHARED_TARGETS).map(a=>{
    const q=ll(a); if(!q) return null;
    return {...q, name:cut(a[2]), retMode:RET_NAME[a[3]]||'none', pausePct:num(a[4],0,90)??0};
  }).filter(Boolean);
  return p;
}
export function encodeShare(obj){
  const bytes=new TextEncoder().encode(JSON.stringify(obj)); let bin='';
  bytes.forEach(b=>{ bin+=String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeShare(str){ // → Objekt oder null
  try{
    if(typeof str!=='string'||!str||str.length>8000||!/^[A-Za-z0-9_-]+$/.test(str)) return null;
    const bin=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((str.length+3)%4));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bin,ch=>ch.charCodeAt(0))));
  }catch{ return null; }
}

/* ================================================================ Wegeattribute aus den BRouter-Meldungen */
export const PAVED=new Set(['asphalt','concrete','concrete:plates','concrete:lanes','paved','chipseal','paving_stones','metal','wood']);
export const ROUGH=new Set(['sett','cobblestone','unhewn_cobblestone','cobblestone:flattened','grass_paver']);
export const GOOD_UNPAVED=new Set(['compacted','fine_gravel']);
export const BAD_SMOOTH=/^(bad|very_bad|horrible|very_horrible|impassable)$/;
export function parseTags(str){ const o={}; (str||'').split(' ').forEach(kv=>{ const i=kv.indexOf('='); if(i>0) o[kv.slice(0,i)]=kv.slice(i+1); }); return o; }
export function surfaceClass(t){
  const s=t.surface;
  if(BAD_SMOOTH.test(t.smoothness||'')) return s&&PAVED.has(s)?'rough':'unpaved';
  if(s){ if(PAVED.has(s)) return 'paved'; if(ROUGH.has(s)) return 'rough'; if(GOOD_UNPAVED.has(s)) return 'good'; return 'unpaved'; }
  if(t.highway==='track') return t.tracktype==='grade1'?'paved':t.tracktype==='grade2'?'good':'unpaved';
  return 'unknown';
}
export const LVL_CARFREE=new Set(['cycleway','path','footway','bridleway','pedestrian','track','steps','corridor']);
export const LVL_QUIET=new Set(['residential','living_street','service','unclassified','road']);
export const LVL_MEDIUM=new Set(['tertiary','tertiary_link']);
export function trafficLevel(t){ // 0 autofrei · 1 ruhig · 2 mäßig · 3 viel Verkehr
  const h=t.highway||'';
  if(t.bicycle_road==='yes'||t.cyclestreet==='yes') return 0;
  let l=LVL_CARFREE.has(h)?0:LVL_QUIET.has(h)?1:LVL_MEDIUM.has(h)?2:3;
  const cw=['cycleway','cycleway:right','cycleway:left','cycleway:both'].map(k=>t[k]).filter(Boolean);
  if(l>=2&&cw.includes('track')) l--;                        // baulich getrennter Radweg
  const ms=parseInt(t.maxspeed,10);
  if(l>=1&&l<=2&&ms>=70) l++;                                 // schnelle Landstraße
  if(t.motor_vehicle==='no'||t.motorcar==='no') l=Math.min(l,0);
  return l;
}
