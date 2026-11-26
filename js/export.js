// Radrouten-Radar – Modul „export“
import { simplifyCoords } from './core.js';
import { state } from './state.js';
import { $, esc, fmtDT, headTxt, isTouch, km, nf0, nf1 } from './util.js';
import { profileName } from './routing.js';
import { startUnix } from './weather.js';
import { label } from './targets.js';

/* ================================================================ GPX-Export */
function gpxTrack(r,coords=r.coords){
  const pts=coords.map(p=>`<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${p.length>2&&p[2]!=null?`<ele>${(+p[2]).toFixed(1)}</ele>`:''}</trkpt>`).join('\n');
  const wx=r.wx&&r.wx.avgHead!=null?` – Start ${fmtDT(startUnix())}: ${headTxt(r.wx.avgHead)}, Regen ${nf1.format(r.wx.rainMm)} mm`:'';
  return `<trk><name>${esc(state.startName)} → ${esc(label(r))}${r.retLen?' → '+esc(state.startName):''}</name><desc>${km(r.lengthM)} km, ${nf0.format(r.ascent)} hm ↑ – Profil ${esc(profileName())}${esc(wx)}</desc><type>cycling</type><trkseg>\n${pts}\n</trkseg></trk>`;
}
function gpxDoc(routes,name,coordsFor=r=>r.coords){
  const wpts=[`<wpt lat="${state.start.lat.toFixed(6)}" lon="${state.start.lng.toFixed(6)}"><name>Start: ${esc(state.startName)}</name></wpt>`]
    .concat(routes.map(r=>`<wpt lat="${r.latlng.lat.toFixed(6)}" lon="${r.latlng.lng.toFixed(6)}"><name>${esc(label(r))}</name></wpt>`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Radrouten-Radar (Routing: bikerouter.de / BRouter)" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
${wpts.join('\n')}
${routes.map(r=>gpxTrack(r,coordsFor(r))).join('\n')}
</gpx>`;
}
function download(text,filename,{noShare=false}={}){
  // iPad/iPhone: Teilen-Menü (z. B. an Komoot, Wahoo, Garmin, Dateien); muss direkt im Klick passieren
  if(!noShare && isTouch && navigator.canShare){
    try{
      const file=new File([text],filename,{type:'application/gpx+xml'});
      if(navigator.canShare({files:[file]})){ navigator.share({files:[file],title:filename}).catch(()=>{}); return; }
    }catch{}
  }
  const blob=new Blob([text],{type:'application/gpx+xml'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1000);
}
const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ß/g,'ss').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'route';
export function exportOne(r){ if(r.status!=='ok') return; download(gpxDoc([r],`${state.startName} → ${label(r)}`),`${slug(state.startName)}_${slug(label(r))}_${Math.round(r.lengthM/1000)}km.gpx`); }
export function exportAll(){ const ok=state.routes.filter(r=>r.status==='ok'); if(ok.length) download(gpxDoc(ok,`Routen ab ${state.startName}`),`${slug(state.startName)}_alle-${ok.length}-routen.gpx`); }
/* ---- Übergabe an Komoot / Garmin Connect
   Beide Dienste bieten keine öffentliche Upload-Schnittstelle für Web-Apps an.
   Daher: iPad/iPhone → Teilen-Menü direkt in die jeweilige App; sonst GPX laden + Import-Seite öffnen. */
const SERVICES={
  komoot:{name:'Komoot', appName:'Komoot', web:'https://www.komoot.com/upload',
    shareHint:'Im Teilen-Menü <b>„Komoot“</b> wählen (ggf. unter „Mehr“). Komoot fragt dann, ob die Strecke als geplante Tour übernommen werden soll.',
    webSteps:['GPX-Datei wird gespeichert, die Komoot-Seite öffnet sich in einem neuen Tab.',
      'Dort die Datei hochladen. Falls nicht direkt der Upload erscheint: <b>Neu → GPS-Datei importieren</b>.',
      'Sportart <b>Fahrrad</b> wählen und als <b>geplante Tour</b> speichern – sie erscheint danach auch in der Komoot-App.'],
    note:'Komoot importiert eine Route pro Datei.'},
  garmin:{name:'Garmin Connect', appName:'Connect', web:'https://connect.garmin.com/modern/courses',
    shareHint:'Im Teilen-Menü <b>„Connect“</b> (Garmin Connect) wählen, Kurstyp <b>Radfahren</b> festlegen und speichern. Erscheint „Connect“ nicht, die Datei zuerst in <b>Dateien</b> sichern und von dort teilen – oder den Web-Weg unten nutzen.',
    webSteps:['GPX-Datei wird gespeichert, Garmin Connect öffnet sich bei <b>Kurse</b>.',
      'Unter „Kurs erstellen“ auf <b>Importieren</b> klicken und die Datei wählen.',
      'Aktivitätstyp <b>Radfahren</b> wählen, Kurs speichern und mit <b>An Gerät senden</b> auf Edge/Uhr übertragen.'],
    note:'Wichtig: über <b>Kurse</b> importieren, nicht über „Daten importieren“ – das ist nur für Aktivitäten.'}
};
function serviceGpx(r){
  const coords=simplifyCoords(r.coords);
  const name=`${state.startName} → ${label(r)}`;
  return {text:gpxDoc([r],name,()=>coords), filename:`${slug(state.startName)}_${slug(label(r))}_${Math.round(r.lengthM/1000)}km.gpx`, pts:coords.length};
}
function closeModal(){ $('modal').classList.remove('on'); }
export function sendTo(key,r){
  if(!r||r.status!=='ok') return;
  const svc=SERVICES[key], g=serviceGpx(r);
  let file=null, canShare=false;
  try{ file=new File([g.text],g.filename,{type:'application/gpx+xml'}); canShare=isTouch&&!!navigator.canShare&&navigator.canShare({files:[file]}); }catch{}
  $('modalBox').innerHTML=`
    <h3>Route ${r.num} → ${svc.name}</h3>
    <div class="sub">${esc(state.startName)} → ${esc(label(r))} · ${km(r.lengthM)} km · ${nf0.format(r.ascent)} hm · ${nf0.format(g.pts)} Punkte</div>
    ${canShare?`<div class="btns"><button class="primary" id="mShare">📤 An ${svc.appName}-App übergeben</button></div>
      <div class="hint" style="margin-top:0">${svc.shareHint}</div>
      <div class="sub" style="margin:14px 0 0">Oder über die Website:</div>`:''}
    <ol>${svc.webSteps.map(x=>`<li>${x}</li>`).join('')}</ol>
    <div class="btns">
      <button ${canShare?'':'class="primary"'} id="mWeb">⬇ GPX speichern &amp; ${svc.name} öffnen</button>
      <button id="mClose">Schließen</button>
    </div>
    <div class="note">${svc.note} ${svc.name} bietet keine öffentliche Schnittstelle für einen direkten Upload aus Web-Apps – die Übergabe läuft deshalb über eine GPX-Datei.</div>`;
  $('modal').classList.add('on');
  if(canShare) $('mShare').onclick=()=>{ navigator.share({files:[file],title:g.filename}).then(closeModal).catch(()=>{}); };
  $('mWeb').onclick=()=>{ window.open(svc.web,'_blank','noopener'); download(g.text,g.filename,{noShare:true}); };
  $('mClose').onclick=closeModal;
}
$('modal').addEventListener('click',e=>{ if(e.target.id==='modal') closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

export function bikerouterLink(r){
  const z=r.lengthM>300e3?6:r.lengthM>80e3?8:10;
  return `https://bikerouter.de/#map=${z}/${state.start.lat.toFixed(5)}/${state.start.lng.toFixed(5)}/standard&lonlats=${state.start.lng.toFixed(6)},${state.start.lat.toFixed(6)};${r.latlng.lng.toFixed(6)},${r.latlng.lat.toFixed(6)}&profile=${encodeURIComponent(profileName())}`;
}
