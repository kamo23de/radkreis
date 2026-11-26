// Radrouten-Radar – Modul „charts“
import { CLIM_YEARS } from './config.js';
import { state } from './state.js';
import { $, compass, dtf, dtfShort, fmtDT, headTxt, km, nf0, nf1, tf } from './util.js';
import { hoverMarker, map } from './map.js';
import { bestStartSeries, climYears, hoursPerDay, maxDurationH, setStartUnix, startUnix, wxInfo, wxMode } from './weather.js';
import { hwColor } from './wxmap.js';
import { label, select } from './targets.js';
import { paceKey, paceModel } from './pace.js';

/* ================================================================ Diagramme */
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`; }
function hoverTo(p){ if(p&&p.lat!=null){ hoverMarker.setLatLng([p.lat,p.lng]); if(!map.hasLayer(hoverMarker)) hoverMarker.addTo(map); } else map.removeLayer(hoverMarker); }

export const chart=new Chart($('chart'),{
  type:'line', data:{datasets:[]},
  options:{
    animation:false, maintainAspectRatio:false, parsing:false, normalized:true,
    interaction:{mode:'nearest',axis:'x',intersect:false},
    scales:{
      x:{type:'linear',title:{display:true,text:'Distanz (km)'},ticks:{callback:v=>nf0.format(v)}},
      y:{title:{display:true,text:'Höhe (m)'},ticks:{callback:v=>nf0.format(v)}}
    },
    elements:{point:{radius:0,hoverRadius:4},line:{tension:0}},
    plugins:{legend:{display:true,labels:{boxWidth:12}},
      tooltip:{callbacks:{title:items=>items.length?`km ${nf1.format(items[0].parsed.x)}`:'', label:it=>`${it.dataset.label}: ${nf0.format(it.parsed.y)} m`}}},
    onHover:(evt,els)=>hoverTo(els.length?chart.data.datasets[els[0].datasetIndex].data[els[0].index]:null),
    onClick:(evt,els)=>{ if(els.length){ const id=chart.data.datasets[els[0].datasetIndex].rid; if(id!==state.selectedId) select(id);} }
  }
});
export function renderChart(){
  const only=$('onlySel').checked;
  let rs=state.routes.filter(r=>r.status==='ok'&&r.coords);
  if(only) rs=rs.filter(r=>r.id===state.selectedId);
  chart.data.datasets=rs.map(r=>{
    const n=r.coords.length, step=Math.max(1,Math.ceil(n/800)), data=[];
    for(let i=0;i<n;i+=step){ const p=r.coords[i]; if(p.length>2&&p[2]!=null) data.push({x:r.cum[i]/1000,y:+p[2],lat:p[1],lng:p[0]}); }
    const last=r.coords[n-1]; if((n-1)%step&&last.length>2) data.push({x:r.cum[n-1]/1000,y:+last[2],lat:last[1],lng:last[0]});
    const sel=r.id===state.selectedId;
    const turnKm=r.retLen?r.outLen/1000:null;
    return {label:`${r.num} · ${label(r)} (${km(r.lengthM)} km${r.retLen?' inkl. Rückweg':''}, ${nf0.format(r.ascent)} hm)`, rid:r.id, data,
      segment:turnKm?{borderDash:ctx=>ctx.p0.parsed.x>=turnKm?[6,4]:undefined}:undefined,
      borderColor:sel||rs.length===1?r.color:hexA(r.color,.55), backgroundColor:hexA(r.color,.15),
      borderWidth:sel?2.5:1.5, fill:sel?'origin':false, order:sel?0:1};
  });
  chart.update();
}

/* ---- Wind & Regen entlang der ausgewählten Route */
export const wxChart=new Chart($('wxChart'),{
  type:'bar', data:{datasets:[]},
  options:{
    animation:false, maintainAspectRatio:false,
    interaction:{mode:'nearest',axis:'x',intersect:false},
    scales:{
      x:{type:'linear',title:{display:true,text:'Distanz (km)'},ticks:{callback:v=>nf0.format(v)}},
      y:{title:{display:true,text:'Wind (km/h)'},ticks:{callback:v=>nf0.format(v)}},
      y2:{position:'right',min:0,suggestedMax:2,title:{display:true,text:'Regen (mm/h)'},grid:{drawOnChartArea:false}}
    },
    plugins:{
      legend:{labels:{boxWidth:12}},
      title:{display:true,text:'',font:{weight:'600'}},
      tooltip:{callbacks:{
        title:items=>{ const p=items[0]&&items[0].raw; return p?`km ${nf0.format(p.x)} · ${fmtDT(p.t)}`:''; },
        label:it=>{ const y=it.parsed.y; const ds=it.dataset.key;
          if(ds==='hw') return y>=0?`Gegenwind ${nf1.format(y)} km/h`:`Rückenwind ${nf1.format(-y)} km/h`;
          if(ds==='rain') return `Regen ${nf1.format(y)} mm/h${it.raw.pp!=null?` (${nf0.format(it.raw.pp)} %)`:''}`;
          if(ds==='ws') return `Wind ${nf0.format(y)} km/h aus ${compass(it.raw.wd)}`;
          if(ds==='tmp') return `Temperatur ${nf0.format(y)} °C`;
          if(ds==='v') return `Tempo (Modell) ${nf1.format(y)} km/h`;
          return `${it.dataset.label}: ${nf0.format(y)} km/h`; }
      }}
    },
    onHover:(evt,els)=>hoverTo(els.length?wxChart.data.datasets[els[0].datasetIndex].data[els[0].index]:null)
  }
});
export function renderWxChart(){
  const r=state.routes.find(x=>x.id===state.selectedId);
  const S=r&&r.samples?r.samples.filter(s=>s.wx):[];
  $('wxEmpty').style.display=S.length?'none':'flex';
  if(r&&r.status==='ok'&&!S.length) $('wxEmpty').textContent=wxInfo.state==='loading'?'Wetterdaten werden geladen …':'Für diese Route liegen (noch) keine Wetterdaten vor.';
  else if(!S.length) $('wxEmpty').textContent='Ziel setzen und auswählen, um Wind & Regen entlang der Route zu sehen.';
  const P=s=>({x:s.d/1000,t:s.t,lat:s.lat,lng:s.lng,wd:s.wx.wd,pp:s.wx.pp});
  wxChart.data.datasets=S.length?[
    {key:'hw',label:'Gegenwind (+) / Rückenwind (−)',type:'bar',data:S.map(s=>({...P(s),y:+s.wx.hw.toFixed(1)})),backgroundColor:S.map(s=>hwColor(s.wx.hw)),yAxisID:'y',barPercentage:.9,categoryPercentage:1,order:3},
    {key:'ws',label:'Windstärke',type:'line',data:S.map(s=>({...P(s),y:s.wx.ws})),borderColor:'#37474f',backgroundColor:'#37474f',borderWidth:2,pointRadius:0,yAxisID:'y',order:1},
    {key:'g',label:'Böen',type:'line',data:S.map(s=>({...P(s),y:s.wx.g})),borderColor:'#90a4ae',backgroundColor:'#90a4ae',borderDash:[5,4],borderWidth:1.5,pointRadius:0,yAxisID:'y',order:2},
    {key:'rain',label:'Regen',type:'bar',data:S.map(s=>({...P(s),y:s.wx.p})),backgroundColor:'rgba(30,111,208,.6)',yAxisID:'y2',barPercentage:.6,categoryPercentage:1,order:4}
  ]:[];
  if(S.length>1&&paceModel()==='phys'&&S.every(s=>s.mt!=null)){ // Ø-Tempo zwischen benachbarten Stützpunkten
    const vAt=i=>{ const a=S[Math.max(0,i-1)], b=S[Math.max(1,i)]; const h=b.mt-a.mt; return h>0?(b.d-a.d)/1000/h:null; };
    wxChart.data.datasets.push({key:'v',label:'Tempo (Modell)',type:'line',data:S.map((s,i)=>({...P(s),y:vAt(i)})),borderColor:'#7b1fa2',backgroundColor:'#7b1fa2',borderWidth:2,pointRadius:0,stepped:'before',yAxisID:'y',order:0});
  }
  wxChart.options.plugins.title.text=S.length?`${r.num} · ${label(r)} – Start ${fmtDT(startUnix())}, Ankunft ${fmtDT(r.wx.arrival)}${r.wx.climShare>0?' (Klimamittel)':''}`:'';
  wxChart.update();
}

/* ---- Startzeit-Vergleich */
let bestCache={key:null,data:null};
export const bestChart=new Chart($('bestChart'),{
  type:'bar', data:{datasets:[]},
  options:{
    animation:false, maintainAspectRatio:false,
    interaction:{mode:'nearest',axis:'x',intersect:false},
    scales:{
      x:{type:'linear',ticks:{maxTicksLimit:8,callback:v=>{const d=new Date(v); return d.getHours()===0?dtfShort.format(d):tf.format(d);}}},
      y:{title:{display:true,text:'Ø Wind (+ gegen)'},ticks:{callback:v=>nf0.format(v)}},
      y2:{position:'right',min:0,suggestedMax:2,title:{display:true,text:'Regen (mm)'},grid:{drawOnChartArea:false}}
    },
    plugins:{
      legend:{labels:{boxWidth:10,font:{size:11}}},
      title:{display:true,text:'Startzeit-Vergleich (Klick = übernehmen)',font:{weight:'600'}},
      tooltip:{callbacks:{
        title:items=>items.length?'Start '+dtf.format(new Date(items[0].parsed.x)):'',
        label:it=>it.dataset.key==='rain'?`Regen ${nf1.format(it.parsed.y)} mm`:it.dataset.key==='now'?'aktuelle Wahl':`Ø ${headTxt(it.parsed.y)}`
      }}
    },
    onClick:(evt,els)=>{ if(els.length){ const p=bestChart.data.datasets[els[0].datasetIndex].data[els[0].index]; if(p) setStartUnix(p.x/1000); } }
  }
});
export function renderBest(){
  const r=state.routes.find(x=>x.id===state.selectedId);
  const box=$('bestStart'), empty=$('bestEmpty');
  let series=null;
  if(r&&r.samples&&r.wx){
    const k=[r.id,r.lengthM,paceKey(),hoursPerDay(),maxDurationH(),r.pausePct||0,wxMode(),wxInfo.at].join('|');
    if(bestCache.key!==k){ bestCache={key:k,data:bestStartSeries(r)}; }
    series=bestCache.data;
  }
  if(!series||series.length<2){
    bestChart.data.datasets=[]; bestChart.update();
    empty.style.display='flex';
    empty.textContent=wxMode()==='clim'?'Startzeit-Vergleich nur mit Vorhersagedaten.':
      (r&&r.wx?'Route ist zu lang für den 16-Tage-Vorhersagehorizont – kein Startzeit-Vergleich möglich.':'');
    box.innerHTML=''; return;
  }
  empty.style.display='none';
  const cur=startUnix(), best=series.reduce((a,b)=>b.score<a.score?b:a);
  const curPt=series.find(p=>Math.abs(p.t-cur)<1800);
  bestChart.data.datasets=[
    {key:'head',label:'Ø Wind',type:'line',data:series.map(p=>({x:p.t*1000,y:p.head})),borderColor:'#c62828',backgroundColor:'#c62828',pointRadius:0,borderWidth:1.8,yAxisID:'y',order:1,
     segment:{borderColor:ctx=>ctx.p1.parsed.y<0?'#1a9850':'#c62828'}},
    {key:'rain',label:'Regen',type:'bar',data:series.map(p=>({x:p.t*1000,y:p.rain})),backgroundColor:'rgba(30,111,208,.55)',yAxisID:'y2',barPercentage:1,categoryPercentage:1,order:3},
    {key:'now',label:'gewählt',type:'scatter',data:curPt?[{x:curPt.t*1000,y:curPt.head}]:[],backgroundColor:'#111',pointRadius:5,yAxisID:'y',order:0}
  ];
  bestChart.update();
  box.innerHTML=`🕑 <b>Günstigste Startzeit</b> für Route ${r.num} (nächste ${Math.round((series[series.length-1].t-series[0].t)/86400)} Tage): `+
    `<a href="#" id="useBest">${fmtDT(best.t)}</a> – Ø ${headTxt(best.head)}, ${nf1.format(best.rain)} mm Regen.`;
  $('useBest').onclick=e=>{e.preventDefault(); setStartUnix(best.t);};
}
export function renderWxStatus(){
  const el=$('wxStatus'); el.classList.toggle('err',wxInfo.state==='error');
  if(wxInfo.state==='loading') el.innerHTML='<span class="spin"></span> Wetterdaten werden geladen (Open-Meteo) …';
  else if(wxInfo.state==='error') el.textContent='⚠ Wetter: '+wxInfo.msg;
  else if(wxInfo.state==='ok') el.innerHTML=`Wetter: Open-Meteo, Stand ${tf.format(new Date(wxInfo.at))}. `+
    (wxMode()==='clim'?`Klimamittel ${climYears().slice(-1)[0]}–${climYears()[0]} (ERA5).`:(wxInfo.clim?`Jenseits des 16-Tage-Horizonts: Klimamittel ${CLIM_YEARS} Jahre (ERA5).`:'Vorhersage bis 16 Tage.'));
  else el.textContent='Wetter wird geladen, sobald eine Route berechnet ist.';
}
