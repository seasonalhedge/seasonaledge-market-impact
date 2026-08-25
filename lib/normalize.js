'use strict';

/**
 * Normalization + attribution math for the MAGS Leadership Rotation Engine.
 *
 * Two payload shapes are supported:
 *   1. Ordinary event payloads  - one ticker / basket event, used for event history
 *                                 and to refresh whatever fields they happen to carry.
 *   2. DASHBOARD_SNAPSHOT       - all seven constituents plus complete basket state,
 *                                 emitted once per confirmed daily close.
 *
 * Nothing here touches storage or HTTP. Given raw payloads it returns plain objects.
 */

const C = require('./constants');

/* ------------------------------------------------------------------ helpers */

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[%+\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function upper(v) {
  const s = str(v);
  return s === null ? null : s.toUpperCase();
}

/** First non-null value among the given keys. */
function pick(obj, keys, coerce = num) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = coerce(obj[k]);
      if (v !== null) return v;
    }
  }
  return null;
}

function round(v, dp) {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  // Guard against -0 leaking into the payload.
  const r = Math.round((v + Number.EPSILON) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function clampState(value, allowed, fallback = null) {
  const v = upper(value);
  return v && allowed.includes(v) ? v : fallback;
}

/** Normalize a constituent state, mapping common synonyms onto the canonical set. */
function normalizeConstituentState(value) {
  const v = upper(value);
  if (!v) return null;
  const map = {
    LEAD: 'LEADER',
    LEADER: 'LEADER',
    LEADING: 'LEADER',
    ACCUM: 'ACCUM',
    ACCUMULATION: 'ACCUM',
    NEUTRAL: 'NEUTRAL',
    NEUT: 'NEUTRAL',
    DIST: 'DIST',
    DISTR: 'DIST',
    DISTRIBUTION: 'DIST',
    FUND: 'FUNDING',
    FUNDING: 'FUNDING',
    'FUNDING SOURCE': 'FUNDING',
    FUNDING_SOURCE: 'FUNDING',
  };
  return map[v] || (C.CONSTITUENT_STATES.includes(v) ? v : null);
}

function normalizeFlow(value) {
  const v = upper(value);
  if (!v) return null;
  if (v.startsWith('ENTER')) return 'ENTERING';
  if (v.startsWith('LEAV') || v.startsWith('EXIT')) return 'LEAVING';
  return 'FLAT';
}

function isoTime(value) {
  const s = str(value);
  if (s) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const n = num(value);
  if (n !== null && n > 1e11) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function truthy(v) {
  if (typeof v === 'boolean') return v;
  const s = upper(v);
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'CONFIRMED';
}

/* ------------------------------------------------------------- attribution */

/**
 * Core attribution math. Always computed from raw (unrounded) inputs; the caller
 * rounds only at the presentation boundary.
 *
 * @param {number|null} spyReturn        SPY % return for the session.
 * @param {number|null} mag7Points       MAG7 contribution in SPX percentage points.
 * @param {number|null} residualOverride Residual from the webhook, if it supplies one.
 * @param {number|null} shareOverride    Raw mag7_impact_share from the webhook, if present.
 */
function computeAttribution(spyReturn, mag7Points, residualOverride = null, shareOverride = null) {
  const result = {
    spy_return: null,
    mag7_contribution_points: null,
    residual_contribution_points: null,
    mag7_impact_share: null,
    gross_attribution: null,
    direction: 'N/A',
    reliable: false,
  };

  if (spyReturn === null || mag7Points === null) {
    // With only one of the two we can still surface what we have, but no split.
    result.spy_return = spyReturn;
    result.mag7_contribution_points = mag7Points;
    return result;
  }

  const residual = residualOverride !== null ? residualOverride : spyReturn - mag7Points;
  const gross = Math.abs(mag7Points) + Math.abs(residual);

  result.spy_return = spyReturn;
  result.mag7_contribution_points = mag7Points;
  result.residual_contribution_points = residual;
  result.gross_attribution = gross;

  if (gross < C.RELIABILITY_FLOOR) {
    result.direction = 'N/A';
    result.mag7_impact_share = null;
    return result;
  }

  result.reliable = true;
  // Prefer the engine's own share when it supplies one; otherwise derive it.
  result.mag7_impact_share =
    shareOverride !== null && shareOverride >= 0 && shareOverride <= 100
      ? shareOverride
      : (Math.abs(mag7Points) / gross) * 100;

  if (Math.abs(mag7Points) < C.FLAT_THRESHOLD) {
    result.direction = 'FLAT';
  } else if (Math.sign(mag7Points) === Math.sign(spyReturn) && spyReturn !== 0) {
    result.direction = 'DRIVING';
  } else if (spyReturn === 0) {
    result.direction = 'FLAT';
  } else {
    result.direction = 'OFFSETTING';
  }

  return result;
}

/* ------------------------------------------------------- derived structures */

function deriveBreadthState(positiveCount) {
  if (positiveCount === null) return null;
  if (positiveCount >= 7) return 'EXPANSIVE';
  if (positiveCount >= 5) return 'STRONG';
  if (positiveCount >= 3) return 'MODERATE';
  if (positiveCount >= 2) return 'WEAK';
  return 'CRITICAL';
}

/**
 * Transmission state. The engine may send its own; when it does we trust it.
 * Otherwise we derive it from health, direction, impact share and breadth.
 */
function deriveTransmission({ direction, impactShare, positiveCount, risk, leadership }) {
  const health = risk.spx_health;
  const divergence = risk.divergence_risk;
  const structural = risk.structural_risk;

  if ((health !== null && health < 30) || (divergence !== null && divergence >= 60)) {
    return 'BROKEN';
  }
  if (direction === 'OFFSETTING') return 'FRAGILE';
  if (
    (health !== null && health < 50) ||
    (structural !== null && structural >= 70)
  ) {
    return 'FRAGILE';
  }
  if (
    impactShare !== null &&
    impactShare >= C.CONCENTRATION_SHARE &&
    positiveCount !== null &&
    positiveCount <= C.CONCENTRATION_MAX_LEADERS
  ) {
    return 'CONCENTRATED';
  }
  if (
    positiveCount !== null &&
    positiveCount >= 5 &&
    (leadership.diffusion === null || leadership.diffusion > 0) &&
    (leadership.average_velocity === null || leadership.average_velocity > 0)
  ) {
    return 'BROAD';
  }
  return 'HEALTHY';
}

/* --------------------------------------------------------- payload parsing */

const TICKER_KEYS = ['ticker', 'symbol', 'constituent', 'name'];

function parseConstituent(raw, receivedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = upper(pick(raw, TICKER_KEYS, str));
  if (!ticker) return null;

  return {
    ticker,
    rank: pick(raw, ['rank', 'position']),
    score: pick(raw, ['score', 'leadership_score', 'lead_score']),
    state: normalizeConstituentState(pick(raw, ['state', 'leadership_state', 'status'], str)),
    delta_5: pick(raw, ['delta_5', 'delta5', 'delta_5d', 'd5', 'score_delta_5']),
    delta_20: pick(raw, ['delta_20', 'delta20', 'delta_20d', 'd20', 'score_delta_20']),
    rank_change_5: pick(raw, ['rank_change_5', 'rank_delta_5', 'rank_d5', 'rank_change']),
    persistence_bars: pick(raw, ['persistence_bars', 'bars', 'persistence']),
    velocity: pick(raw, ['velocity', 'rotation_velocity', 'vel']),
    flow: normalizeFlow(pick(raw, ['flow', 'flow_state'], str)),
    risk: pick(raw, ['risk', 'risk_score']),
    heat: pick(raw, ['heat', 'heat_score']),
    updated_at: isoTime(pick(raw, ['time', 'timestamp', 'as_of'], str)) || receivedAt,
  };
}

/**
 * Validate and normalize an inbound webhook body.
 * Returns { ok: true, parsed } or { ok: false, errors: [...] }.
 */
function parsePayload(body, receivedAt = new Date().toISOString()) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }

  const eventName = upper(pick(body, ['event', 'event_name', 'alert', 'type'], str));
  if (!eventName) errors.push('missing "event"');

  const isSnapshot = eventName === 'DASHBOARD_SNAPSHOT';

  const time =
    isoTime(pick(body, ['time', 'timestamp', 'as_of', 'bar_time'], str)) || receivedAt;

  // ---- basket / market level ------------------------------------------------
  const spyReturn = pick(body, [
    'spy_return',
    'proxy_return',
    'index_return',
    'spx_return',
    'spy_pct',
  ]);
  const mag7Points = pick(body, [
    'mag7_contribution_points',
    'mag7_contribution',
    'mag7_contrib',
    'contribution_points',
  ]);
  const residual = pick(body, [
    'residual_contribution_points',
    'residual_contribution',
    'residual_points',
  ]);
  const share = pick(body, ['mag7_impact_share', 'impact_share', 'mag7_share']);

  const basket = {
    proxy_symbol: pick(body, ['proxy_symbol', 'proxy', 'index_proxy'], str) || null,
    timeframe: pick(body, ['timeframe', 'tf', 'interval'], str) || null,
    confirmed: Object.prototype.hasOwnProperty.call(body, 'confirmed')
      ? truthy(body.confirmed)
      : isSnapshot
        ? true
        : null,
    spy_return: spyReturn,
    mag7_contribution_points: mag7Points,
    residual_contribution_points: residual,
    mag7_impact_share: share,
    direction: clampState(pick(body, ['direction', 'impact_direction'], str), C.DIRECTIONS),
    transmission: clampState(
      pick(body, ['transmission', 'transmission_state'], str),
      C.TRANSMISSION_STATES
    ),
  };

  // ---- leadership ----------------------------------------------------------
  const leadership = {
    positive_count: pick(body, ['positive_count', 'healthy_count', 'lead_breadth_count']),
    universe_count: pick(body, ['universe_count', 'universe']) || null,
    breadth_state: clampState(pick(body, ['breadth_state'], str), C.BREADTH_STATES),
    breadth_trend: clampState(
      pick(body, ['breadth_trend', 'breadth'], str),
      C.BREADTH_TRENDS
    ),
    diffusion: pick(body, ['diffusion', 'ldi', 'leadership_diffusion', 'diffusion_index']),
    average_velocity: pick(body, ['average_velocity', 'avg_velocity', 'avg_vel']),
    rotation_state: pick(body, ['rotation', 'rotation_state'], str),
  };

  // ---- risk ----------------------------------------------------------------
  const risk = {
    spx_health: pick(body, ['spx_health', 'health', 'spx_health_score']),
    spx_health_state: pick(body, ['spx_health_state', 'health_state'], upper),
    structural_risk: pick(body, ['structural_risk', 'struct_risk']),
    divergence_risk: pick(body, ['divergence_risk', 'div_risk']),
    funding_pressure: pick(body, ['funding_pressure', 'fund_press']),
    index_risk: pick(body, ['index_risk']),
    index_risk_state: pick(body, ['index_risk_state'], upper),
    tripwires: (() => {
      const t = body.tripwires;
      if (Array.isArray(t)) return t.map((x) => upper(x)).filter(Boolean);
      const s = str(t);
      if (!s || upper(s) === 'NONE') return [];
      return s.split(/[,;|]/).map((x) => upper(x)).filter(Boolean);
    })(),
  };

  // ---- constituents --------------------------------------------------------
  const constituents = [];
  const rawList = Array.isArray(body.constituents)
    ? body.constituents
    : Array.isArray(body.rows)
      ? body.rows
      : null;

  if (rawList) {
    for (const raw of rawList) {
      const parsed = parseConstituent(raw, time);
      if (parsed) constituents.push(parsed);
      else errors.push('constituent row missing a ticker');
    }
  } else {
    // Ordinary event payloads describe a single ticker inline. Basket-level
    // events are tagged with a subject like "MAG7" and carry a basket score —
    // those must not be stored as if they were a constituent row.
    const single = parseConstituent(body, time);
    if (
      single &&
      C.UNIVERSE.includes(single.ticker) &&
      (single.score !== null || single.state !== null)
    ) {
      constituents.push(single);
    }
  }

  if (isSnapshot && constituents.length < C.UNIVERSE.length) {
    errors.push(
      `DASHBOARD_SNAPSHOT must carry ${C.UNIVERSE.length} constituents, received ${constituents.length}`
    );
  }

  if (errors.length) return { ok: false, errors };

  const subject =
    upper(pick(body, TICKER_KEYS, str)) ||
    (isSnapshot ? 'MAG7' : constituents.length === 1 ? constituents[0].ticker : 'MAG7');

  return {
    ok: true,
    parsed: {
      is_snapshot: isSnapshot,
      received_at: receivedAt,
      event: {
        time,
        event: eventName,
        ticker: subject,
        state:
          normalizeConstituentState(pick(body, ['state'], str)) ||
          basket.transmission ||
          leadership.breadth_state ||
          null,
        score: pick(body, ['score', 'value', 'level']),
        transmission: basket.transmission,
        index_risk: risk.index_risk,
        index_risk_state: risk.index_risk_state,
      },
      basket,
      leadership,
      risk,
      constituents,
      raw: body,
    },
  };
}

/* ------------------------------------------------- dashboard reconstruction */

/**
 * Merge a parsed payload into the persistent state object.
 * `state` is mutated and returned.
 */
function applyToState(state, parsed) {
  const mergeDefined = (target, source) => {
    for (const [k, v] of Object.entries(source)) {
      if (v !== null && v !== undefined) target[k] = v;
    }
  };

  if (parsed.is_snapshot) {
    // A confirmed snapshot is authoritative: replace basket-level blocks wholesale.
    state.basket = { ...state.basket, ...parsed.basket };
    state.leadership = { ...state.leadership, ...parsed.leadership };
    state.risk = { ...state.risk, ...parsed.risk };
    state.snapshot_at = parsed.event.time;
    state.confirmed = parsed.basket.confirmed !== false;
    for (const c of parsed.constituents) state.constituents[c.ticker] = c;
  } else {
    mergeDefined(state.basket, parsed.basket);
    mergeDefined(state.leadership, parsed.leadership);
    // Tripwires are merged separately: an event that simply omits them must not
    // clear the set most recently published by a snapshot.
    const { tripwires, ...riskFields } = parsed.risk;
    mergeDefined(state.risk, riskFields);
    if (tripwires && tripwires.length) state.risk.tripwires = tripwires;
    state.confirmed = parsed.basket.confirmed === true ? true : state.confirmed || false;
    // Preserve the latest known row per ticker until a snapshot arrives.
    for (const c of parsed.constituents) {
      const prev = state.constituents[c.ticker] || {};
      const next = { ...prev };
      mergeDefined(next, c);
      next.ticker = c.ticker;
      next.updated_at = c.updated_at;
      state.constituents[c.ticker] = next;
    }
  }

  state.as_of = parsed.event.time;
  state.updated_at = parsed.received_at;
  state.last_raw = parsed.raw;
  return state;
}

function emptyState() {
  return {
    as_of: null,
    updated_at: null,
    snapshot_at: null,
    confirmed: false,
    basket: {
      proxy_symbol: 'AMEX:SPY',
      timeframe: '1D',
      spy_return: null,
      mag7_contribution_points: null,
      residual_contribution_points: null,
      mag7_impact_share: null,
      direction: null,
      transmission: null,
    },
    leadership: {
      positive_count: null,
      universe_count: C.UNIVERSE.length,
      breadth_state: null,
      breadth_trend: null,
      diffusion: null,
      average_velocity: null,
      rotation_state: null,
    },
    risk: {
      spx_health: null,
      spx_health_state: null,
      structural_risk: null,
      divergence_risk: null,
      funding_pressure: null,
      index_risk: null,
      index_risk_state: null,
      tripwires: [],
    },
    constituents: {},
    last_raw: null,
  };
}

/** Minutes from midnight in America/New_York for a given Date. */
function nyMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: get('weekday'),
  };
}

function computeDataStatus(updatedAt, now = new Date()) {
  const { minutes, weekday } = nyMinutes(now);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const inSession =
    !weekend && minutes >= C.SESSION_OPEN_MIN && minutes < C.SESSION_CLOSE_MIN;

  if (!updatedAt) return inSession ? 'STALE' : 'CLOSED';
  const ageMin = (now.getTime() - new Date(updatedAt).getTime()) / 60000;

  if (!inSession) return 'CLOSED';
  if (ageMin <= C.LIVE_WINDOW_MIN) return 'LIVE';
  if (ageMin <= C.DELAYED_WINDOW_MIN) return 'DELAYED';
  return 'STALE';
}

/**
 * Build the normalized API response from persistent state.
 * All rounding happens here and only here.
 */
function buildDashboard(state, events = [], now = new Date()) {
  const b = state.basket;

  const attribution = computeAttribution(
    b.spy_return,
    b.mag7_contribution_points,
    b.residual_contribution_points,
    b.mag7_impact_share
  );

  const rows = C.UNIVERSE.map((t) => state.constituents[t]).filter(Boolean);
  const known = rows.filter((r) => r.state !== null);
  const derivedPositive = known.length
    ? known.filter((r) => C.POSITIVE_STATES.has(r.state)).length
    : null;

  const positiveCount =
    state.leadership.positive_count !== null && state.leadership.positive_count !== undefined
      ? state.leadership.positive_count
      : derivedPositive;

  const leadership = {
    positive_count: positiveCount,
    universe_count: state.leadership.universe_count || C.UNIVERSE.length,
    coverage_count: known.length,
    breadth_state: state.leadership.breadth_state || deriveBreadthState(positiveCount),
    breadth_trend: state.leadership.breadth_trend,
    diffusion: round(state.leadership.diffusion, 2),
    average_velocity: round(state.leadership.average_velocity, 1),
    rotation_state: state.leadership.rotation_state,
    positive_tickers: known
      .filter((r) => C.POSITIVE_STATES.has(r.state))
      .map((r) => r.ticker),
  };

  const risk = {
    spx_health: round(state.risk.spx_health, 1),
    spx_health_state: state.risk.spx_health_state,
    structural_risk: round(state.risk.structural_risk, 1),
    divergence_risk: round(state.risk.divergence_risk, 1),
    funding_pressure: round(state.risk.funding_pressure, 1),
    index_risk: round(state.risk.index_risk, 1),
    index_risk_state: state.risk.index_risk_state,
    tripwires: state.risk.tripwires || [],
  };

  const direction = b.direction || attribution.direction;
  const transmission =
    b.transmission ||
    deriveTransmission({
      direction,
      impactShare: attribution.mag7_impact_share,
      positiveCount,
      risk: state.risk,
      leadership: state.leadership,
    });

  const constituents = rows
    .map((r) => ({
      ticker: r.ticker,
      rank: r.rank,
      score: round(r.score, 1),
      state: r.state,
      delta_5: round(r.delta_5, 1),
      delta_20: round(r.delta_20, 1),
      rank_change_5: r.rank_change_5,
      persistence_bars: r.persistence_bars,
      velocity: round(r.velocity, 1),
      flow: r.flow,
      risk: round(r.risk, 1),
      updated_at: r.updated_at || null,
    }))
    .sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity));

  return {
    as_of: state.as_of,
    updated_at: state.updated_at,
    snapshot_at: state.snapshot_at,
    timeframe: b.timeframe || '1D',
    confirmed: Boolean(state.confirmed),
    proxy_symbol: b.proxy_symbol || 'AMEX:SPY',
    data_status: computeDataStatus(state.updated_at, now),
    market: {
      spy_return: round(attribution.spy_return, 2),
      mag7_contribution_points: round(attribution.mag7_contribution_points, 2),
      residual_contribution_points: round(attribution.residual_contribution_points, 2),
      mag7_impact_share: round(attribution.mag7_impact_share, 1),
      gross_attribution: round(attribution.gross_attribution, 2),
      residual_share:
        attribution.mag7_impact_share === null
          ? null
          : round(100 - attribution.mag7_impact_share, 1),
      direction,
      transmission,
      reliable: attribution.reliable,
    },
    leadership,
    risk,
    constituents,
    events: events.slice(0, 25),
  };
}

module.exports = {
  parsePayload,
  parseConstituent,
  applyToState,
  emptyState,
  buildDashboard,
  computeAttribution,
  computeDataStatus,
  deriveBreadthState,
  deriveTransmission,
  round,
};
