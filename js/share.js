// Radrouten-Radar – Modul „share“: Planung als Link teilen und geteilte Links öffnen.
// Der Link enthält Start, Ziele und die planungsrelevanten Einstellungen (Format: core.js, planToShare).
// Persönliche Einstellungen (Routing-Server, Kartenanzeige) bleiben beim Empfänger, wie sie sind.
import { decodeShare, encodeShare, planToShare, shareToPlan } from './core.js';
import { STORE_KEY } from './config.js';
import { state } from './state.js';
import { $, esc, isTouch } from './util.js';
import { profileName } from './routing.js';
import { startUnix, toLocalInput } from './weather.js';
import { toast } from './targets.js';
import { closeModal } from './export.js';
import { restore } from './storage.js';

const BACKUP_KEY='radrouten-radar-vor-link';   // eigene Planung vor dem Öffnen eines geteilten Links

export function shareUrl(){
  const c=planToShare({
    start:state.start, startName:state.startName, radiusKm:state.radiusKm, profile:profileName(), startUnix:startUnix(),
    speed:$('speed').value, hpd:$('hpd').value, maxDur:$('maxDur').value, wxMode:$('wxMode').value,
    paceModel:$('paceModel').value, mass:$('mass').value, retDefault:$('retDefault').value, optWeights:state.optWeights,
    targets:state.routes.map(r=>({lat:r.latlng.lat, lng:r.latlng.lng, name:r.name, retMode:r.retMode, pausePct:r.pausePct}))
  });
  return location.origin+location.pathname+'#p='+encodeShare(c);
}

export async function sharePlan(){
  if(!state.start) return;
  const url=shareUrl(), n=state.routes.length, title=`Radtour ab ${state.startName}`;
  if(isTouch&&navigator.share){   // iPad/iPhone: Teilen-Menü (Nachrichten, Mail, AirDrop …)
    try{ await navigator.share({title, text:`${title} – ${n} Ziel${n===1?'':'e'} im Radrouten-Radar`, url}); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  try{ await navigator.clipboard.writeText(url); toast('Link kopiert – er enthält Start, Ziele und Einstellungen.'); return; }catch{}
  linkDialog(url);   // kein Zugriff auf die Zwischenablage: Link zum Kopieren anzeigen
}
function linkDialog(url){
  $('modalBox').innerHTML=`
    <h3>Planung als Link</h3>
    <div class="sub">Wer den Link öffnet, sieht deinen Start, die Ziele und die Einstellungen – und kann sie selbst weiterbearbeiten.</div>
    <textarea id="mLink" readonly rows="4" style="width:100%;font:12px/1.4 ui-monospace,monospace;padding:7px;border:1px solid var(--line);border-radius:7px;word-break:break-all">${esc(url)}</textarea>
    <div class="btns"><button class="primary" id="mCopy">Link kopieren</button><button id="mClose">Schließen</button></div>
    <div class="note">Der Link enthält die Koordinaten von Start und Zielen im Klartext.</div>`;
  $('modal').classList.add('on');
  const ta=$('mLink'); ta.focus(); ta.select();
  $('mCopy').onclick=()=>{ ta.select(); let ok=false; try{ ok=document.execCommand('copy'); }catch{} if(ok){ closeModal(); toast('Link kopiert.'); } };
  $('mClose').onclick=closeModal;
}

// Beim Start: geteilten Link aus der Adresse übernehmen. Gibt true zurück, wenn eine Planung geladen wurde.
export function openSharedFromHash(){
  const m=location.hash.match(/^#p=(.*)$/); if(!m) return false;
  history.replaceState(null,'',location.pathname+location.search);   // Neuladen soll spätere Änderungen nicht überschreiben
  const p=shareToPlan(decodeShare(m[1]));
  if(!p){ toast('Der geteilte Link ist ungültig oder unvollständig – deine eigene Planung bleibt geöffnet.'); return false; }
  let prevRaw=null, prev={}, backup=null;
  try{ prevRaw=localStorage.getItem(STORE_KEY); prev=JSON.parse(prevRaw||'null')||{}; backup=localStorage.getItem(BACKUP_KEY); }catch{}
  // Eigene Planung sichern – außer sie ist schon diese Tour (Link erneut geöffnet), sonst ginge die Sicherung verloren
  if(prev.start&&prevRaw&&!sameTour(prev,p)){ backup=prevRaw; try{ localStorage.setItem(BACKUP_KEY,prevRaw); }catch{} }
  const known=[...$('profile').options].some(o=>o.value===p.profile&&o.value!=='__custom');
  const plan={...prev, ...p,
    profile:known?p.profile:'__custom', customProfile:known?(prev.customProfile||''):p.profile,
    startTime:p.startUnix?toLocalInput(new Date(p.startUnix*1000)):''};
  delete plan.startUnix;
  restore(plan);
  const n=p.targets.length, past=p.startUnix&&p.startUnix*1000<Date.now()-3600e3;
  toast(`Geteilte Planung geöffnet: ${p.startName||'Start'}, ${n} Ziel${n===1?'':'e'}${past?' – die Startzeit lag in der Vergangenheit und wurde auf die nächste volle Stunde gesetzt':''}.`,
    backup?{action:restoreOwn, actionLabel:'Meine Planung zurück', ms:15000}:{ms:6000});
  return true;
}
const near5=(a,b)=>a&&b&&Math.abs(a.lat-b.lat)<2e-5&&Math.abs(a.lng-b.lng)<2e-5;
function sameTour(a,b){ // gleicher Start und gleiche Ziele in derselben Reihenfolge
  const ta=a.targets||[], tb=b.targets||[];
  return near5(a.start,b.start)&&ta.length===tb.length&&ta.every((t,i)=>near5(t,tb[i]));
}
function restoreOwn(){
  try{ const b=localStorage.getItem(BACKUP_KEY); if(b){ localStorage.setItem(STORE_KEY,b); localStorage.removeItem(BACKUP_KEY); } }catch{}
  location.reload();
}

export function initShare(){
  $('shareBtn').onclick=sharePlan;
  // Link in denselben Tab eingefügt: neu laden, damit er sauber übernommen wird
  window.addEventListener('hashchange',()=>{ if(/^#p=/.test(location.hash)) location.reload(); });
}
