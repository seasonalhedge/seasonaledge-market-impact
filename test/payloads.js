'use strict';

/**
 * Sample payloads.
 *
 * `snapshot` reproduces the canonical worked example from the spec:
 *   SPY +0.58%, MAG7 +0.62 pts, residual -0.04 pts, impact share 93.3%,
 *   DRIVING / CONCENTRATED, healthy leadership 1 of 7 (AMZN).
 * Constituent rows are taken from the MAGS LRE panel.
 */

const now = () => new Date().toISOString();

const snapshot = () => ({
  event: 'DASHBOARD_SNAPSHOT',
  time: now(),
  timeframe: '1D',
  confirmed: true,
  proxy_symbol: 'AMEX:SPY',

  spy_return: 0.58,
  mag7_contribution_points: 0.62,
  residual_contribution_points: -0.04,
  mag7_impact_share: 93.3,
  direction: 'DRIVING',
  transmission: 'CONCENTRATED',

  positive_count: 1,
  universe_count: 7,
  breadth_state: 'CRITICAL',
  breadth_trend: 'DETERIORATING',
  diffusion: -0.4,
  average_velocity: -0.5,
  rotation: 'DISTRIBUTION',

  spx_health: 46.8,
  spx_health_state: 'FRAGILE',
  structural_risk: 49.5,
  divergence_risk: 15.0,
  funding_pressure: 54.5,
  index_risk: 52.5,
  index_risk_state: 'ELEVATED',
  tripwires: ['LEAD_BREADTH_2_OF_7', 'FUNDING_PRESSURE_ELEVATED'],

  constituents: [
    { ticker: 'AMZN',  rank: 1, score: 74.5, state: 'ACCUM',   delta_5:  42.5, delta_20:  10.5, rank_change_5:  4, persistence_bars:  1, velocity:  31.1, flow: 'ENTERING', risk:  9.5 },
    { ticker: 'MSFT',  rank: 2, score: 66.5, state: 'NEUTRAL', delta_5:  29.5, delta_20:  40.5, rank_change_5:  1, persistence_bars:  2, velocity:  36.9, flow: 'ENTERING', risk:  9.5 },
    { ticker: 'GOOGL', rank: 3, score: 61.0, state: 'NEUTRAL', delta_5:  31.0, delta_20: -11.0, rank_change_5:  3, persistence_bars:  1, velocity:  11.3, flow: 'ENTERING', risk: 10.0 },
    { ticker: 'AAPL',  rank: 4, score: 58.0, state: 'NEUTRAL', delta_5: -25.5, delta_20: -25.5, rank_change_5: -3, persistence_bars:  1, velocity: -24.8, flow: 'LEAVING',  risk:  2.0 },
    { ticker: 'NVDA',  rank: 5, score: 45.0, state: 'DIST',    delta_5: -34.5, delta_20:  -6.0, rank_change_5: -3, persistence_bars:  3, velocity: -10.0, flow: 'LEAVING',  risk:  6.0 },
    { ticker: 'TSLA',  rank: 6, score:  4.0, state: 'FUNDING', delta_5:  -3.0, delta_20: -28.0, rank_change_5:  1, persistence_bars: 19, velocity:  -7.4, flow: 'LEAVING',  risk:  2.0 },
    { ticker: 'META',  rank: 7, score:  4.0, state: 'FUNDING', delta_5: -32.0, delta_20: -20.0, rank_change_5: -3, persistence_bars:  2, velocity: -37.8, flow: 'LEAVING',  risk:  4.0 },
  ],
});

const events = () => [
  {
    event: 'NEW_LEADER',
    time: now(),
    ticker: 'AMZN',
    state: 'ACCUM',
    score: 74.5,
    delta_5: 42.5,
    delta_20: 10.5,
    rank: 1,
    rank_change_5: 4,
    persistence_bars: 1,
    velocity: 31.1,
    flow: 'ENTERING',
    risk: 9.5,
    transmission: 'CONCENTRATED',
    index_risk: 52.5,
    index_risk_state: 'ELEVATED',
  },
  {
    event: 'FUNDING_SOURCE',
    time: now(),
    ticker: 'META',
    state: 'FUNDING',
    score: 4.0,
    velocity: -37.8,
    flow: 'LEAVING',
    risk: 4.0,
  },
  {
    event: 'BREADTH_DETERIORATING',
    time: now(),
    ticker: 'MAG7',
    breadth_state: 'CRITICAL',
    breadth_trend: 'DETERIORATING',
    positive_count: 1,
    score: 1,
  },
  {
    event: 'SPX_HEALTH_FRAGILE',
    time: now(),
    ticker: 'MAG7',
    spx_health: 46.8,
    spx_health_state: 'FRAGILE',
    score: 46.8,
  },
  {
    event: 'INDEX_RISK_ELEVATED',
    time: now(),
    ticker: 'MAG7',
    index_risk: 52.5,
    index_risk_state: 'ELEVATED',
    score: 52.5,
  },
  {
    event: 'TRANSMISSION_CONCENTRATED',
    time: now(),
    ticker: 'MAG7',
    transmission: 'CONCENTRATED',
    spy_return: 0.58,
    mag7_contribution_points: 0.62,
    mag7_impact_share: 93.3,
    direction: 'DRIVING',
    score: 93.3,
  },
];

module.exports = { snapshot, events };
