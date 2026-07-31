'use strict';

/** Canonical MAG7 universe, in the display order requested. */
const UNIVERSE = ['MSFT', 'META', 'AAPL', 'AMZN', 'GOOGL', 'NVDA', 'TSLA'];

/** Constituent leadership states. LEADER + ACCUM count as positive leadership. */
const CONSTITUENT_STATES = ['LEADER', 'ACCUM', 'NEUTRAL', 'DIST', 'FUNDING'];
const POSITIVE_STATES = new Set(['LEADER', 'ACCUM']);

/** Human labels for constituent states (used by the UI, kept here so both ends agree). */
const STATE_LABELS = {
  LEADER: 'Leader',
  ACCUM: 'Accumulation',
  NEUTRAL: 'Neutral',
  DIST: 'Distribution',
  FUNDING: 'Funding',
};

const FLOW_STATES = ['ENTERING', 'LEAVING', 'FLAT'];
const DIRECTIONS = ['DRIVING', 'OFFSETTING', 'FLAT', 'N/A'];
const TRANSMISSION_STATES = ['BROAD', 'HEALTHY', 'CONCENTRATED', 'FRAGILE', 'BROKEN'];
const BREADTH_STATES = ['EXPANSIVE', 'STRONG', 'MODERATE', 'WEAK', 'CRITICAL'];
const BREADTH_TRENDS = ['IMPROVING', 'STABLE', 'DETERIORATING'];

/**
 * Reliability floor, in SPX percentage points.
 * Below this level of gross attribution the split is noise, so direction is N/A.
 */
const RELIABILITY_FLOOR = 0.02;

/**
 * A MAG7 contribution smaller than this (in points) is treated as immaterial => FLAT.
 */
const FLAT_THRESHOLD = 0.01;

/** Impact share at or above this, with <= CONCENTRATION_MAX_LEADERS healthy names, is CONCENTRATED. */
const CONCENTRATION_SHARE = 60;
const CONCENTRATION_MAX_LEADERS = 3;

/** Data-status windows, in minutes since the last accepted webhook. */
const LIVE_WINDOW_MIN = 10;
const DELAYED_WINDOW_MIN = 45;

/** US equity regular session, in America/New_York wall-clock minutes from midnight. */
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_CLOSE_MIN = 16 * 60;

module.exports = {
  UNIVERSE,
  CONSTITUENT_STATES,
  POSITIVE_STATES,
  STATE_LABELS,
  FLOW_STATES,
  DIRECTIONS,
  TRANSMISSION_STATES,
  BREADTH_STATES,
  BREADTH_TRENDS,
  RELIABILITY_FLOOR,
  FLAT_THRESHOLD,
  CONCENTRATION_SHARE,
  CONCENTRATION_MAX_LEADERS,
  LIVE_WINDOW_MIN,
  DELAYED_WINDOW_MIN,
  SESSION_OPEN_MIN,
  SESSION_CLOSE_MIN,
};
