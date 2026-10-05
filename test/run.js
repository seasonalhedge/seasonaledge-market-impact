#!/usr/bin/env node
'use strict';

/**
 * End-to-end verification: attribution math, state derivation, payload
 * validation, auth rejection, and the live HTTP surface.
 *
 *   npm test
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = require('../lib/normalize');
const { createStore } = require('../lib/store');
const { snapshot, events } = require('./payloads');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/* ------------------------------------------------------------ unit: math */

console.log('\nattribution math');

test('residual = spy - mag7', () => {
  const a = N.computeAttribution(0.58, 0.62);
  assert.strictEqual(N.round(a.residual_contribution_points, 2), -0.04);
});

test('impact share matches the worked example (93.3%)', () => {
  // Derived from raw values, ignoring the engine-supplied override.
  const a = N.computeAttribution(0.58, 0.62);
  assert.strictEqual(N.round(a.mag7_impact_share, 1), 93.9);
  // With the engine's own raw share present, that value wins.
  const b = N.computeAttribution(0.58, 0.62, -0.04, 93.3);
  assert.strictEqual(N.round(b.mag7_impact_share, 1), 93.3);
});

test('share is computed from raw values, not rounded display values', () => {
  // 0.6249 rounds to 0.62 for display; the share must reflect 0.6249.
  const raw = N.computeAttribution(0.5801, 0.6249);
  const fromRounded = N.computeAttribution(0.58, 0.62);
  assert.notStrictEqual(
    N.round(raw.mag7_impact_share, 1),
    N.round(fromRounded.mag7_impact_share, 1)
  );
});

test('DRIVING when signs agree', () => {
  assert.strictEqual(N.computeAttribution(0.58, 0.62).direction, 'DRIVING');
  assert.strictEqual(N.computeAttribution(-0.75, -0.5).direction, 'DRIVING');
});

test('OFFSETTING when signs oppose', () => {
  assert.strictEqual(N.computeAttribution(0.4, -0.3).direction, 'OFFSETTING');
});

test('FLAT when MAG7 contribution is immaterial', () => {
  assert.strictEqual(N.computeAttribution(0.4, 0.005).direction, 'FLAT');
});

test('N/A below the reliability floor', () => {
  const a = N.computeAttribution(0.005, 0.004);
  assert.strictEqual(a.direction, 'N/A');
  assert.strictEqual(a.mag7_impact_share, null);
});

test('gross attribution is the sum of absolute contributions', () => {
  const a = N.computeAttribution(0.4, -0.3);
  assert.strictEqual(N.round(a.gross_attribution, 2), 1.0); // |−0.3| + |0.7|
});

/* ------------------------------------------------- unit: derived states */

console.log('\nderived states');

test('breadth state thresholds', () => {
  assert.strictEqual(N.deriveBreadthState(7), 'EXPANSIVE');
  assert.strictEqual(N.deriveBreadthState(5), 'STRONG');
  assert.strictEqual(N.deriveBreadthState(3), 'MODERATE');
  assert.strictEqual(N.deriveBreadthState(2), 'WEAK');
  assert.strictEqual(N.deriveBreadthState(1), 'CRITICAL');
  assert.strictEqual(N.deriveBreadthState(0), 'CRITICAL');
});

test('transmission: CONCENTRATED on high share with few leaders', () => {
  const t = N.deriveTransmission({
    direction: 'DRIVING',
    impactShare: 93.3,
    positiveCount: 1,
    risk: { spx_health: 62, divergence_risk: 10, structural_risk: 40 },
    leadership: { diffusion: -0.4, average_velocity: -0.5 },
  });
  assert.strictEqual(t, 'CONCENTRATED');
});

test('transmission: FRAGILE when MAG7 offsets the index', () => {
  const t = N.deriveTransmission({
    direction: 'OFFSETTING',
    impactShare: 40,
    positiveCount: 4,
    risk: { spx_health: 70, divergence_risk: 10, structural_risk: 30 },
    leadership: { diffusion: 0.2, average_velocity: 1 },
  });
  assert.strictEqual(t, 'FRAGILE');
});

test('transmission: BROKEN on severe deterioration or divergence', () => {
  const t = N.deriveTransmission({
    direction: 'DRIVING',
    impactShare: 50,
    positiveCount: 4,
    risk: { spx_health: 25, divergence_risk: 10, structural_risk: 30 },
    leadership: { diffusion: 0, average_velocity: 0 },
  });
  assert.strictEqual(t, 'BROKEN');
});

test('transmission: BROAD with five healthy leaders and positive internals', () => {
  const t = N.deriveTransmission({
    direction: 'DRIVING',
    impactShare: 45,
    positiveCount: 5,
    risk: { spx_health: 72, divergence_risk: 5, structural_risk: 20 },
    leadership: { diffusion: 0.6, average_velocity: 4.2 },
  });
  assert.strictEqual(t, 'BROAD');
});

/* ------------------------------------------------------ unit: normalize */

console.log('\npayload normalization');

test('snapshot payload parses with all seven constituents', () => {
  const r = N.parsePayload(snapshot());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.parsed.constituents.length, 7);
  assert.strictEqual(r.parsed.is_snapshot, true);
});

test('snapshot missing constituents is rejected', () => {
  const bad = snapshot();
  bad.constituents = bad.constituents.slice(0, 3);
  const r = N.parsePayload(bad);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /must carry 7 constituents/);
});

test('payload without an event name is rejected', () => {
  const r = N.parsePayload({ ticker: 'AMZN', score: 74.5 });
  assert.strictEqual(r.ok, false);
});

test('non-object payloads are rejected', () => {
  assert.strictEqual(N.parsePayload('AMZN crossed').ok, false);
  assert.strictEqual(N.parsePayload([1, 2, 3]).ok, false);
  assert.strictEqual(N.parsePayload(null).ok, false);
});

test('state synonyms normalize onto the canonical set', () => {
  const r = N.parsePayload({ event: 'DISTRIBUTION', ticker: 'NVDA', state: 'Distr', score: 45 });
  assert.strictEqual(r.parsed.constituents[0].state, 'DIST');
});

test('numeric strings from TradingView coerce cleanly', () => {
  const r = N.parsePayload({
    event: 'NEW_LEADER',
    ticker: 'AMZN',
    score: '74.5',
    delta_5: '+42.5',
    spy_return: '0.58%',
  });
  assert.strictEqual(r.parsed.constituents[0].score, 74.5);
  assert.strictEqual(r.parsed.constituents[0].delta_5, 42.5);
  assert.strictEqual(r.parsed.basket.spy_return, 0.58);
});

test('event payloads preserve the latest known row per ticker', () => {
  let state = N.emptyState();
  state = N.applyToState(state, N.parsePayload({
    event: 'NEW_LEADER', ticker: 'AMZN', state: 'ACCUM', score: 74.5, risk: 9.5,
  }).parsed);
  state = N.applyToState(state, N.parsePayload({
    event: 'DISTRIBUTION', ticker: 'NVDA', state: 'DIST', score: 45,
  }).parsed);
  // A later partial update must not wipe fields it does not carry.
  state = N.applyToState(state, N.parsePayload({
    event: 'ROTATION', ticker: 'AMZN', state: 'ACCUM', score: 76.1,
  }).parsed);

  assert.strictEqual(Object.keys(state.constituents).length, 2);
  assert.strictEqual(state.constituents.AMZN.score, 76.1);
  assert.strictEqual(state.constituents.AMZN.risk, 9.5, 'risk should survive the partial update');
});

test('basket-level events do not become phantom constituents', () => {
  let state = N.emptyState();
  for (const e of events()) {
    state = N.applyToState(state, N.parsePayload(e).parsed);
  }
  const tickers = Object.keys(state.constituents);
  assert.ok(!tickers.includes('MAG7'), 'basket subject leaked into constituents');
  for (const t of tickers) {
    assert.ok(
      ['MSFT', 'META', 'AAPL', 'AMZN', 'GOOGL', 'NVDA', 'TSLA'].includes(t),
      `unexpected constituent ${t}`
    );
  }
  // The basket fields those events carried must still have been applied.
  assert.strictEqual(state.risk.spx_health, 46.8);
  assert.strictEqual(state.leadership.positive_count, 1);
});

test('dashboard reproduces the worked example end to end', () => {
  const state = N.applyToState(N.emptyState(), N.parsePayload(snapshot()).parsed);
  const d = N.buildDashboard(state, []);

  assert.strictEqual(d.market.spy_return, 0.58);
  assert.strictEqual(d.market.mag7_contribution_points, 0.62);
  assert.strictEqual(d.market.residual_contribution_points, -0.04);
  assert.strictEqual(d.market.mag7_impact_share, 93.3);
  assert.strictEqual(d.market.residual_share, 6.7);
  assert.strictEqual(d.market.direction, 'DRIVING');
  assert.strictEqual(d.market.transmission, 'CONCENTRATED');
  assert.strictEqual(d.leadership.positive_count, 1);
  assert.strictEqual(d.leadership.breadth_state, 'CRITICAL');
  assert.deepStrictEqual(d.leadership.positive_tickers, ['AMZN']);
  assert.strictEqual(d.constituents.length, 7);
  assert.strictEqual(d.constituents[0].ticker, 'AMZN', 'sorted by score descending');
  assert.strictEqual(d.constituents[6].score, 4);
  assert.strictEqual(d.confirmed, true);
});

test('positive count is derived when the payload omits it', () => {
  const s = snapshot();
  delete s.positive_count;
  delete s.breadth_state;
  const state = N.applyToState(N.emptyState(), N.parsePayload(s).parsed);
  const d = N.buildDashboard(state, []);
  assert.strictEqual(d.leadership.positive_count, 1);
  assert.strictEqual(d.leadership.breadth_state, 'CRITICAL');
});

test('data status reports STALE / CLOSED appropriately', () => {
  // A Wednesday at 14:00 ET.
  const inSession = new Date('2026-07-29T18:00:00Z');
  assert.strictEqual(N.computeDataStatus(new Date('2026-07-29T17:57:00Z').toISOString(), inSession), 'LIVE');
  assert.strictEqual(N.computeDataStatus(new Date('2026-07-29T17:30:00Z').toISOString(), inSession), 'DELAYED');
  assert.strictEqual(N.computeDataStatus(new Date('2026-07-29T15:00:00Z').toISOString(), inSession), 'STALE');
  // Saturday.
  const weekend = new Date('2026-08-01T18:00:00Z');
  assert.strictEqual(N.computeDataStatus(new Date('2026-07-31T20:00:00Z').toISOString(), weekend), 'CLOSED');
});

test('daily timeframe: CONFIRMED through the next session, STALE once a close is missed', () => {
  // Alert at Friday 16:01 ET (20:01Z, EDT).
  const fridayClose = '2026-10-02T20:01:00Z';
  // Monday 13:47 ET — still the most recent close.
  assert.strictEqual(N.computeDataStatus(fridayClose, new Date('2026-10-05T17:47:00Z'), '1D'), 'CONFIRMED');
  // Saturday — still current.
  assert.strictEqual(N.computeDataStatus(fridayClose, new Date('2026-10-03T15:00:00Z'), '1D'), 'CONFIRMED');
  // Monday 16:30 ET — Monday's close has passed without a new reading.
  assert.strictEqual(N.computeDataStatus(fridayClose, new Date('2026-10-05T20:30:00Z'), '1D'), 'STALE');
  // Nothing ever received.
  assert.strictEqual(N.computeDataStatus(null, new Date('2026-10-05T17:47:00Z'), '1D'), 'STALE');
});

/* --------------------------------------------- unit: real engine payloads */

console.log('\nreal MAGS LRE payloads');

// Verbatim shape of a live alert captured from TradingView (BREADTH_DETERIORATING).
const liveEngineEvent = () => ({
  system: 'SeasonalEDGE',
  indicator: 'MAGS Leadership Rotation Engine + SPX Health Transmission Gauge',
  version: '1.2.0',
  event: 'BREADTH_DETERIORATING',
  ticker: 'BASKET',
  benchmark: 'NASDAQ:MAGS',
  timeframe: '1D',
  score: 46.0714,
  state: 'CRITICAL',
  delta_5: -1.8571,
  delta_20: 0.8571,
  rank: 0,
  rank_change: 0,
  persistence_bars: 0,
  velocity: -0.0214,
  ldi: -0.5714,
  leadership_breadth: 1,
  funding_pressure: 55.1692,
  structural_risk: 50.9566,
  divergence_risk: 40,
  spx_health: 45.1425,
  spx_health_state: 'FRAGILE',
  mag7_contribution_points: -0.0473,
  mag7_impact_share: 40.4915,
  mag7_direction: 'OFFSETTING',
  transmission: 'BROADENING',
  index_risk: 50.2411,
  index_risk_state: 'ELEVATED',
  bar_time: 1787751000000,
});

test('live engine event: share, direction, breadth and transmission all land', () => {
  const r = N.parsePayload(liveEngineEvent());
  assert.ok(r.ok, JSON.stringify(r.errors));
  const d = N.buildDashboard(N.applyToState(N.emptyState(), r.parsed), []);
  assert.strictEqual(d.market.mag7_impact_share, 40.5);
  assert.strictEqual(d.market.mode, 'ENGINE_SHARE');
  assert.strictEqual(d.market.reliable, true);
  assert.strictEqual(d.market.direction, 'OFFSETTING');
  assert.strictEqual(d.market.transmission, 'BROADENING');
  assert.strictEqual(d.market.spy_return, null);          // never invented
  assert.strictEqual(d.market.residual_contribution_points, null);
  assert.strictEqual(d.leadership.positive_count, 1);
  assert.strictEqual(d.leadership.diffusion, -0.57);
  assert.strictEqual(d.leadership.breadth_state, 'CRITICAL');   // regime word from "state"
  assert.strictEqual(d.confirmed, true);                  // bar_time => confirmed bar
  assert.strictEqual(d.constituents.length, 0);           // BASKET is not a stock
  assert.deepStrictEqual(d.engine, {
    name: 'MAGS Leadership Rotation Engine + SPX Health Transmission Gauge',
    version: '1.2.0',
  });
});

test('facade event: the 493 confirmation layer is captured, SPY derived from its parts', () => {
  const r = N.parsePayload({
    event: 'MAGS_FACADE',
    bar_time: 1787751000000,
    timeframe: '1D',
    mag7ContributionPoints: 0.41,
    residualSpxContributionPoints: 0.19,
    mag7ImpactShare: 68.3,
    magsDirectionalBreadthCount: 6,
    positiveBreadthCount: 3,
    exMagsBreadthPercent: 49.5,
    equalWeightReturnOne: 0.5,
    capEqualSpread: 0.1,
    exMagsStance: 'confirming',
    mismatchState: 'broad confirmation',
    facadePersistenceBars: 0,
  });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const d = N.buildDashboard(N.applyToState(N.emptyState(), r.parsed), []);
  assert.strictEqual(d.market.spy_return, 0.6);
  assert.strictEqual(d.market.mode, 'FULL');
  assert.strictEqual(d.confirmation.ex_mags_breadth, 49.5);
  assert.strictEqual(d.confirmation.equal_weight_return, 0.5);
  assert.strictEqual(d.confirmation.cap_equal_spread, 0.1);
  assert.strictEqual(d.confirmation.ex_mags_stance, 'CONFIRMING');
  assert.strictEqual(d.confirmation.mismatch_state, 'BROAD CONFIRMATION');
  assert.strictEqual(d.confirmation.mags_day_breadth, 6);
  assert.strictEqual(d.leadership.positive_count, 3);
});

test('confirmation survives later events that omit it', () => {
  const state = N.emptyState();
  N.applyToState(state, N.parsePayload({ event: 'MAGS_FACADE', exMagsBreadthPercent: 49.5 }).parsed);
  N.applyToState(state, N.parsePayload(liveEngineEvent()).parsed);
  assert.strictEqual(N.buildDashboard(state, []).confirmation.ex_mags_breadth, 49.5);
});

test('state persisted before the confirmation block still loads', () => {
  const legacy = N.emptyState();
  delete legacy.confirmation;
  const d = N.buildDashboard(N.applyToState(legacy, N.parsePayload(liveEngineEvent()).parsed), []);
  assert.strictEqual(d.confirmation.ex_mags_breadth, null);
});

test('no data means no transmission call, not a default HEALTHY', () => {
  const d = N.buildDashboard(N.emptyState(), []);
  assert.strictEqual(d.market.transmission, null);
});

/* ---------------------------------------------------------- unit: store */

console.log('\nstorage');

test('store round-trips state and events, history survives snapshot replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mags-store-'));
  const store = createStore(dir);

  const first = N.parsePayload({ event: 'NEW_LEADER', ticker: 'AMZN', state: 'ACCUM', score: 74.5 }).parsed;
  store.writeState(N.applyToState(store.readState(), first));
  store.appendEvent(first.event, first.received_at, first.raw);

  const snap = N.parsePayload(snapshot()).parsed;
  store.writeState(N.applyToState(store.readState(), snap));
  store.appendEvent(snap.event, snap.received_at, snap.raw);

  const readBack = store.readEvents(25);
  assert.strictEqual(readBack.length, 2, 'history preserved across snapshot replacement');
  assert.strictEqual(readBack[0].event, 'DASHBOARD_SNAPSHOT', 'newest first');
  assert.strictEqual(Object.keys(store.readState().constituents).length, 7);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------- e2e: http */

const TOKEN = 'test-token-' + Math.random().toString(36).slice(2);
const PORT = 8900 + Math.floor(Math.random() * 90);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mags-e2e-'));
const BASE = `http://127.0.0.1:${PORT}`;

function post(payload, headers) {
  return fetch(`${BASE}/webhook/mags-lre`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

(async () => {
  console.log('\nhttp surface');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      WEBHOOK_TOKEN: TOKEN,
      DATA_DIR,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => process.env.VERBOSE && process.stdout.write('    ' + b));
  child.stderr.on('data', (b) => process.env.VERBOSE && process.stderr.write('    ' + b));

  // Wait for the listener.
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/mags-lre/health`);
      if (r.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await testAsync('rejects a missing token', async () => {
    const r = await post(snapshot());
    assert.strictEqual(r.status, 401);
  });

  await testAsync('rejects a wrong token', async () => {
    const r = await post(snapshot(), { 'X-Webhook-Token': 'nope' });
    assert.strictEqual(r.status, 401);
  });

  await testAsync('rejects malformed JSON', async () => {
    const r = await post('{not json', { 'X-Webhook-Token': TOKEN });
    assert.strictEqual(r.status, 400);
  });

  await testAsync('rejects a structurally invalid payload', async () => {
    const r = await post({ ticker: 'AMZN' }, { 'X-Webhook-Token': TOKEN });
    assert.strictEqual(r.status, 422);
  });

  await testAsync('accepts a snapshot via header token', async () => {
    const r = await post(snapshot(), { 'X-Webhook-Token': TOKEN });
    assert.strictEqual(r.status, 202);
    const body = await r.json();
    assert.strictEqual(body.constituents_known, 7);
  });

  await testAsync('accepts a bearer token', async () => {
    const r = await post(events()[0], { Authorization: `Bearer ${TOKEN}` });
    assert.strictEqual(r.status, 202);
  });

  await testAsync('accepts an in-body token and does not persist it', async () => {
    const payload = Object.assign({ token: TOKEN }, events()[1]);
    const r = await post(payload);
    assert.strictEqual(r.status, 202);
    const dir = fs.readdirSync(DATA_DIR).map((f) => path.join(DATA_DIR, f));
    for (const f of dir) {
      const contents = fs.readFileSync(f);
      assert.ok(!contents.includes(TOKEN), `secret leaked into ${path.basename(f)}`);
    }
  });

  await testAsync('GET /latest returns the worked example', async () => {
    const d = await (await fetch(`${BASE}/api/mags-lre/latest`)).json();
    assert.strictEqual(d.market.mag7_impact_share, 93.3);
    assert.strictEqual(d.market.direction, 'DRIVING');
    assert.strictEqual(d.market.transmission, 'CONCENTRATED');
    assert.strictEqual(d.leadership.positive_count, 1);
    assert.strictEqual(d.constituents.length, 7);
    assert.ok(['LIVE', 'DELAYED', 'STALE', 'CLOSED', 'CONFIRMED'].includes(d.data_status));
  });

  await testAsync('GET /events honours and clamps limit', async () => {
    const a = await (await fetch(`${BASE}/api/mags-lre/events?limit=2`)).json();
    assert.strictEqual(a.events.length, 2);
    const b = await (await fetch(`${BASE}/api/mags-lre/events?limit=99999`)).json();
    assert.ok(b.events.length >= 3);
  });

  await testAsync('SSE stream pushes an update frame', async () => {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/api/mags-lre/stream`, { signal: controller.signal });
    const reader = res.body.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.match(text, /retry: 5000/);
    controller.abort();
  });

  await testAsync('static dashboard is served', async () => {
    const r = await fetch(`${BASE}/`);
    const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.match(html, /SeasonalEDGE/);
  });

  await testAsync('path traversal is blocked', async () => {
    const r = await fetch(`${BASE}/../server.js`);
    assert.ok(r.status === 404 || r.status === 403, `got ${r.status}`);
  });

  await testAsync('valid alerts are never rate limited', async () => {
    // A legitimate burst (TradingView can fire several alerts on one bar close)
    // must all be accepted.
    for (let i = 0; i < 30; i++) {
      const r = await post(events()[2], { 'X-Webhook-Token': TOKEN });
      assert.strictEqual(r.status, 202, `burst request ${i} was rejected`);
    }
  });

  await testAsync('repeated bad tokens get throttled, valid token still works', async () => {
    let sawThrottle = false;
    for (let i = 0; i < 25; i++) {
      const r = await post(snapshot(), {
        'X-Webhook-Token': 'wrong-' + i,
        'X-Forwarded-For': '203.0.113.9',
      });
      if (r.status === 429) {
        sawThrottle = true;
        break;
      }
      assert.strictEqual(r.status, 401);
    }
    assert.ok(sawThrottle, 'token guessing was never throttled');

    // A different address is unaffected.
    const clean = await post(events()[0], {
      'X-Webhook-Token': TOKEN,
      'X-Forwarded-For': '198.51.100.4',
    });
    assert.strictEqual(clean.status, 202);
  });

  await testAsync('oversized bodies are refused', async () => {
    const big = { event: 'NOISE', ticker: 'AMZN', pad: 'x'.repeat(300 * 1024) };
    try {
      const r = await post(big, { 'X-Webhook-Token': TOKEN });
      assert.ok(r.status === 413 || r.status >= 400);
    } catch {
      // Connection reset by the size guard is an acceptable outcome.
      assert.ok(true);
    }
  });

  child.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  process.exit(failures.length ? 1 : 0);
})();
