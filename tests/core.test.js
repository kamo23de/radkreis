// Tests für die reinen Rechenfunktionen – ausführen mit: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} erwartet ${b} ± ${tol}, erhalten ${a}`);

test('haversine: Leipzig–Berlin ≈ 149 km', () => {
  near(C.haversine({lat: 51.3397, lng: 12.3731}, {lat: 52.5200, lng: 13.4050}) / 1000, 149, 2);
});

test('destination und bearing sind zueinander konsistent', () => {
  const a = {lat: 51, lng: 10};
  for (const brg of [0, 45, 90, 200, 315]) {
    const b = C.destination(a, brg, 100e3);
    near(C.haversine(a, b), 100e3, 1, 'Distanz');
    near(C.bearing(a, b), brg, 0.01, 'Richtung');
  }
});

test('interpolate: Mittelpunkt liegt halbiert auf der Großkreislinie', () => {
  const a = {lat: 48, lng: 11}, b = {lat: 54, lng: 10};
  const m = C.interpolate(a, b, 0.5);
  near(C.haversine(a, m), C.haversine(m, b), 1);
  assert.deepEqual(C.interpolate(a, a, 0.5), a);
});

test('cumDist und idxAt', () => {
  const coords = [[10, 51], [10, 51.01], [10, 51.02]];
  const c = C.cumDist(coords);
  assert.equal(c[0], 0);
  near(c[2], 2 * c[1], 0.01);
  assert.equal(C.idxAt(c, 0), 0);
  assert.equal(C.idxAt(c, c[1] / 2), 1);
  assert.equal(C.idxAt(c, 1e9), 2);
});

test('climb: Rauschen unter der Schwelle zählt nicht', () => {
  assert.deepEqual(C.climb([100, 102, 99, 101, 100]), {up: 0, down: 0});
  assert.deepEqual(C.climb([100, 110, null, 120, 105]), {up: 20, down: 15});
});

test('overlapShare: gleiche Strecke 100 %, versetzte 0 %', () => {
  const out = Array.from({length: 50}, (_, i) => [10 + i * 0.001, 51]);
  near(C.overlapShare(out, out.slice().reverse()), 1, 1e-9);
  const other = out.map(([x, y]) => [x, y + 0.01]);
  assert.equal(C.overlapShare(out, other), 0);
});

test('simplifyCoords behält Endpunkte und entfernt Punkte auf einer Geraden', () => {
  const line = Array.from({length: 100}, (_, i) => [10 + i * 0.001, 51]);
  const s = C.simplifyCoords(line);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[1], line[99]);
});

/* ---- Zeitmodell */
test('elapsedHours: durchfahren ohne Pausen = Strecke / Tempo', () => {
  near(C.elapsedHours(100, {v: 25}), 4, 1e-9);
});

test('elapsedHours: Pausenanteil verlängert nur die Zeit unterwegs', () => {
  // 100 km bei 25 km/h = 4 h Fahrzeit; 20 % Pausen → 5 h unterwegs
  near(C.elapsedHours(100, {v: 25, p: 0.2}), 5, 1e-9);
});

test('elapsedHours: Nachtruhe wird nicht mit dem Pausenanteil aufgebläht', () => {
  // 300 km bei 25 km/h = 12 h Fahrzeit, 10 Fahrstunden/Tag, 20 % Pausen:
  // Tag unterwegs = 12,5 h; Fahrzeit inkl. Pausen = 15 h → Tag 1 voll (24 h), dann 2,5 h → 26,5 h
  // (früher: (24 + 2) / 0,8 = 32,5 h)
  near(C.elapsedHours(300, {v: 25, hpd: 10, p: 0.2}), 26.5, 1e-9);
  // ohne Pausen wie bisher: 24 + 2 = 26 h
  near(C.elapsedHours(300, {v: 25, hpd: 10}), 26, 1e-9);
  // genau ein voller Fahrtag: keine Nachtruhe am Ende
  near(C.elapsedHours(250, {v: 25, hpd: 10}), 10, 1e-9);
});

test('elapsedHours ist monoton in der Distanz', () => {
  let prev = -1;
  for (let d = 0; d <= 1000; d += 7) {
    const t = C.elapsedHours(d, {v: 22, hpd: 8, p: 0.15});
    assert.ok(t >= prev - 1e-9, `nicht monoton bei ${d} km`);
    prev = t;
  }
});

test('movingHoursWithin ist die Umkehrung von elapsedHours', () => {
  for (const [T, hpd, p] of [[6, 24, 0.2], [30, 10, 0.2], [50, 8, 0], [72, 12, 0.1]]) {
    const move = C.movingHoursWithin(T, {hpd, p});
    const v = 400 / move;                       // genau so schnell, dass 400 km in T passen
    const dur = C.elapsedHours(400, {v, hpd, p});
    assert.ok(dur <= T + 1e-9, `Dauer ${dur} > T ${T}`);
  }
  near(C.movingHoursWithin(6, {p: 0.2}), 4.8, 1e-9);
});

test('parseDurationH', () => {
  assert.equal(C.parseDurationH('6'), 6);
  assert.equal(C.parseDurationH('5,5'), 5.5);
  assert.equal(C.parseDurationH('5:30'), 5.5);
  assert.equal(C.parseDurationH(''), null);
  assert.equal(C.parseDurationH('abc'), null);
  assert.equal(C.parseDurationH('6h'), null);
  assert.equal(C.parseDurationH('0'), null);
});

/* ---- Klima-Zeitverschiebung */
const U = (...a) => Date.UTC(...a) / 1000;
test('shiftYears: Tour über Silvester bleibt zusammenhängend', () => {
  const a = U(2026, 11, 31, 22), b = U(2027, 0, 1, 2);
  // alle Punkte um denselben Abstand (bezogen auf das Startjahr 2026 → Vergleichsjahr 2025)
  const sa = C.shiftYears(a, 1), sb = C.shiftYears(b, 1);
  assert.equal(sb - sa, 4 * 3600);
  assert.equal(new Date(sa * 1000).toISOString(), '2025-12-31T22:00:00.000Z');
});

test('shiftYears: 29. Februar wird zum 28. Februar', () => {
  assert.equal(new Date(C.shiftYears(U(2028, 1, 29, 10), 1) * 1000).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.equal(C.shiftYears(12345, 0), 12345);
});

/* ---- Wegeattribute */
test('surfaceClass', () => {
  const t = s => C.surfaceClass(C.parseTags(s));
  assert.equal(t('highway=residential surface=asphalt'), 'paved');
  assert.equal(t('highway=track tracktype=grade2'), 'good');
  assert.equal(t('highway=path surface=sett'), 'rough');
  assert.equal(t('highway=track surface=asphalt smoothness=bad'), 'rough');
  assert.equal(t('highway=path surface=dirt'), 'unpaved');
  assert.equal(t('highway=primary'), 'unknown');
});

test('trafficLevel', () => {
  const t = s => C.trafficLevel(C.parseTags(s));
  assert.equal(t('highway=cycleway'), 0);
  assert.equal(t('highway=residential bicycle_road=yes'), 0);
  assert.equal(t('highway=residential'), 1);
  assert.equal(t('highway=unclassified maxspeed=100'), 2);
  assert.equal(t('highway=tertiary'), 2);
  assert.equal(t('highway=secondary'), 3);
  assert.equal(t('highway=secondary cycleway:right=track'), 2);
});

/* ---- Tempo-Modell (Fahrphysik) */
const RB = C.BIKES.road, riderR = { m: 85, cda: RB.cda, crr: RB.crr.paved };
const kmh = (P, o) => C.speedFor(P, { ...riderR, ...o }, 1.1, RB.vmax / 3.6) * 3.6;

test('speedFor ist die Umkehrung von powerAt', () => {
  for (const [v, o] of [[25, {}], [12, { grade: 0.05 }], [30, { wind: -3 }], [18, { wind: 4, grade: 0.01 }]]) {
    const P = C.powerAt(v / 3.6, { ...riderR, ...o });
    near(kmh(P, o), v, 0.01, JSON.stringify(o));
  }
});

test('Kalibrierung: in der Ebene ohne Wind ergibt sich genau das eingestellte Tempo', () => {
  const P = C.flatPower(25, riderR);
  near(kmh(P, {}), 25, 0.01);
  assert.ok(P > 80 && P < 200, `plausible Leistung, erhalten ${P}`);
});

test('Steigung, Gefälle, Wind und Untergrund wirken in die richtige Richtung', () => {
  const P = C.flatPower(25, riderR);
  assert.ok(kmh(P, { grade: 0.03 }) < kmh(P, { grade: 0.01 }));
  assert.ok(kmh(P, { grade: -0.02 }) > 25);
  assert.ok(kmh(P, { wind: 3 }) < 25 && kmh(P, { wind: -3 }) > 25);
  assert.ok(kmh(P, { crr: RB.crr.unpaved }) < 25);
  near(kmh(P, { grade: -0.15 }), RB.vmax, 1e-6, 'steil bergab: Höchsttempo');
  near(kmh(P, { grade: 0.25 }), 1.1 * 3.6, 1e-6, 'sehr steil: Schiebetempo');
});

test('speedFor: starker Rückenwind schneller als der Wind ist eindeutig lösbar', () => {
  const P = C.flatPower(20, riderR);
  const v = kmh(P, { wind: -8 });   // 28,8 km/h Rückenwind
  assert.ok(v > 20 && v <= RB.vmax);
  near(C.powerAt(v / 3.6, { ...riderR, wind: -8 }), P, 0.5);
});

test('powerFactor: bergauf mehr, bergab weniger Leistung', () => {
  assert.equal(C.powerFactor(0), 1);
  near(C.powerFactor(0.08), 1.6, 1e-9);
  near(C.powerFactor(0.2), 1.6, 1e-9);
  assert.equal(C.powerFactor(-0.05), 0);
  near(C.powerFactor(-0.025), 0.5, 1e-9);
});

const ramp = (n, step, rise, base = 0) => Array.from({ length: n + 1 }, (_, i) => [10 + i * step, 51, base + i * rise]);

test('buildSegments: Länge, Steigung und Richtung', () => {
  const coords = ramp(100, 0.001, 3);            // ~70 m je Punkt, 3 m höher → ≈ 4,3 %
  const cum = C.cumDist(coords), L = cum.at(-1);
  const segs = C.buildSegments(coords, cum);
  near(segs.reduce((a, s) => a + s.len, 0), L, 1e-6);
  assert.equal(segs[0].d0, 0); near(segs.at(-1).d1, L, 1e-6);
  for (const s of segs) { near(s.grade, 300 / L, 0.002); near(s.heading, 90, 1); }
  // Teilstück (z. B. Rückweg ab Wendepunkt)
  const part = C.buildSegments(coords, cum, { from: L / 2, to: L });
  near(part[0].d0, L / 2, 1e-6); near(part.reduce((a, s) => a + s.len, 0), L / 2, 1e-6);
  // ohne Höhen: flach
  assert.ok(C.buildSegments(coords.map(([x, y]) => [x, y]), cum).every(s => s.grade === 0));
});

test('movingProfile: bergauf dauert länger als in der Ebene, ergibt ohne Steigung Strecke ÷ Tempo', () => {
  const flat = ramp(100, 0.001, 0), up = ramp(100, 0.001, 3);
  const P = C.flatPower(25, riderR), o = { P, m: 85, cda: RB.cda, crrOf: () => RB.crr.paved, vmaxKmh: RB.vmax };
  const cf = C.cumDist(flat), tf = C.movingProfile(C.buildSegments(flat, cf), o).at(-1);
  near(tf, cf.at(-1) / 1000 / 25, 1e-4, 'Ebene auf Meereshöhe');
  // in 1500 m Höhe ist die Luft dünner → etwas schneller
  const high = ramp(100, 0.001, 0, 1500);
  assert.ok(C.movingProfile(C.buildSegments(high, C.cumDist(high)), o).at(-1) < tf);
  const cu = C.cumDist(up), tu = C.movingProfile(C.buildSegments(up, cu), o).at(-1);
  assert.ok(tu > tf * 1.5, `bergauf ${tu} h vs. eben ${tf} h`);
  // Gegenwind verlängert, Rückenwind verkürzt
  const segs = C.buildSegments(flat, cf);
  assert.ok(C.movingProfile(segs, { ...o, windOf: () => 3 }).at(-1) > tf);
  assert.ok(C.movingProfile(segs, { ...o, windOf: () => -3 }).at(-1) < tf);
});

test('elapsedFromMoving entspricht elapsedHours', () => {
  near(C.elapsedFromMoving(12, { hpd: 10, p: 0.2 }), C.elapsedHours(300, { v: 25, hpd: 10, p: 0.2 }), 1e-9);
});

test('valueAt interpoliert linear und begrenzt an den Rändern', () => {
  assert.equal(C.valueAt([0, 10, 20], [0, 1, 3], 15), 2);
  assert.equal(C.valueAt([0, 10, 20], [0, 1, 3], -5), 0);
  assert.equal(C.valueAt([0, 10, 20], [0, 1, 3], 99), 3);
});

/* ---- Teilbare Planungs-Links */
const PLAN = {
  start: { lat: 51.339691, lng: 12.373075 }, startName: 'Leipzig', radiusKm: 120, profile: 'fastbike', startUnix: 1795000000,
  speed: '27', hpd: '10', maxDur: '5:30', wxMode: 'clim', paceModel: 'const', mass: '78', retDefault: 'best',
  optWeights: { profile: 20, weather: 60, beauty: 20, efficiency: 0 },
  targets: [{ lat: 51.9, lng: 12.6, name: 'Wittenberg', retMode: 'same', pausePct: 20 },
            { lat: 51.05, lng: 13.74, name: 'Dresden → Altstadt, Straße „ß“ 🚲', retMode: 'none', pausePct: 0 },
            { lat: 50.8, lng: 12.9, name: null, retMode: 'alt', pausePct: 0 }]
};
const roundTrip = p => C.shareToPlan(C.decodeShare(C.encodeShare(C.planToShare(p))));

test('Planungs-Link: Hin- und Rückweg erhält alle Angaben', () => {
  const p = roundTrip(PLAN);
  near(p.start.lat, 51.339691, 1e-5); near(p.start.lng, 12.373075, 1e-5);
  assert.equal(p.startName, 'Leipzig'); assert.equal(p.radiusKm, 120); assert.equal(p.profile, 'fastbike');
  assert.equal(p.startUnix, 1795000000); assert.equal(p.speed, '27'); assert.equal(p.hpd, '10'); assert.equal(p.maxDur, '5:30');
  assert.equal(p.wxMode, 'clim'); assert.equal(p.paceModel, 'const'); assert.equal(p.mass, '78'); assert.equal(p.retDefault, 'best');
  assert.deepEqual(p.optWeights, PLAN.optWeights);
  assert.deepEqual(p.targets.map(t => [t.name, t.retMode, t.pausePct]),
    [['Wittenberg', 'same', 20], ['Dresden → Altstadt, Straße „ß“ 🚲', 'none', 0], [null, 'alt', 0]]);
});

test('Planungs-Link: Standardwerte werden weggelassen und beim Öffnen ergänzt', () => {
  const c = C.planToShare({ start: { lat: 50, lng: 10 }, radiusKm: 100, hpd: '24', mass: '85', wxMode: 'auto', paceModel: 'phys', retDefault: 'none', targets: [{ lat: 50.5, lng: 10.5 }] });
  assert.deepEqual(Object.keys(c).sort(), ['s', 'v', 'z']);
  const p = C.shareToPlan(c);
  assert.equal(p.radiusKm, 100); assert.equal(p.hpd, '24'); assert.equal(p.mass, '85'); assert.equal(p.speed, '25');
  assert.equal(p.maxDur, ''); assert.equal(p.wxMode, 'auto'); assert.equal(p.paceModel, 'phys'); assert.equal(p.optWeights, undefined);
  assert.equal(p.targets[0].retMode, 'none');
});

test('Planungs-Link: nur URL-sichere Zeichen, kompakt', () => {
  const s = C.encodeShare(C.planToShare(PLAN));
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.ok(s.length < 600, `Länge ${s.length}`);
});

test('Planungs-Link: kaputte oder fremde Links werden abgelehnt', () => {
  for (const bad of ['', '!!!', 'abc', 'x'.repeat(9000), C.encodeShare({ v: 2, s: [50, 10] }), C.encodeShare([1, 2]), C.encodeShare('text')])
    assert.equal(C.shareToPlan(C.decodeShare(bad)), null, JSON.stringify(bad.slice(0, 20)));
  assert.equal(C.decodeShare('%%%'), null);
  assert.equal(C.shareToPlan({ v: 1, s: [95, 10] }), null, 'Breite außerhalb');
  assert.equal(C.shareToPlan({ v: 1, s: ['a', 10] }), null);
  assert.equal(C.shareToPlan(null), null);
});

test('Planungs-Link: unsinnige Werte werden begrenzt bzw. verworfen', () => {
  const p = C.shareToPlan({ v: 1, s: [50, 10, 'x'.repeat(500)], r: 99999, p: '<script>', t: 'jetzt', sp: 500, h: 0, d: 'nie', kg: -5,
    rd: 'z', ow: [1, 2], z: [[50, 10, '<b>', 'q', 999], [91, 0], 'kaputt', ...Array.from({ length: 40 }, () => [50.1, 10.1])] });
  assert.equal(p.startName.length, 120);
  assert.equal(p.radiusKm, 100); assert.equal(p.profile, 'trekking'); assert.equal(p.startUnix, null);
  assert.equal(p.speed, '25'); assert.equal(p.hpd, '24'); assert.equal(p.maxDur, ''); assert.equal(p.mass, '85');
  assert.equal(p.retDefault, 'none'); assert.equal(p.optWeights, undefined);
  assert.equal(p.targets[0].name, '<b>'); assert.equal(p.targets[0].retMode, 'none'); assert.equal(p.targets[0].pausePct, 0);
  assert.equal(p.targets.length, C.MAX_SHARED_TARGETS - 2, 'ungültige Ziele verworfen, höchstens 30 gelesen');
});

/* ---- Windkarte */
test('windColor: Farbskala von ruhig bis stürmisch', () => {
  assert.equal(C.windColor(0), C.WIND_STOPS[0][1]);
  assert.equal(C.windColor(-5), C.WIND_STOPS[0][1]);
  assert.equal(C.windColor(25), '#a3cf3c');
  assert.equal(C.windColor(500), C.WIND_STOPS.at(-1)[1]);
  assert.match(C.windColor(12.3), /^#[0-9a-f]{6}$/);
});

test('windGrid: Punktzahl begrenzt, Abstand passt zum Zoom, Punkte im Ausschnitt', () => {
  const box = { s: 50, w: 10, n: 52, e: 14 };
  const g8 = C.windGrid(box, 8), g6 = C.windGrid(box, 6);
  assert.ok(g8.length > g6.length, 'mehr Punkte bei größerem Zoom');
  for (const p of g8) assert.ok(p.lat >= 50 && p.lat <= 52 && p.lng >= 10 && p.lng <= 14);
  assert.ok(C.windGrid({ s: -80, w: -180, n: 80, e: 180 }, 12).length <= 220);
  assert.equal(new Set(g8.map(p => p.key)).size, g8.length, 'Schlüssel eindeutig');
});

test('windGrid: runde Koordinaten – beim Verschieben werden Punkte wiederverwendet', () => {
  const a = C.windGrid({ s: 50, w: 10, n: 52, e: 14 }, 8).map(p => p.key);
  const b = new Set(C.windGrid({ s: 50.3, w: 10.4, n: 52.3, e: 14.4 }, 8).map(p => p.key));
  assert.ok(a.filter(k => b.has(k)).length > a.length * 0.6);
});

test('windGrid: Längengrade jenseits ±180° werden für die Abfrage zurückgerechnet', () => {
  const g = C.windGrid({ s: 0, w: 170, n: 5, e: 190 }, 5);
  assert.ok(g.some(p => p.lng > 180));
  for (const p of g) assert.ok(p.qlng >= -180 && p.qlng < 180);
});
