// Radrouten-Radar – Modul „windmap“: Windkarte als Overlay über der Karte.
// Pfeile in einem Raster über dem sichtbaren Ausschnitt zeigen, wohin der Wind weht; die Farbe zeigt die Stärke.
// Ein Zeitregler wählt die Stunde innerhalb des eingestellten Vorhersagezeitraums. Daten: Open-Meteo (Vorhersage).
import { WIND_STOPS, windColor, windGrid } from './core.js';
import { OM_FORECAST } from './config.js';
import { $, dtf } from './util.js';
import { map } from './map.js';
import { startUnix } from './weather.js';
import { isPhone } from './phone.js';

const KEY='rr-windmap';
const HORIZONS=[[24,'24 h'],[72,'3 Tage'],[168,'7 Tage'],[384,'16 Tage']];   // Stunden ab jetzt
const cache=new Map();          // Rasterpunkt → {t0, n, ws[], wd[], days, fetched}
let on=false, horizonH=72, offsetH=0, points=[], token=0, timer=null, playTimer=null, canvas=null, ctrlBtn=null;
try{ const s=JSON.parse(localStorage.getItem(KEY)||'{}'); on=!!s.on; if(HORIZONS.some(h=>h[0]===s.horizonH)) horizonH=s.horizonH; }catch{}
const store=()=>{ try{ localStorage.setItem(KEY,JSON.stringify({on,horizonH})); }catch{} };

/* ---- Zeitachse: ab der aktuellen vollen Stunde */
const nowHour=()=>Math.floor(Date.now()/3.6e6)*3600;
const daysFor=h=>Math.min(16,Math.ceil(h/24)+1);   // forecast_days zählt ab 0 Uhr UTC des heutigen Tages
function maxOffset(){ // letzte Stunde, für die alle Punkte Daten haben können
  const dayStart=Math.floor(Date.now()/864e5)*86400, end=dayStart+daysFor(horizonH)*86400-3600;
  return Math.max(0,Math.min(horizonH-1,Math.floor((end-nowHour())/3600)));
}
const shownTime=()=>nowHour()+offsetH*3600;

/* ---- Daten */
function needsFetch(k){ const c=cache.get(k); return !c||c.days<daysFor(horizonH)||Date.now()-c.fetched>3600e3; }
async function loadMissing(){
  const tok=++token, days=daysFor(horizonH);
  const miss=[...new Map(points.filter(p=>needsFetch(p.key)).map(p=>[p.key,p])).values()];
  if(!miss.length){ status(''); return; }
  status(`<span class="spin"></span> Winddaten für ${miss.length} Punkte …`);
  try{
    for(let i=0;i<miss.length;i+=100){
      const ch=miss.slice(i,i+100);
      const url=`${OM_FORECAST}?latitude=${ch.map(p=>p.lat).join(',')}&longitude=${ch.map(p=>p.qlng).join(',')}`+
        `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT&forecast_days=${days}`;
      const r=await fetch(url); const j=await r.json().catch(()=>({error:true,reason:'Ungültige Antwort'}));
      if(!r.ok||j.error) throw new Error(j.reason||('HTTP '+r.status));
      if(tok!==token) return;               // inzwischen verschoben/umgestellt
      (Array.isArray(j)?j:[j]).forEach((d,k)=>{ const h=d.hourly||{};
        cache.set(ch[k].key,{t0:h.time?h.time[0]:0, n:h.time?h.time.length:0, ws:h.wind_speed_10m||[], wd:h.wind_direction_10m||[], days, fetched:Date.now()}); });
      draw();
    }
    status('');
  }catch(e){
    if(tok!==token) return;
    status('⚠ Winddaten nicht verfügbar: '+(/Failed to fetch|NetworkError|Load failed/i.test(e.message)?'Open-Meteo nicht erreichbar.':e.message));
  }
}
function windAt(key,t){
  const c=cache.get(key); if(!c||!c.n) return null;
  const i=Math.round((t-c.t0)/3600); if(i<0||i>=c.n||c.ws[i]==null||c.wd[i]==null) return null;
  return {ws:c.ws[i], wd:c.wd[i]};
}

/* ---- Zeichnen (eigene Kartenebene unter den Routen) */
function refreshGrid(){
  const b=map.getBounds().pad(0.08);
  points=windGrid({s:b.getSouth(),w:b.getWest(),n:b.getNorth(),e:b.getEast()},map.getZoom(),{spacingPx:isPhone()?56:66});
  draw();
  clearTimeout(timer); timer=setTimeout(loadMissing,350);
}
function draw(){
  if(!on||!canvas) return;
  const size=map.getSize(), dpr=window.devicePixelRatio||1;
  L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));
  canvas.width=size.x*dpr; canvas.height=size.y*dpr; canvas.style.width=size.x+'px'; canvas.style.height=size.y+'px';
  const g=canvas.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,size.x,size.y);
  const t=shownTime(); let shown=0;
  for(const p of points){
    const w=windAt(p.key,t); if(!w) continue; shown++;
    const c=map.latLngToContainerPoint([p.lat,p.lng]), col=windColor(w.ws);
    if(w.ws<2){ g.beginPath(); g.arc(c.x,c.y,3,0,7); g.fillStyle=col; g.fill(); g.lineWidth=1; g.strokeStyle='#fff'; g.stroke(); continue; }
    const len=14+Math.min(14,w.ws*0.3), a=(w.wd+180)*Math.PI/180;   // Pfeil zeigt, wohin der Wind weht
    const dx=Math.sin(a), dy=-Math.cos(a), x0=c.x-dx*len/2, y0=c.y-dy*len/2, x1=c.x+dx*len/2, y1=c.y+dy*len/2;
    const head=()=>{ g.beginPath(); g.moveTo(x1,y1);
      g.lineTo(x1-dx*7+dy*4.5, y1-dy*7-dx*4.5); g.lineTo(x1-dx*7-dy*4.5, y1-dy*7+dx*4.5); g.closePath(); };
    g.lineCap='round'; g.lineJoin='round';
    g.strokeStyle='rgba(255,255,255,.9)'; g.lineWidth=5; g.beginPath(); g.moveTo(x0,y0); g.lineTo(x1,y1); g.stroke(); head(); g.stroke();
    g.strokeStyle=col; g.fillStyle=col; g.lineWidth=2.6; g.beginPath(); g.moveTo(x0,y0); g.lineTo(x1-dx*5,y1-dy*5); g.stroke(); head(); g.fill();
  }
  $('wmTime').textContent=dtf.format(new Date(t*1000))+(offsetH?` (+${offsetH} h)`:' (jetzt)');
  canvas.dataset.shown=shown;
}

/* ---- Bedienfeld */
function status(html){ const el=$('wmStatus'); el.innerHTML=html; el.style.display=html?'block':'none'; }
function setOffset(h){
  offsetH=Math.max(0,Math.min(maxOffset(),Math.round(h)));
  $('wmSlider').value=offsetH; draw();
}
function setHorizon(h){
  horizonH=h; store();
  const mx=maxOffset(); $('wmSlider').max=mx; if(offsetH>mx) offsetH=mx;
  $('wmEnd').textContent=dtf.format(new Date((nowHour()+mx*3600)*1000));
  setOffset(offsetH); clearTimeout(timer); timer=setTimeout(loadMissing,50);
}
function play(){
  if(playTimer){ clearInterval(playTimer); playTimer=null; $('wmPlay').textContent='▶'; return; }
  $('wmPlay').textContent='⏸';
  playTimer=setInterval(()=>setOffset(offsetH>=maxOffset()?0:offsetH+1),450);
}
function setOn(v){
  on=v; store();
  document.body.classList.toggle('windmap-on',on);
  ctrlBtn&&ctrlBtn.classList.toggle('active',on);
  ctrlBtn&&ctrlBtn.setAttribute('aria-pressed',on);
  if(on){ canvas.style.display=''; setHorizon(horizonH); refreshGrid(); }
  else{ canvas.style.display='none'; token++; clearTimeout(timer); if(playTimer) play(); }
}

export function initWindMap(){
  map.createPane('windPane').style.zIndex=350;     // über den Kacheln, unter Routen und Markern
  map.getPane('windPane').style.pointerEvents='none';
  canvas=L.DomUtil.create('canvas','wm-canvas',map.getPane('windPane')); canvas.style.display='none';
  const Ctrl=L.Control.extend({options:{position:'topright'}, onAdd(){
    const d=L.DomUtil.create('div','leaflet-bar wm-ctrl');
    ctrlBtn=L.DomUtil.create('a','',d); ctrlBtn.href='#'; ctrlBtn.role='button'; ctrlBtn.innerHTML='🌬';
    ctrlBtn.title='Windkarte ein/aus'; ctrlBtn.setAttribute('aria-label','Windkarte ein/aus');
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(ctrlBtn,'click',e=>{ L.DomEvent.preventDefault(e); setOn(!on); });
    return d; }});
  new Ctrl().addTo(map);
  $('wmHorizon').innerHTML=HORIZONS.map(([h,t])=>`<option value="${h}">${t}</option>`).join('');
  $('wmHorizon').value=horizonH;
  $('wmHorizon').onchange=()=>setHorizon(+$('wmHorizon').value);
  $('wmSlider').oninput=()=>setOffset(+$('wmSlider').value);
  $('wmPlay').onclick=play;
  $('wmStart').onclick=()=>{
    const h=Math.round((startUnix()-nowHour())/3600);
    if(h<0||h>maxOffset()){ status(`Die geplante Startzeit liegt außerhalb des Zeitraums${h>0?' – Zeitraum vergrößern':''}.`); setTimeout(()=>status(''),3500); return; }
    setOffset(h);
  };
  $('wmClose').onclick=()=>setOn(false);
  $('wmLegend').innerHTML=`<div class="wm-bar" style="background:linear-gradient(90deg,${WIND_STOPS.map(([v,c])=>`${c} ${v/90*100}%`).join(',')})"></div>`+
    `<div class="wm-lbl">${[0,20,40,60,'80+'].map(v=>`<span>${v}</span>`).join('')}<span class="u">km/h</span></div>`;
  // Höhe des Bedienfelds für das Layout bereitstellen (iPhone: Legende darunter)
  if(window.ResizeObserver) new ResizeObserver(()=>document.body.style.setProperty('--wmH',$('windPanel').offsetHeight+'px')).observe($('windPanel'));
  map.on('moveend',()=>{ if(on) refreshGrid(); });
  map.on('zoomstart',()=>{ if(on) canvas.style.visibility='hidden'; });
  map.on('zoomend',()=>{ canvas.style.visibility=''; });
  map.on('resize',()=>{ if(on) draw(); });
  // Stunde weiterzählen, damit „jetzt“ aktuell bleibt
  setInterval(()=>{ if(on){ const mx=maxOffset(); $('wmSlider').max=mx; draw(); } },60e3);
  if(on) setOn(true);
}
