// Radrouten-Radar – Modul „map“
import { $ } from './util.js';

/* ================================================================ Karte */
export const map = L.map('map',{zoomControl:true, worldCopyJump:true}).setView([51.1,10.4],6);
const baseLayers = {
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'}),
  'CyclOSM (Rad)': L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap-Mitwirkende, Stil: <a href="https://www.cyclosm.org">CyclOSM</a>'}),
  'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenStreetMap-Mitwirkende, SRTM | Stil: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'})
};
baseLayers['OpenStreetMap'].addTo(map);
L.control.layers(baseLayers,null,{position:'topright'}).addTo(map);
L.control.scale({imperial:false}).addTo(map);
map.attributionControl.addAttribution('Routing: <a href="https://bikerouter.de">bikerouter.de</a> / BRouter · Wetter: <a href="https://open-meteo.com">Open-Meteo.com</a> (CC BY 4.0)');

export const hoverMarker = L.circleMarker([0,0],{radius:7,color:'#fff',weight:2,fillColor:'#111',fillOpacity:1,interactive:false});
export const wxSegLayer = L.layerGroup().addTo(map);     // eingefärbte Routenabschnitte
export const wxArrowLayer = L.layerGroup().addTo(map);   // Windpfeile + Regen

export function setMsg(t){ const el=$('mapMsg'); el.style.display=t?'block':'none'; if(t) el.textContent=t; }
