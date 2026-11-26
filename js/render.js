// Radrouten-Radar – Modul „render“
import { state } from './state.js';
import { $ } from './util.js';
import { renderWxMap } from './wxmap.js';
import { label, pinIcon } from './targets.js';
import { renderList, renderTable } from './list.js';
import { renderBest, renderChart, renderWxChart, renderWxStatus } from './charts.js';
import { computeRanking, renderRanking } from './ranking.js';

/* ================================================================ Gesamt-Render */
export function renderAll(){
  state.ranking=computeRanking();   // alle berechneten Routen automatisch bewerten
  const colorMode=$('routeColor').value;
  state.routes.forEach(r=>{
    r.marker.setIcon(pinIcon(r));
    r.marker.bindTooltip(`${r.num} · ${label(r)}`);
    if(r.line){ const sel=r.id===state.selectedId; r.line.setStyle({weight:sel?6:4,opacity:sel?(colorMode!=='route'&&r.wx?.35:.95):.6}); if(sel) r.line.bringToFront(); }
  });
  const any=state.routes.length>0, anyOk=state.routes.some(r=>r.status==='ok');
  $('exportAllBtn').disabled=!anyOk; $('clearBtn').disabled=!any; $('recalcBtn').disabled=!any;
  renderList(); renderTable(); renderChart(); renderWxMap(); renderWxChart(); renderBest(); renderWxStatus(); renderRanking();
}
