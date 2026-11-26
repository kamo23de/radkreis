// Tests für die reinen Rechenfunktionen – ausführen mit: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

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
