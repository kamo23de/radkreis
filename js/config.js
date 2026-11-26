// Radrouten-Radar – Modul „config“

/* ================================================================ Konstanten */
export const MAX_RADIUS_KM = 2000;
export const SEGMENT_THRESHOLD_M = 250e3;   // ab dieser Luftlinie in Etappen routen
export const LEG_M = 150e3;                 // Ziel-Etappenlänge
export const MAX_PARALLEL = 3;              // gleichzeitige Anfragen an den Routing-Server
export const SERVERS = {
  bikerouter: {name:'bikerouter.de', url:'https://bikerouter.de/brouter-engine/brouter'},
  brouter:    {name:'brouter.de',    url:'https://brouter.de/brouter'}
};
export const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OM_ARCHIVE  = 'https://archive-api.open-meteo.com/v1/archive';
export const OM_VARS_FC  = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,precipitation_probability,temperature_2m';
export const OM_VARS_AR  = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m';
export const CLIM_YEARS  = 5;
export const RAIN_WEIGHT = 2;               // Startzeit-Score: 1 mm Regen ≙ 2 km/h Gegenwind
export const COLORS = ['#e6194b','#1f77b4','#2ca02c','#ff7f0e','#9467bd','#17becf','#d62790','#8c564b','#7f7f00','#1a237e','#00897b','#5d4037'];
export const STORE_KEY = 'radrouten-radar-v1';
