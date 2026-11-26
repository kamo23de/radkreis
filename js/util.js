// Radrouten-Radar – Modul „util“

/* ================================================================ Format-Helfer */
export const nf0=new Intl.NumberFormat('de-DE',{maximumFractionDigits:0});
export const nf1=new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
export const nf2=new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const dtf=new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
export const dtfShort=new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'});
export const tf=new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'});
export const km = m => m>=100e3 ? nf0.format(m/1000) : nf1.format(m/1000);
export const fmtTime = s => { if(!s) return '–'; const h=Math.floor(s/3600), m=Math.round((s%3600)/60); return h? `${h} h ${String(m).padStart(2,'0')}` : `${m} min`; };
export const fmtDT = u => u==null?'–':dtf.format(new Date(u*1000));
export const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const $ = id => document.getElementById(id);
export const isTouch = matchMedia('(pointer:coarse)').matches;
const COMPASS=['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export const compass = d => COMPASS[Math.round(((d%360)+360)%360/22.5)%16];
export const headTxt = hw => hw==null?'–' : hw>=0.5?`${nf0.format(hw)} km/h Gegenwind` : hw<=-0.5?`${nf0.format(-hw)} km/h Rückenwind` : 'windneutral';
