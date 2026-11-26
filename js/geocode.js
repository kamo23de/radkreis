// Radrouten-Radar – Modul „geocode“
import { $, esc } from './util.js';

/* ================================================================ Geocoding (Nominatim) */
function parseCoords(q){
  const m=q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if(!m) return null;
  const lat=parseFloat(m[1].replace(',','.')), lng=parseFloat(m[2].replace(',','.'));
  return (Math.abs(lat)<=90&&Math.abs(lng)<=180)?{lat,lng}:null;
}
async function geocode(q){
  const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=de&q='+encodeURIComponent(q);
  const r=await fetch(url); if(!r.ok) throw new Error('Suche fehlgeschlagen (HTTP '+r.status+')');
  return (await r.json()).map(x=>({lat:+x.lat,lng:+x.lon,label:x.display_name}));
}
export function setupSearch(inputId,btnId,listId,onPick){
  const inp=$(inputId), list=$(listId);
  const run=async()=>{
    const q=inp.value.trim(); if(!q) return;
    const c=parseCoords(q); if(c){ list.style.display='none'; onPick(c,null); return; }
    list.innerHTML='<li><span class="spin"></span> suche …</li>'; list.style.display='block';
    try{
      const res=await geocode(q);
      if(!res.length){ list.innerHTML='<li>Nichts gefunden.</li>'; return; }
      list.innerHTML=res.map((r,i)=>`<li data-i="${i}">${esc(r.label)}</li>`).join('');
      list.querySelectorAll('li').forEach(li=>li.onclick=()=>{const r=res[+li.dataset.i]; list.style.display='none'; inp.value=''; onPick(r,r.label.split(',').slice(0,2).join(','));});
    }catch(e){ list.innerHTML=`<li>${esc(e.message)}</li>`; }
  };
  $(btnId).onclick=run; inp.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
}
const revQueue=[]; let revBusy=false;   // Nominatim: max. 1 Anfrage/Sekunde
export function reverseName(ll){ return new Promise(res=>{revQueue.push({ll,res}); pumpRev();}); }
async function pumpRev(){
  if(revBusy||!revQueue.length) return; revBusy=true;
  const {ll,res}=revQueue.shift();
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=de&lat=${ll.lat}&lon=${ll.lng}`);
    const j=await r.json(); const a=j.address||{};
    res(a.city||a.town||a.village||a.hamlet||a.municipality||a.suburb||a.county||a.state||(j.display_name||'').split(',')[0]||null);
  }catch{ res(null); }
  setTimeout(()=>{revBusy=false; pumpRev();},1100);
}
