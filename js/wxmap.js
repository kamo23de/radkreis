// Radrouten-Radar – Modul „wxmap“
import { idxAt } from './core.js';
import { state } from './state.js';
import { $, compass, esc, fmtDT, headTxt, nf0, nf1 } from './util.js';
import { map, wxArrowLayer, wxSegLayer } from './map.js';
import { label } from './targets.js';

/* ---- Farben */
function mix(c1,c2,f){ const a=parseInt(c1.slice(1),16), b=parseInt(c2.slice(1),16);
  const ch=s=>Math.round(((a>>s)&255)*(1-f)+((b>>s)&255)*f); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
export function hwColor(hw){ const f=Math.max(-1,Math.min(1,hw/25)); return f>=0?mix('#9aa3ad','#d73027',f):mix('#9aa3ad','#1a9850',-f); }
function rainColor(p){ return p<0.1?'#c9d3df':mix('#7fb3ea','#08306b',Math.min(1,p/4)); }

/* ---- Karte: Windpfeile & eingefärbte Route */
function windIcon(w){
  const size=Math.round(16+Math.min(26,w.ws*0.75)), rot=(w.wd+180)%360;
  const rain=w.p>=0.1?`<span class="rain">💧${nf1.format(w.p)}</span>`:'';
  return L.divIcon({className:'',iconSize:[size,size],iconAnchor:[size/2,size/2],
    html:`<div class="wx" style="width:${size}px;height:${size}px"><svg viewBox="-10 -10 20 20"><g transform="rotate(${rot})"><path d="M0,-9.5 L5.5,0.5 L1.8,-0.2 L1.8,9.5 L-1.8,9.5 L-1.8,-0.2 L-5.5,0.5 Z" fill="${hwColor(w.hw)}" stroke="#fff" stroke-width="1.1"/></g></svg>${rain}</div>`});
}
function wxTooltip(r,s){
  const w=s.wx;
  return `<b>${esc(label(r))}</b> · km ${nf0.format(s.d/1000)}<br>${fmtDT(s.t)}<br>
    Wind ${nf0.format(w.ws)} km/h aus ${compass(w.wd)} (Böen ${nf0.format(w.g)})<br>
    <span style="color:${w.hw>=0?'#d73027':'#1a9850'}">${headTxt(w.hw)}</span><br>
    Regen ${nf1.format(w.p)} mm/h${w.pp!=null?` · ${nf0.format(w.pp)} %`:''} · ${w.tmp!=null?nf0.format(w.tmp)+' °C':''}
    ${w.src==='clim'?`<br><i>Klimamittel (${w.years} J.)</i>`:''}`;
}
export function renderWxMap(){
  wxSegLayer.clearLayers(); wxArrowLayer.clearLayers();
  const mode=$('routeColor').value, sel=state.routes.find(r=>r.id===state.selectedId);
  const withWx=state.routes.filter(r=>r.status==='ok'&&r.samples&&r.wx);
  if(mode!=='route'&&sel&&sel.samples&&sel.wx){
    const S=sel.samples;
    for(let i=0;i<S.length-1;i++){
      const a=S[i].wx,b=S[i+1].wx; if(!a||!b) continue;
      const i0=idxAt(sel.cum,S[i].d), i1=idxAt(sel.cum,S[i+1].d);
      const pts=sel.coords.slice(i0,i1+1).map(p=>[p[1],p[0]]); if(pts.length<2) continue;
      const col=mode==='wind'?hwColor((a.hw+b.hw)/2):rainColor((a.p+b.p)/2);
      L.polyline(pts,{color:col,weight:8,opacity:.95,interactive:false}).addTo(wxSegLayer);
    }
  }
  if($('showArrows').checked){
    const rs=$('arrowsAll').checked?withWx:withWx.filter(r=>r.id===state.selectedId);
    rs.forEach(r=>r.samples.forEach((s,i)=>{
      if(!s.wx) return;
      if(rs.length>1&&i%2) return;   // bei mehreren Routen ausdünnen
      L.marker([s.lat,s.lng],{icon:windIcon(s.wx),interactive:true,keyboard:false,zIndexOffset:-100})
        .bindTooltip(wxTooltip(r,s),{direction:'top',offset:[0,-8]}).addTo(wxArrowLayer);
    }));
  }
  legend.update(withWx.length>0, mode);
}
export const legend=L.control({position:'bottomleft'});
legend.onAdd=function(){ this._div=L.DomUtil.create('div','wxlegend'); this._div.style.display='none'; return this._div; };
legend.update=function(show,mode){
  if(!this._div) return; this._div.style.display=show?'block':'none'; if(!show) return;
  const windBar=`linear-gradient(90deg,${hwColor(-25)},${hwColor(0)},${hwColor(25)})`;
  const rainBar=`linear-gradient(90deg,${rainColor(0)},${rainColor(0.3)},${rainColor(2)},${rainColor(4)})`;
  this._div.innerHTML=(mode==='rain'
    ? `<b>Regen (mm/h)</b><div class="bar" style="background:${rainBar}"></div><div class="lbl"><span>0</span><span>1</span><span>≥ 4</span></div>`
    : `<b>Wind relativ zur Fahrtrichtung</b><div class="bar" style="background:${windBar}"></div><div class="lbl"><span>Rücken 25</span><span>0</span><span>Gegen 25 km/h</span></div>`)
    + `<div style="color:var(--muted);margin-top:3px">Pfeil = Windrichtung, Größe = Stärke, 💧 = Regen</div>`;
};
legend.addTo(map);
