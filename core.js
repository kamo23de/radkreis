// Radrouten-Radar – reine Rechenfunktionen ohne DOM-Zugriff.
// Im Browser als klassisches Skript geladen (Funktionen/Konstanten sind global),
// in Node per require('./core.js') testbar (siehe tests/).
"use strict";

/* ================================================================ Geo */
const R_EARTH = 6371008.8;
const rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
function haversine(a,b){
  const dLat=rad(b.lat-a.lat), dLng=rad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R_EARTH*Math.asin(Math.min(1,Math.sqrt(h)));
}
function destination(p,brngDeg,dist){
  const d=dist/R_EARTH, b=rad(brngDeg), f1=rad(p.lat), l1=rad(p.lng);
  const f2=Math.asin(Math.sin(f1)*Math.cos(d)+Math.cos(f1)*Math.sin(d)*Math.cos(b));
  const l2=l1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(f1),Math.cos(d)-Math.sin(f1)*Math.sin(f2));
  return {lat:deg(f2), lng:((deg(l2)+540)%360)-180};
}
function bearing(a,b){
  const f1=rad(a.lat), f2=rad(b.lat), dl=rad(b.lng-a.lng);
  return (deg(Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl)))+360)%360;
}
function interpolate(a,b,f){ // Punkt auf der Großkreislinie
  const d=haversine(a,b)/R_EARTH; if(d===0) return {...a};
  const A=Math.sin((1-f)*d)/Math.sin(d), B=Math.sin(f*d)/Math.sin(d);
  const f1=rad(a.lat),l1=rad(a.lng),f2=rad(b.lat),l2=rad(b.lng);
  const x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2);
  const y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2);
  const z=A*Math.sin(f1)+B*Math.sin(f2);
  return {lat:deg(Math.atan2(z,Math.hypot(x,y))), lng:deg(Math.atan2(y,x))};
}
function geodesicCircle(c,rKm,n=360){
  const pts=[]; for(let i=0;i<=n;i++){const p=destination(c,i*360/n,rKm*1000); pts.push([p.lat,p.lng]);}
  for(let i=1;i<pts.length;i++){while(pts[i][1]-pts[i-1][1]>180)pts[i][1]-=360;while(pts[i][1]-pts[i-1][1]<-180)pts[i][1]+=360;}
  return pts;
}

/* ================================================================ Linien ([lng,lat,ele]-Koordinaten wie GeoJSON) */
const llOf = p => ({lat:p[1], lng:p[0]});
function cumDist(coords){ // kumulierte Distanz (m) je Punkt
  const c=[0]; for(let i=1;i<coords.length;i++) c.push(c[i-1]+haversine(llOf(coords[i-1]),llOf(coords[i])));
  return c;
}
function idxAt(cum,d){ let lo=0,hi=cum.length-1; while(lo<hi){const m=(lo+hi)>>1; if(cum[m]<d) lo=m+1; else hi=m;} return lo; }
function climb(eles,T=5){ // Höhenmeter mit Hysterese T (m) gegen Rauschen
  let up=0,down=0,ref=null;
  for(const e of eles){ if(e==null) continue; if(ref==null){ref=e;continue;} if(e-ref>=T){up+=e-ref;ref=e;} else if(ref-e>=T){down+=ref-e;ref=e;} }
  return {up,down};
}
function overlapShare(outC,retC){ // Anteil des Rückwegs, der auf dem Hinweg verläuft (Raster ~40 m)
  const key=p=>Math.round(p[1]*2500)+','+Math.round(p[0]*1600);
  const set=new Set(); outC.forEach(p=>set.add(key(p)));
  let hit=0,tot=0;
  for(let i=1;i<retC.length;i++){ const d=haversine(llOf(retC[i-1]),llOf(retC[i])); tot+=d; if(set.has(key(retC[i]))) hit+=d; }
  return tot?hit/tot:0;
}
function simplifyCoords(coords,tol=2,maxPts=10000){ // Douglas-Peucker in Metern, entfernt nur redundante Punkte
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
function dayOnRoadH(hpd,p){ return Math.min(24,hpd/(1-p)); }
function elapsedHours(distKm,{v,hpd=24,p=0}){ // Gesamtdauer (h) für distKm inkl. Pausen und Nachtruhe
  const road=distKm/v/(1-p), day=dayOnRoadH(hpd,p);
  if(day>=24) return road;
  const days=Math.floor(road/day+1e-9), rest=Math.max(0,road-days*day);
  return rest<1e-9&&days>0 ? (days-1)*24+day : days*24+rest;
}
function movingHoursWithin(T,{hpd=24,p=0}){ // reine Fahrzeit (h), die in T Stunden Gesamtdauer möglich ist
  const day=dayOnRoadH(hpd,p);
  const road=day>=24 ? T : Math.floor(T/24)*day+Math.min(T%24,day);
  return road*(1-p);
}
function parseDurationH(s){ // „6“, „5,5“, „5:30“ → Stunden; leer/ungültig → null
  const v=String(s??'').trim().replace(',','.'); if(!v) return null;
  const m=v.match(/^(\d+):(\d{1,2})$/); const h=m?(+m[1])+(+m[2])/60:Number(v);
  return isFinite(h)&&h>0?h:null;
}

/* ================================================================ Klima: Zeitpunkte in frühere Jahre verschieben */
function shiftYears(u,n){ // Unix-Sekunden um n Jahre zurück, gleicher Kalendertag/Uhrzeit (UTC); 29.02. → 28.02.
  if(!n) return u;
  const d=new Date(u*1000), y=d.getUTCFullYear()-n, m=d.getUTCMonth();
  const dim=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return Date.UTC(y,m,Math.min(d.getUTCDate(),dim),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())/1000;
}

/* ================================================================ Wegeattribute aus den BRouter-Meldungen */
const PAVED=new Set(['asphalt','concrete','concrete:plates','concrete:lanes','paved','chipseal','paving_stones','metal','wood']);
const ROUGH=new Set(['sett','cobblestone','unhewn_cobblestone','cobblestone:flattened','grass_paver']);
const GOOD_UNPAVED=new Set(['compacted','fine_gravel']);
const BAD_SMOOTH=/^(bad|very_bad|horrible|very_horrible|impassable)$/;
function parseTags(str){ const o={}; (str||'').split(' ').forEach(kv=>{ const i=kv.indexOf('='); if(i>0) o[kv.slice(0,i)]=kv.slice(i+1); }); return o; }
function surfaceClass(t){
  const s=t.surface;
  if(BAD_SMOOTH.test(t.smoothness||'')) return s&&PAVED.has(s)?'rough':'unpaved';
  if(s){ if(PAVED.has(s)) return 'paved'; if(ROUGH.has(s)) return 'rough'; if(GOOD_UNPAVED.has(s)) return 'good'; return 'unpaved'; }
  if(t.highway==='track') return t.tracktype==='grade1'?'paved':t.tracktype==='grade2'?'good':'unpaved';
  return 'unknown';
}
const LVL_CARFREE=new Set(['cycleway','path','footway','bridleway','pedestrian','track','steps','corridor']);
const LVL_QUIET=new Set(['residential','living_street','service','unclassified','road']);
const LVL_MEDIUM=new Set(['tertiary','tertiary_link']);
function trafficLevel(t){ // 0 autofrei · 1 ruhig · 2 mäßig · 3 viel Verkehr
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

if(typeof module!=='undefined') module.exports={
  R_EARTH, haversine, destination, bearing, interpolate, geodesicCircle,
  cumDist, idxAt, climb, overlapShare, simplifyCoords,
  elapsedHours, movingHoursWithin, parseDurationH, shiftYears,
  parseTags, surfaceClass, trafficLevel
};
