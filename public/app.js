/* =============================================================================
   SeasonalEDGE Market Impact — renderer, v2

   Vanilla JS, no framework, no build step. Every value that originates from
   the webhook reaches the page through textContent, setAttribute or dataset.
   innerHTML is never used with dynamic content, so an alert payload cannot
   inject markup — a hostile string renders as the literal text it is.

   Figures are only redrawn when the engine sends new data. Nothing is
   simulated between updates; the only things that tick on their own are the
   clocks, because time genuinely passes.
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    latestUrl: '/api/mags-lre/latest',
    streamUrl: '/api/mags-lre/stream',
    pollMs: 30000,
    universe: ['MSFT', 'META', 'AAPL', 'AMZN', 'GOOGL', 'NVDA', 'TSLA'],
  };

  var MINUS = '−';
  var EM = '—';

  /* ============================================================ vocabulary */

  var STATE_LABELS = {
    LEADER: 'Leader',
    ACCUM: 'Accumulation',
    NEUTRAL: 'Neutral',
    DIST: 'Distribution',
    FUNDING: 'Funding',
  };
  var POSITIVE = { LEADER: true, ACCUM: true };
  /** Short forms for the tiles — the same words the TradingView panel uses. */
  var TILE_LABELS = { LEADER: 'Leader', ACCUM: 'Accum', NEUTRAL: 'Neutral', DIST: 'Distrib', FUNDING: 'Funding' };

  /** Transmission: engine word -> where it sits on the five-step scale. */
  var TX = {
    BROAD: {
      step: 'BROAD', label: 'Broad', tone: 'good', color: 'var(--spring)',
      def: 'Leadership is wide: five or more of the seven are healthy and diffusion is positive. The index is being carried by many hands.',
    },
    BROADENING: {
      step: 'BROAD', label: 'Broadening', tone: 'good', color: 'var(--spring)',
      def: 'Leadership is widening. Participation is spreading beyond the few names that had been carrying the index.',
    },
    HEALTHY: {
      step: 'HEALTHY', label: 'Healthy', tone: 'ok', color: 'var(--tone-ok)',
      def: 'Index support is reasonably distributed. No single group is doing all of the work.',
    },
    CONCENTRATED: {
      step: 'CONCENTRATED', label: 'Concentrated', tone: 'watch', color: 'var(--summer)',
      def: 'MAG7 is carrying a large share of the index through three or fewer healthy leaders. The headline rests on a narrow base.',
    },
    OFFSETTING: {
      step: 'FRAGILE', label: 'Offsetting', tone: 'warn', color: 'var(--fall)',
      def: 'MAG7 is moving against the rest of the index. The direction is being set by the other 493, with the seven pulling the other way.',
    },
    FRAGILE: {
      step: 'FRAGILE', label: 'Fragile', tone: 'warn', color: 'var(--fall)',
      def: 'Internal support is weak — health is low or structural risk is high — so the index’s move rests on thin footing.',
    },
    BROKEN: {
      step: 'BROKEN', label: 'Broken', tone: 'bad', color: 'var(--red)',
      def: 'Severe deterioration or active divergence. Price and the internals beneath it are telling different stories.',
    },
  };

  var BREADTH_TONE = { EXPANSIVE: 'good', STRONG: 'good', MODERATE: 'watch', NARROW: 'watch', WEAK: 'warn', DANGEROUS: 'bad', CRITICAL: 'bad' };

  var STATUS_LABELS = {
    CONFIRMED: 'Confirmed close',
    LIVE: 'Live',
    DELAYED: 'Delayed',
    STALE: 'Stale',
    CLOSED: 'Market closed',
    OFFLINE: 'Offline',
    AWAITING: 'Awaiting first reading',
  };

  /**
   * Every event the MAGS LRE engine can fire, in words a client can read.
   * family drives the timeline colour: positive / caution / risk / rotation / info.
   */
  var EVENTS = {
    MAGS_FACADE_CRITICAL: ['MAGS facade — critical', 'risk', 'The index is being lifted by MAG7 while the other 493 fail to confirm, at critical intensity.'],
    MAGS_FACADE_PERSISTENT: ['MAGS facade — persistent', 'risk', 'MAG7 strength has masked weak participation across several consecutive sessions.'],
    MAGS_FACADE: ['MAGS facade', 'caution', 'MAG7 is lifting the index without confirmation from the broader market.'],
    SPX_HEALTH_FRAGILE: ['SPX health fragile', 'risk', 'The composite measure of index support fell into the fragile band.'],
    TRANSMISSION_OFFSETTING: ['Transmission offsetting', 'caution', 'MAG7 moved against the rest of the index.'],
    TRANSMISSION_CONCENTRATED: ['Transmission concentrated', 'caution', 'MAG7 is carrying a large share of the index through few healthy leaders.'],
    INDEX_RISK_ELEVATED: ['Index risk elevated', 'risk', 'More of the index’s level now depends on a narrow base.'],
    NEW_LEADER: ['New leader', 'positive', '{t} crossed into leadership.'],
    IMPROVING: ['Improving', 'positive', '{t} moved into accumulation.'],
    DISTRIBUTION: ['Distribution', 'caution', '{t} slipped into distribution.'],
    FUNDING_SOURCE: ['Funding source', 'risk', '{t} is being sold to fund positions elsewhere.'],
    RELATIVE_BREAKOUT: ['Relative breakout', 'positive', '{t} broke out relative to the group.'],
    RELATIVE_BREAKDOWN: ['Relative breakdown', 'risk', '{t} broke down relative to the group.'],
    ROTATION_ACCELERATION: ['Rotation accelerating', 'rotation', 'Capital is moving between the seven faster.'],
    ROTATION_DECELERATION: ['Rotation slowing', 'rotation', 'Capital movement between the seven is easing.'],
    DIVERGENCE_RISK_REGIME: ['Divergence regime', 'risk', 'Price and leadership internals have moved into sustained disagreement.'],
    STRUCTURAL_RISK_REGIME: ['Structural risk regime', 'risk', 'Concentration inside the leadership set reached a structural extreme.'],
    PRICE_BREADTH_DIVERGENCE: ['Price / breadth divergence', 'risk', 'MAGS made a new high without breadth confirming it.'],
    PRICE_LDI_DIVERGENCE: ['Price / diffusion divergence', 'risk', 'Price is rising while leadership diffusion falls.'],
    CONCENTRATED_FUNDING_STRESS: ['Concentrated funding stress', 'risk', 'Few leaders remain while funding pressure climbs.'],
    BREADTH_LEADS_PRICE: ['Breadth leads price', 'positive', 'Participation is improving ahead of price — a constructive sign.'],
    DIVERGENCE_RECOVERY: ['Divergence recovery', 'positive', 'Price and internals have moved back into agreement.'],
    STRUCTURAL_RECOVERY: ['Structural recovery', 'positive', 'Concentration risk has eased back from its extreme.'],
    LEADERSHIP_COLLAPSE: ['Leadership collapse', 'risk', 'Healthy leadership across the seven has fallen away sharply.'],
    FUNDING_PRESSURE_EXTREME: ['Funding pressure extreme', 'risk', 'Rotation out of constituents has reached an extreme.'],
    LEADERSHIP_NARROWING: ['Leadership narrowing', 'caution', 'Fewer of the seven are carrying the group.'],
    BASKET_FRAGILITY: ['Basket fragility', 'caution', 'The MAG7 basket’s internal structure is weakening.'],
    NEGATIVE_DIFFUSION: ['Negative diffusion', 'caution', 'Leadership is concentrating rather than spreading.'],
    BREADTH_DETERIORATING: ['Breadth deteriorating', 'caution', 'Participation inside MAG7 is thinning.'],
    DASHBOARD_SNAPSHOT: ['Daily snapshot', 'info', 'Full end-of-session state for all seven constituents.'],
    DAILY_CLOSE: ['Daily close reading', 'info', 'End-of-session attribution, internals and 493 confirmation.'],
  };

  var TRIPWIRE_NOTES = {
    'PRICE/BREADTH': 'The index made a high that breadth did not confirm.',
    'PRICE/LDI': 'Price is rising while leadership diffusion falls.',
    FUNDING_PRESSURE_ELEVATED: 'Capital is being rotated out of some constituents to fund others.',
  };

  /* ============================================================= utilities */

  function $(id) { return document.getElementById(id); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Build an element. Strings become text nodes — never parsed as markup. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else if (k.indexOf('data-') === 0) node.setAttribute(k, String(v));
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, String(v));
      }
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function setText(node, v) { if (node) node.textContent = v === null || v === undefined || v === '' ? EM : String(v); }

  function signed(v, dp, suffix) {
    if (!isNum(v)) return EM;
    var sign = v > 0 ? '+' : v < 0 ? MINUS : '';
    return sign + Math.abs(v).toFixed(dp) + (suffix || '');
  }
  function fixed(v, dp, suffix) { return isNum(v) ? v.toFixed(dp) + (suffix || '') : EM; }
  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }
  function lower(s) { return String(s || '').toLowerCase(); }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Digital roll. Each digit becomes a column holding two 0–9 strips that turns
   * a full revolution into its new value, staggered left to right. The columns
   * are aria-hidden; the real value is exposed to assistive tech alongside.
   */
  function rollTo(node, value) {
    if (!node) return;
    var text = value === null || value === undefined || value === '' ? EM : String(value);
    if (node.dataset.roll === text) return;
    var isUpdate = node.dataset.roll !== undefined;
    node.dataset.roll = text;

    if (reduceMotion) { node.textContent = text; return; }

    clear(node);
    node.appendChild(el('span', { className: 'visually-hidden', text: text }));
    var wrap = el('span', { className: 'roll', 'aria-hidden': 'true' });
    var digit = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch >= '0' && ch <= '9') {
        var strip = el('span', { className: 'roll__strip' });
        for (var d = 0; d < 20; d++) strip.appendChild(el('span', { text: String(d % 10) }));
        strip.style.transitionDelay = digit * 38 + 'ms';
        wrap.appendChild(el('span', { className: 'roll__col' }, strip));
        (function (s, target) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { s.style.transform = 'translateY(-' + (10 + target) + 'em)'; });
          });
        })(strip, Number(ch));
        digit++;
      } else {
        wrap.appendChild(el('span', { className: 'roll__static', text: ch }));
      }
    }
    node.appendChild(wrap);
    if (isUpdate) {
      node.classList.remove('roll--printing');
      void node.offsetWidth;
      node.classList.add('roll--printing');
    }
  }

  /* ========================================================= New York time */

  var NY = 'America/New_York';
  var WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var OPEN = 9 * 60 + 30;
  var CLOSE = 16 * 60;

  function nyParts(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: NY, weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    var hh = Number(o.hour) % 24;
    return {
      weekday: o.weekday, month: o.month, day: o.day,
      hh: ('0' + hh).slice(-2), mm: o.minute, ss: o.second,
      minutes: hh * 60 + Number(o.minute),
      dayIndex: WEEK.indexOf(o.weekday),
    };
  }
  function trading(d) { return d >= 1 && d <= 5; }

  function dateLabel(iso) {
    if (!iso) return null;
    var p = nyParts(new Date(iso));
    return p.weekday + ', ' + p.month + ' ' + p.day;
  }
  function timeLabel(iso) {
    if (!iso) return null;
    var p = nyParts(new Date(iso));
    return p.hh + ':' + p.mm + ' ET';
  }
  function ago(iso) {
    if (!iso) return null;
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function gap(mins) {
    mins = Math.max(0, Math.round(mins));
    var d = Math.floor(mins / 1440);
    var h = Math.floor((mins % 1440) / 60);
    var m = mins % 60;
    if (d) return d + 'd ' + h + 'h';
    return h ? h + 'h ' + m + 'm' : m + 'm';
  }

  /** The next weekday 16:00 New York close — when a daily engine next speaks. */
  function nextClose(now) {
    var p = nyParts(now);
    var day = p.dayIndex;
    if (trading(day) && p.minutes < CLOSE) return { mins: CLOSE - p.minutes, label: 'Today' };
    var mins = 1440 - p.minutes + CLOSE;
    var ahead = 1;
    day = (day + 1) % 7;
    while (!trading(day)) { mins += 1440; day = (day + 1) % 7; ahead++; }
    return { mins: mins, label: ahead === 1 ? 'Tomorrow' : WEEK[day] };
  }

  function isDaily(tf) { var t = String(tf || '').toUpperCase(); return t === '1D' || t === 'D' || t === 'DAILY'; }

  /* ================================================================ status */

  var lastPayload = null;
  var transportStatus = null;

  function renderStatus(d) {
    var pill = $('status-pill');
    var status = transportStatus === 'OFFLINE' ? 'OFFLINE' : !d ? '' : !d.updated_at ? 'AWAITING' : d.data_status;
    pill.dataset.status = status || '';
    setText(pill, STATUS_LABELS[status] || status || EM);

    var tf = d ? d.timeframe : '1D';
    var session = d && d.as_of ? dateLabel(d.as_of) + (isDaily(tf) ? ' close' : '') : null;
    setText($('session-date'), session);

    var received = d && d.updated_at ? timeLabel(d.updated_at) + ' · ' + ago(d.updated_at) : null;
    setText($('last-update'), received);

    if (isDaily(tf)) {
      var n = nextClose(new Date());
      setText($('next-reading'), n.label + ' 16:00 ET · ' + gap(n.mins));
    } else {
      setText($('next-reading'), 'On next alert');
    }
  }

  function tickClock() {
    var p = nyParts(new Date());
    var phase;
    if (!trading(p.dayIndex)) phase = 'Weekend';
    else if (p.minutes < OPEN) phase = 'Pre-market';
    else if (p.minutes < CLOSE) phase = 'Open';
    else phase = 'After hours';
    setText($('market-clock'), p.hh + ':' + p.mm + ':' + p.ss + ' · ' + phase);
  }

  /* ================================================================== hero */

  function hl(text, cls) { return el('span', { className: 'hl ' + (cls || '') }, text); }

  function verdictParts(d) {
    var m = d.market;
    var s = m.mag7_impact_share;
    if (!d.updated_at) {
      return {
        verdict: ['Awaiting the first confirmed reading.'],
        support: ['The engine publishes once per session, on the confirmed 4:00 PM ET close. This page updates the moment it lands.'],
      };
    }
    if (!isNum(s)) {
      var n = (d.constituents || []).length;
      return {
        verdict: ['Attribution for this session is still forming.'],
        support: [n
          ? 'The engine has reported ' + n + ' of 7 constituents so far. The MAG7 / index split arrives with its next transmission alert.'
          : 'Engine readings are arriving. The MAG7 / index split arrives with its next transmission alert.'],
      };
    }
    var share = s.toFixed(1) + '%';
    var verdict;
    if (m.direction === 'OFFSETTING') {
      verdict = ['MAG7 is leaning against the index, accounting for ', hl(share, 'hl--warn'), ' of its movement.'];
    } else if (m.direction === 'FLAT') {
      verdict = ['MAG7 was a non-factor in the index’s move.'];
    } else {
      verdict = ['MAG7 is driving ', hl(share, 'hl--mag7'), ' of the S&P 500’s move.'];
    }

    var support;
    if (m.mode === 'FULL') {
      support = [
        'SPY ', hl(signed(m.spy_return, 2, '%')), ' on the session. MAG7 contributed ',
        hl(signed(m.mag7_contribution_points, 2)), ' points; the other 493 stocks contributed ',
        hl(signed(m.residual_contribution_points, 2)), '.',
      ];
    } else {
      support = [
        'MAG7 contributed ', hl(signed(m.mag7_contribution_points, 2)),
        ' SPX points, per the engine’s own attribution. The full split against the other 493 arrives with the next snapshot.',
      ];
    }
    return { verdict: verdict, support: support };
  }

  function renderHero(d) {
    var m = d.market;
    var parts = verdictParts(d);
    append(clear($('verdict')), parts.verdict);
    append(clear($('verdict-support')), parts.support);

    var label = d.as_of ? 'Index attribution · ' + dateLabel(d.as_of) + (isDaily(d.timeframe) ? ' close' : '') : 'Index attribution';
    setText($('hero-eyebrow-text'), label);

    rollTo($('fig-spy'), isNum(m.spy_return) ? signed(m.spy_return, 2, '%') : null);
    rollTo($('fig-mag7'), isNum(m.mag7_contribution_points) ? signed(m.mag7_contribution_points, 2) : null);
    rollTo($('fig-rest'), isNum(m.residual_contribution_points) ? signed(m.residual_contribution_points, 2) : null);

    var partial = m.mode === 'ENGINE_SHARE';
    setText($('fig-spy-note'), partial && !isNum(m.spy_return) ? 'Not carried by this alert' : 'Session return');
    setText($('fig-rest-note'), partial && !isNum(m.residual_contribution_points) ? 'Not carried by this alert' : 'Contribution, SPX points');
  }

  /* ------------------------------------------------------------------ ring */

  function buildTicks() {
    var g = $('ring-ticks');
    if (!g || g.firstChild) return;
    var NS = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 100; i += 2) {
      var a = (i / 100) * Math.PI * 2 - Math.PI / 2;
      var major = i % 25 === 0;
      var r1 = major ? 104 : 105.5;
      var r2 = major ? 112 : 109;
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', (110 + r1 * Math.cos(a)).toFixed(2));
      line.setAttribute('y1', (110 + r1 * Math.sin(a)).toFixed(2));
      line.setAttribute('x2', (110 + r2 * Math.cos(a)).toFixed(2));
      line.setAttribute('y2', (110 + r2 * Math.sin(a)).toFixed(2));
      if (major) line.setAttribute('class', 'major');
      g.appendChild(line);
    }
  }

  function renderRing(d) {
    var m = d.market;
    var s = isNum(m.mag7_impact_share) ? Math.max(0, Math.min(100, m.mag7_impact_share)) : null;
    var GAP = 1.4; // units of 100 — the cardinal gaps of The Turn, at instrument scale
    var mag7 = $('ring-mag7');
    var rest = $('ring-rest');
    var head = $('ring-head');

    if (s === null) {
      mag7.setAttribute('stroke-dasharray', '0 100');
      rest.setAttribute('stroke-dasharray', '0 100');
      head.setAttribute('r', '0');
    } else {
      var a = Math.max(0, s - GAP);
      var b = Math.max(0, 100 - s - GAP);
      mag7.setAttribute('stroke-dasharray', a.toFixed(2) + ' ' + (100 - a).toFixed(2));
      mag7.setAttribute('stroke-dashoffset', (-GAP / 2).toFixed(2));
      rest.setAttribute('stroke-dasharray', b.toFixed(2) + ' ' + (100 - b).toFixed(2));
      rest.setAttribute('stroke-dashoffset', (-(s + GAP / 2)).toFixed(2));
      // A bright head marks where MAG7's share ends — the leading edge.
      var ang = ((s - GAP / 2) / 100) * Math.PI * 2 - Math.PI / 2;
      head.setAttribute('cx', (110 + 84 * Math.cos(ang)).toFixed(2));
      head.setAttribute('cy', (110 + 84 * Math.sin(ang)).toFixed(2));
      head.setAttribute('r', a > 0.5 ? '3.4' : '0');
    }

    rollTo($('ring-share'), s === null ? null : s.toFixed(1) + '%');

    var dir = $('ring-direction');
    var dirText = { DRIVING: 'Driving the index', OFFSETTING: 'Offsetting the index', FLAT: 'Flat', 'N/A': 'Below threshold' };
    dir.dataset.direction = s === null ? '' : m.direction || '';
    setText(dir, s === null ? (d.updated_at ? 'Forming' : 'Awaiting') : dirText[m.direction] || m.direction);

    $('ring-mode').textContent = m.mode === 'FULL' ? 'Computed from the full split.' : m.mode === 'ENGINE_SHARE' ? 'Engine-reported share.' : '';
    $('ring-svg').setAttribute('aria-label', s === null
      ? 'MAG7 share of the index move not yet available'
      : 'MAG7 accounts for ' + s.toFixed(1) + ' percent of gross index movement');
  }

  /* ========================================================== confirmation */

  function kvRow(label, caption, value, tone) {
    var dd = el('dd', { 'data-tone': tone || '' }, value === null || value === undefined ? EM : value);
    if (value === null || value === undefined) dd.classList.add('is-empty');
    return el('div', null, [el('dt', null, [label, caption ? el('small', { text: caption }) : null]), dd]);
  }

  function shareTone(s) { return !isNum(s) ? '' : s >= 60 ? 'watch' : s < 35 ? 'good' : 'info'; }
  function leaderTone(p) { return !isNum(p) ? '' : p >= 5 ? 'good' : p >= 3 ? 'watch' : 'bad'; }
  function breadthTone(b) { return !isNum(b) ? '' : b >= 60 ? 'good' : b >= 45 ? 'watch' : 'bad'; }
  function stanceTone(t) {
    var s = String(t || '').toUpperCase();
    if (!s) return '';
    if (/NOT|NON|DIVERG|FACADE|MISMATCH|FAIL/.test(s)) return 'bad';
    if (/CONFIRM|BROAD|AGREE/.test(s)) return 'good';
    return 'watch';
  }

  function confirmationVerdict(d) {
    var c = d.confirmation || {};
    var m = d.market;
    var p = d.leadership.positive_count;
    if (c.mismatch_state) return { text: c.mismatch_state, tone: stanceTone(c.mismatch_state) };
    if (!isNum(m.mag7_impact_share) && !isNum(p)) return { text: 'Awaiting data', tone: '' };
    if (m.direction === 'OFFSETTING') return { text: 'Divergent', tone: 'warn' };
    if (isNum(p) && p <= 2 && isNum(m.mag7_impact_share) && m.mag7_impact_share >= 60) return { text: 'Narrow — unconfirmed', tone: 'bad' };
    if (isNum(p) && p >= 5) return { text: 'Broadly confirmed', tone: 'good' };
    if (isNum(p) && p <= 2) return { text: 'Narrow', tone: 'warn' };
    return { text: 'Partially confirmed', tone: 'watch' };
  }

  function renderConfirm(d) {
    var m = d.market;
    var c = d.confirmation || {};
    var L = d.leadership;

    var head = clear($('confirm-headline'));
    head.appendChild(kvRow('S&P 500 return', 'SPY, session', isNum(m.spy_return) ? signed(m.spy_return, 2, '%') : null, ''));
    head.appendChild(kvRow('MAG7 share of the move', 'Gross attribution', isNum(m.mag7_impact_share) ? m.mag7_impact_share.toFixed(1) + '%' : null, shareTone(m.mag7_impact_share)));
    head.appendChild(kvRow('MAG7 direction', 'Relative to the index', m.direction && m.direction !== 'N/A' ? titleCase(m.direction) : null, m.direction === 'OFFSETTING' ? 'warn' : m.direction === 'DRIVING' ? 'info' : ''));
    head.appendChild(kvRow('MAG7 moving with it', 'Constituents up on the day', isNum(c.mags_day_breadth) ? c.mags_day_breadth + ' / 7' : null, ''));

    var under = clear($('confirm-internals'));
    under.appendChild(kvRow('Healthy MAG7 leadership', 'Leader or Accumulation', isNum(L.positive_count) ? L.positive_count + ' / 7' : null, leaderTone(L.positive_count)));
    under.appendChild(kvRow('Other 493 advancing', 'Ex-MAG7 breadth', isNum(c.ex_mags_breadth) ? c.ex_mags_breadth.toFixed(1) + '%' : null, breadthTone(c.ex_mags_breadth)));
    under.appendChild(kvRow('Equal vs cap weight', 'Average stock minus index', isNum(c.cap_equal_spread) ? signed(c.cap_equal_spread, 2, ' pp') : null, !isNum(c.cap_equal_spread) ? '' : c.cap_equal_spread >= 0 ? 'good' : 'watch'));
    under.appendChild(kvRow('Stance of the 493', 'Engine read', c.ex_mags_stance ? titleCase(c.ex_mags_stance) : null, stanceTone(c.ex_mags_stance)));

    var v = confirmationVerdict(d);
    var chip = $('confirm-chip');
    chip.dataset.tone = v.tone;
    setText(chip, v.text);

    var hasBroad = isNum(c.ex_mags_breadth) || isNum(c.cap_equal_spread) || c.ex_mags_stance;
    var note = '';
    if (!hasBroad) {
      note = 'Breadth across the other 493 arrives with the engine’s facade alerts. Until then, internals are read from leadership inside MAG7.';
    } else if (isNum(c.facade_persistence_bars) && c.facade_persistence_bars > 0) {
      note = 'The current mismatch has persisted for ' + c.facade_persistence_bars + ' session' + (c.facade_persistence_bars === 1 ? '' : 's') + '.';
    }
    setText($('confirm-note'), note);
    if (!note) $('confirm-note').textContent = '';
  }

  /* ============================================================ leadership */

  function orderedConstituents(d) {
    var rows = (d.constituents || []).slice();
    var seen = {};
    rows.forEach(function (r) { seen[r.ticker] = true; });
    CONFIG.universe.forEach(function (t) { if (!seen[t]) rows.push({ ticker: t, score: null, state: null }); });
    return rows;
  }

  function flowGlyph(flow) {
    return el('span', { className: 'flow', 'data-flow': flow || '', title: flow ? titleCase(flow) : 'No flow reading' },
      flow === 'ENTERING' ? '↗' : flow === 'LEAVING' ? '↘' : flow === 'FLAT' ? '→' : '·');
  }

  function renderLeadership(d) {
    var L = d.leadership;
    rollTo($('breadth-count'), isNum(L.positive_count) ? String(L.positive_count) : null);

    var badge = $('breadth-state');
    var bs = L.breadth_state;
    badge.dataset.tone = BREADTH_TONE[bs] || '';
    setText(badge, bs ? titleCase(bs) + (L.breadth_trend ? ' · ' + titleCase(L.breadth_trend) : '') : 'Breadth pending');

    var list = $('tiles');
    var rows = orderedConstituents(d);
    // Reuse tiles keyed by ticker so the digit roll animates from old to new.
    var existing = {};
    Array.prototype.forEach.call(list.children, function (li) { existing[li.dataset.ticker] = li; });
    clear(list);

    rows.forEach(function (r) {
      var li = existing[r.ticker] || buildTile(r.ticker);
      var state = r.state || '';
      li.dataset.state = state;
      li.dataset.positive = POSITIVE[state] ? 'true' : 'false';
      li.querySelector('.cell__state').textContent = state ? TILE_LABELS[state] || state : 'Awaiting';
      rollTo(li.querySelector('.cell__score'), isNum(r.score) ? r.score.toFixed(1) : null);
      li.querySelector('.cell__bar span').style.width = isNum(r.score) ? Math.max(0, Math.min(100, r.score)) + '%' : '0';
      var foot = clear(li.querySelector('.cell__foot'));
      append(foot, [flowGlyph(r.flow), el('span', { text: isNum(r.delta_5) ? signed(r.delta_5, 1) : '', title: '5-day change in score' })]);
      li.setAttribute('aria-label', r.ticker + ': ' + (isNum(r.score) ? 'score ' + r.score.toFixed(1) + ', ' : '') + (state ? STATE_LABELS[state] || state : 'no reading yet'));
      list.appendChild(li);
    });

    renderFlowSummary(d);
  }

  function renderFlowSummary(d) {
    var box = clear($('flowsum'));
    var rows = d.constituents || [];
    [['ENTERING', 'Entering'], ['LEAVING', 'Leaving']].forEach(function (f) {
      var names = rows.filter(function (r) { return r.flow === f[0]; })
        .sort(function (a, b) { return (b.delta_5 || 0) - (a.delta_5 || 0); });
      var dd = el('dd');
      if (!names.length) dd.appendChild(el('em', { text: rows.length ? 'None' : 'Awaiting readings' }));
      names.forEach(function (r) {
        dd.appendChild(el('span', null, [el('b', { text: r.ticker }), isNum(r.delta_5) ? signed(r.delta_5, 1) : '']));
      });
      box.appendChild(el('div', { 'data-flow': f[0] }, [el('dt', { text: f[1] }), dd]));
    });
  }

  function buildTile(ticker) {
    return el('li', { className: 'cell', 'data-ticker': ticker }, [
      el('span', { className: 'cell__ticker', text: ticker }),
      el('span', { className: 'cell__score' }),
      el('span', { className: 'cell__state' }),
      el('span', { className: 'cell__bar' }, el('span')),
      el('span', { className: 'cell__foot' }),
    ]);
  }

  /* ========================================================== transmission */

  function renderTransmission(d) {
    var t = d.market.transmission;
    var info = TX[t];
    var value = $('tx-value');
    setText(value, info ? info.label : t ? titleCase(t) : 'Pending');
    value.style.setProperty('--tx', info ? info.color : 'var(--graphite)');

    Array.prototype.forEach.call($('tx-scale').children, function (li) {
      li.dataset.active = info && li.dataset.step === info.step ? 'true' : 'false';
      if (info && li.dataset.step === info.step) li.querySelector('span').textContent = info.label;
      else li.querySelector('span').textContent = TX[li.dataset.step].label;
    });

    setText($('tx-definition'), info ? info.def : 'How the MAG7’s move is passing through to the index as a whole. The engine’s call appears here with its next transmission alert.');
  }

  /* ================================================================ gauges */

  var CONCENTRATION = {
    key: 'mag7_impact_share', name: 'Concentration', sub: 'MAG7 share of the index move',
    bands: [[0, 35, 'good'], [35, 60, 'info'], [60, 100, 'watch']],
    read: 'Below 35% the move is broad; above 60% it is concentrated in seven stocks.',
  };
  var GAUGES = [
    {
      key: 'spx_health', stateKey: 'spx_health_state', name: 'SPX Health', sub: 'Internal support beneath the index',
      bands: [[0, 30, 'bad'], [30, 50, 'warn'], [50, 70, 'ok'], [70, 100, 'good']],
      read: 'Higher is healthier. Below 50 the engine calls support fragile; below 30, broken.',
    },
    {
      key: 'index_risk', stateKey: 'index_risk_state', name: 'Index Risk', sub: 'How much of the level rests on a narrow base',
      bands: [[0, 30, 'good'], [30, 60, 'watch'], [60, 100, 'bad']],
      read: 'Lower is better. Between 30 and 60 the engine reads risk as elevated.',
    },
    {
      key: 'structural_risk', name: 'Structural Risk', sub: 'Concentration inside the leadership set',
      bands: [[0, 40, 'good'], [40, 70, 'watch'], [70, 100, 'bad']],
      read: 'Lower is better. At 70 and above, transmission is treated as fragile.',
    },
    {
      key: 'divergence_risk', name: 'Divergence Risk', sub: 'Price versus leadership internals',
      bands: [[0, 30, 'good'], [30, 60, 'watch'], [60, 100, 'bad']],
      read: 'Lower is better. At 60 and above, transmission is treated as broken.',
    },
    {
      key: 'funding_pressure', name: 'Funding Pressure', sub: 'Rotation out of constituents to fund others',
      bands: [[0, 35, 'good'], [35, 60, 'watch'], [60, 100, 'bad']],
      read: 'Lower is calmer. Above 60 the engine flags extreme funding pressure.',
    },
  ];
  var TONE_VAR = { good: 'var(--tone-good)', ok: 'var(--tone-ok)', info: 'var(--tone-info)', watch: 'var(--tone-watch)', warn: 'var(--tone-warn)', bad: 'var(--tone-bad)' };

  function bandFor(spec, v) {
    for (var i = 0; i < spec.bands.length; i++) {
      var b = spec.bands[i];
      if (v >= b[0] && (v < b[1] || i === spec.bands.length - 1)) return b[2];
    }
    return '';
  }

  function gauge(spec, risk, compact) {
    var v = risk[spec.key];
    var has = isNum(v);
    var tone = has ? bandFor(spec, v) : '';
    var engineState = spec.stateKey ? risk[spec.stateKey] : null;
    var clamped = has ? Math.max(0, Math.min(100, v)) : 0;

    var track = el('div', { className: 'gauge__track', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': has ? v.toFixed(1) : null, 'aria-label': spec.name });
    spec.bands.forEach(function (b) {
      track.appendChild(el('span', { className: 'gauge__band', style: 'left:' + b[0] + '%;width:' + (b[1] - b[0]) + '%;background:' + TONE_VAR[b[2]] }));
    });
    var fill = el('span', { className: 'gauge__fill' });
    var marker = el('span', { className: 'gauge__marker' });
    track.appendChild(fill);
    if (has) track.appendChild(marker);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fill.style.width = clamped + '%'; marker.style.left = clamped + '%'; });
    });

    var stateBadge = engineState ? el('span', { className: 'badge gauge__state', 'data-tone': tone, text: titleCase(engineState) }) : null;

    return el('div', { className: 'gauge' + (compact ? ' gauge--compact' : '') + (has ? '' : ' is-empty'), 'data-tone': tone }, [
      el('div', { className: 'gauge__head' }, [
        el('div', { className: 'gauge__name' }, [spec.name, compact ? null : el('small', { text: spec.sub })]),
        el('div', null, [el('span', { className: 'gauge__value', text: has ? v.toFixed(1) : 'Pending' }), stateBadge]),
      ]),
      track,
      el('div', { className: 'gauge__scale' }, [el('span', { text: '0' }), el('span', { text: '50' }), el('span', { text: '100' })]),
      el('p', { className: 'gauge__read', text: spec.read }),
    ]);
  }

  function renderGauges(d) {
    var box = clear($('risk-gauges'));
    GAUGES.forEach(function (g) { box.appendChild(gauge(g, d.risk, false)); });
    box.appendChild(gauge(CONCENTRATION, { mag7_impact_share: d.market.mag7_impact_share }, false));
    var glance = clear($('glance'));
    glance.appendChild(gauge(GAUGES[0], d.risk, true));
    glance.appendChild(gauge(GAUGES[1], d.risk, true));
  }

  /* ================================================================= stats */

  function stat(label, value, caption, opts) {
    opts = opts || {};
    var empty = value === null || value === undefined || value === '';
    var dd = el('dd', { 'data-tone': opts.tone || '' }, empty ? EM : value);
    if (empty) dd.classList.add('is-empty');
    else if (opts.text) dd.classList.add('is-text');
    return el('div', null, [el('dt', { text: label }), dd, caption ? el('p', { text: caption }) : null]);
  }

  function renderDynamics(d) {
    var L = d.leadership;
    var box = clear($('dynamics'));
    box.appendChild(stat('Leadership diffusion', isNum(L.diffusion) ? signed(L.diffusion, 2) : null, 'Negative means leadership is narrowing.', { tone: !isNum(L.diffusion) ? '' : L.diffusion >= 0 ? 'good' : 'warn' }));
    box.appendChild(stat('Average velocity', isNum(L.average_velocity) ? signed(L.average_velocity, 1) : null, 'Mean rate of change of leadership score.', { tone: !isNum(L.average_velocity) ? '' : L.average_velocity >= 0 ? 'good' : 'warn' }));
    box.appendChild(stat('Healthy leaders', isNum(L.positive_count) ? L.positive_count + ' / 7' : null, 'In Leader or Accumulation state.', { tone: leaderTone(L.positive_count) }));
    box.appendChild(stat('Breadth', L.breadth_state ? titleCase(L.breadth_state) : null, L.breadth_trend ? 'Trend: ' + lower(L.breadth_trend) + '.' : 'Engine breadth regime.', { text: true, tone: BREADTH_TONE[L.breadth_state] || '' }));
    box.appendChild(stat('Rotation', L.rotation_state ? titleCase(L.rotation_state) : null, 'The engine’s rotation call.', { text: true }));
    box.appendChild(stat('Leading now', L.positive_tickers && L.positive_tickers.length ? L.positive_tickers.join(' · ') : null, 'Constituents in healthy leadership.', { text: true, tone: 'info' }));
  }

  function renderTripwires(d) {
    var list = clear($('tripwires'));
    var trips = (d.risk && d.risk.tripwires) || [];
    var count = $('trip-count');
    if (!trips.length) {
      count.dataset.tone = d.updated_at ? 'good' : '';
      setText(count, d.updated_at ? 'Clear' : 'Pending');
      list.appendChild(el('li', { className: 'is-clear' }, el('div', null, [
        el('strong', { text: d.updated_at ? 'No tripwires active' : 'Awaiting engine' }),
        el('span', { text: d.updated_at ? 'None of the engine’s structural conditions are currently triggered.' : 'Tripwires publish with the daily snapshot.' }),
      ])));
      return;
    }
    count.dataset.tone = trips.length >= 3 ? 'bad' : 'warn';
    setText(count, trips.length + ' active');
    trips.forEach(function (t) {
      var name = String(t).replace(/_/g, ' ').replace(/\//g, ' / ');
      list.appendChild(el('li', null, el('div', null, [
        el('strong', { text: name }),
        TRIPWIRE_NOTES[t] ? el('span', { text: TRIPWIRE_NOTES[t] }) : null,
      ])));
    });
  }

  function renderConfirmDetail(d) {
    var c = d.confirmation || {};
    var box = clear($('confirm-detail'));
    var pending = 'Arrives with facade alerts.';
    box.appendChild(stat('Ex-MAG7 breadth', isNum(c.ex_mags_breadth) ? c.ex_mags_breadth.toFixed(1) + '%' : null, isNum(c.ex_mags_breadth) ? 'Of the other 493, share advancing.' : pending, { tone: breadthTone(c.ex_mags_breadth) }));
    box.appendChild(stat('Equal-weight return', isNum(c.equal_weight_return) ? signed(c.equal_weight_return, 2, '%') : null, isNum(c.equal_weight_return) ? 'The average S&P stock.' : pending));
    box.appendChild(stat('Cap vs equal spread', isNum(c.cap_equal_spread) ? signed(c.cap_equal_spread, 2, ' pp') : null, isNum(c.cap_equal_spread) ? 'Positive: the average stock beat the index.' : pending, { tone: !isNum(c.cap_equal_spread) ? '' : c.cap_equal_spread >= 0 ? 'good' : 'watch' }));
    box.appendChild(stat('MAG7 up on the day', isNum(c.mags_day_breadth) ? c.mags_day_breadth + ' / 7' : null, isNum(c.mags_day_breadth) ? 'Constituents with a positive session.' : pending));
    box.appendChild(stat('493 stance', c.ex_mags_stance ? titleCase(c.ex_mags_stance) : null, c.ex_mags_stance ? 'Engine read of the broad market.' : pending, { text: true, tone: stanceTone(c.ex_mags_stance) }));
    box.appendChild(stat('Mismatch', c.mismatch_state ? titleCase(c.mismatch_state) : null, c.mismatch_state ? 'Headline versus participation.' : pending, { text: true, tone: stanceTone(c.mismatch_state) }));
    box.appendChild(stat('Mismatch persistence', isNum(c.facade_persistence_bars) ? c.facade_persistence_bars + ' bars' : null, isNum(c.facade_persistence_bars) ? 'Consecutive sessions in the current state.' : pending));
    box.appendChild(stat('MAG7 share', isNum(d.market.mag7_impact_share) ? d.market.mag7_impact_share.toFixed(1) + '%' : null, 'Of gross index movement.', { tone: shareTone(d.market.mag7_impact_share) }));
  }

  /* ============================================================= narrative */

  function strong(t) { return el('strong', { text: t }); }

  function renderNarrative(d) {
    var m = d.market;
    var L = d.leadership;
    var c = d.confirmation || {};
    var r = d.risk;
    var s = m.mag7_impact_share;

    // i. The headline
    var head;
    if (!isNum(s)) {
      head = [d.updated_at ? 'The engine has not yet reported how today’s index move splits between MAG7 and everything else.' : 'No reading has been received yet.'];
    } else if (m.direction === 'OFFSETTING') {
      head = ['MAG7 moved against the index. The other 493 set the direction, and the seven’s ', strong(s.toFixed(1) + '%'), ' share of the movement was ',
        isNum(m.spy_return) ? (m.spy_return >= 0 ? 'drag rather than lift.' : 'a cushion rather than a cause.') : 'working the other way.'];
    } else if (s >= 60) {
      head = ['A concentrated move. ', strong(s.toFixed(1) + '%'), ' of what the index did came from seven stocks, so the headline number says more about MAG7 than about the market as a whole.'];
    } else if (s >= 35) {
      head = ['A shared move. ', strong(s.toFixed(1) + '%'), ' came from MAG7 and ', strong((100 - s).toFixed(1) + '%'), ' from the other 493 — the seven mattered, but they were not the whole story.'];
    } else {
      head = ['A broad-based move. MAG7 accounted for only ', strong(s.toFixed(1) + '%'), ', so the index’s direction came mostly from the wider market.'];
    }
    append(clear($('narr-headline')), head);

    // ii. Underneath
    var under = [];
    if (isNum(L.positive_count)) {
      under.push(strong(L.positive_count + ' of 7'), ' MAG7 names are in healthy leadership');
      under.push(L.positive_count <= 2 ? ', so even inside the group the advance is narrow. ' : L.positive_count >= 5 ? ', a wide base inside the group. ' : '. ');
    }
    if (isNum(c.ex_mags_breadth)) {
      under.push(strong(c.ex_mags_breadth.toFixed(1) + '%'), ' of the other 493 advanced');
      if (isNum(c.cap_equal_spread)) {
        under.push(', and the average stock ', c.cap_equal_spread >= 0 ? 'beat' : 'lagged', ' the cap-weighted index by ', strong(Math.abs(c.cap_equal_spread).toFixed(2) + ' points'));
      }
      under.push('. ');
    }
    var tx = TX[m.transmission];
    if (tx) under.push('The engine reads transmission as ', strong(lower(tx.label)), '.');
    if (!under.length) under.push('Leadership and breadth readings will appear here as the engine reports them.');
    append(clear($('narr-under')), under);

    // iii. What to watch — the most severe active conditions, in order.
    var watch = [];
    if (isNum(r.divergence_risk) && r.divergence_risk >= 60) watch.push([3, ['Divergence risk at ', strong(r.divergence_risk.toFixed(0)), ': price and leadership internals disagree.']]);
    if (isNum(r.spx_health) && r.spx_health < 50) watch.push([r.spx_health < 30 ? 3 : 2, ['SPX Health at ', strong(r.spx_health.toFixed(0)), ' sits in the ', r.spx_health < 30 ? 'broken' : 'fragile', ' band — internal support is thin.']]);
    if (isNum(r.structural_risk) && r.structural_risk >= 70) watch.push([2, ['Structural risk at ', strong(r.structural_risk.toFixed(0)), ': leadership is heavily concentrated.']]);
    if (isNum(r.funding_pressure) && r.funding_pressure >= 50) watch.push([1, ['Funding pressure at ', strong(r.funding_pressure.toFixed(0)), ': capital is being rotated out of some of the seven to pay for others.']]);
    if (isNum(L.diffusion) && L.diffusion < 0) watch.push([1, ['Leadership diffusion is negative (', strong(signed(L.diffusion, 2)), '), meaning leadership is narrowing.']]);
    if (r.index_risk_state && /ELEVATED|HIGH|EXTREME/.test(r.index_risk_state)) watch.push([1, ['Index risk is ', strong(lower(r.index_risk_state)), isNum(r.index_risk) ? ' at ' + r.index_risk.toFixed(0) : '', '.']]);

    var wnodes = [];
    if (watch.length) {
      watch.sort(function (a, b) { return b[0] - a[0]; });
      watch.slice(0, 3).forEach(function (w, i) { if (i) wnodes.push(' '); wnodes = wnodes.concat(w[1]); });
    } else if (d.updated_at) {
      wnodes = ['No structural warnings are active. What would change this read: MAG7’s share rising above 60% on fewer leaders, or SPX Health slipping below 50.'];
    } else {
      wnodes = ['Risk conditions will be summarised here once the engine reports.'];
    }
    append(clear($('narr-watch')), wnodes);
  }

  /* ================================================================= table */

  var sortKey = 'score';
  var sortDir = -1;
  var STATE_ORDER = { LEADER: 5, ACCUM: 4, NEUTRAL: 3, DIST: 2, FUNDING: 1 };

  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (sortKey === 'state') { x = STATE_ORDER[x] || 0; y = STATE_ORDER[y] || 0; }
      if (sortKey === 'ticker' || sortKey === 'flow') { x = String(x || ''); y = String(y || ''); return x.localeCompare(y) * sortDir; }
      if (!isNum(x) && !isNum(y)) return 0;
      if (!isNum(x)) return 1;
      if (!isNum(y)) return -1;
      return (x - y) * sortDir;
    });
  }

  function deltaCell(v) {
    var td = el('td', { className: 'num' });
    if (!isNum(v)) { td.textContent = EM; return td; }
    var w = Math.min(50, Math.abs(v) / 50 * 50);
    td.appendChild(el('span', { className: 'delta', 'data-sign': v > 0 ? 'pos' : v < 0 ? 'neg' : '' }, [
      el('i', null, el('span', { style: 'width:' + w.toFixed(1) + '%' })),
      signed(v, 1),
    ]));
    return td;
  }

  function renderTable(d) {
    var body = clear($('const-body'));
    var rows = d.constituents || [];
    var n = rows.length;
    setText($('coverage-note'), n ? n + ' of 7 reported' + (n < 7 ? ' · rows fill in as the engine calls each name' : '') : '');

    Array.prototype.forEach.call(document.querySelectorAll('#const-table th[data-sort]'), function (th) {
      if (th.dataset.sort === sortKey) th.setAttribute('aria-sort', sortDir < 0 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    });

    if (!n) {
      body.appendChild(el('tr', { className: 'empty-row' }, el('td', { colspan: '11', text: 'No constituent readings yet. Rows appear as the engine reports each name, and all seven arrive together with a daily snapshot.' })));
      return;
    }

    sortRows(rows).forEach(function (r) {
      var st = r.state || '';
      body.appendChild(el('tr', null, [
        el('td', { className: 'num t-rank', text: isNum(r.rank) && r.rank > 0 ? r.rank : EM }),
        el('td', { className: 't-ticker', text: r.ticker }),
        el('td', null, el('span', { className: 'scorecell', 'data-state': st }, [
          el('b', { text: fixed(r.score, 1) }),
          el('i', null, el('span', { style: 'width:' + (isNum(r.score) ? Math.max(0, Math.min(100, r.score)) : 0) + '%' })),
        ])),
        el('td', null, st ? el('span', { className: 'chip', 'data-state': st, text: STATE_LABELS[st] || st }) : EM),
        deltaCell(r.delta_5),
        deltaCell(r.delta_20),
        el('td', { className: 'num', text: isNum(r.rank_change_5) ? signed(r.rank_change_5, 0) : EM }),
        el('td', { className: 'num', text: isNum(r.persistence_bars) ? r.persistence_bars : EM }),
        el('td', { className: 'num', text: isNum(r.velocity) ? signed(r.velocity, 1) : EM }),
        el('td', null, r.flow ? [flowGlyph(r.flow), ' ', titleCase(r.flow)] : EM),
        el('td', { className: 'num', text: fixed(r.risk, 1) }),
      ]));
    });
  }

  function initSort() {
    Array.prototype.forEach.call(document.querySelectorAll('#const-table th[data-sort]'), function (th) {
      th.tabIndex = 0;
      var go = function () {
        var k = th.dataset.sort;
        if (k === sortKey) sortDir = -sortDir;
        else { sortKey = k; sortDir = k === 'ticker' || k === 'rank' ? 1 : -1; }
        if (lastPayload) renderTable(lastPayload);
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  /* ============================================================== timeline */

  function renderTimeline(events) {
    var list = clear($('timeline'));
    events = events || [];
    if (!events.length) {
      list.appendChild(el('li', { className: 'timeline__empty', text: 'No engine events yet. Each alert the engine fires — new leaders, distribution, transmission and risk calls — is recorded here.' }));
      return;
    }
    var lastDay = null;
    events.forEach(function (e) {
      var day = dateLabel(e.time || e.received_at);
      if (day !== lastDay) {
        list.appendChild(el('li', { className: 'timeline__day', 'aria-hidden': 'true', text: day + ' session' }));
        lastDay = day;
      }
      var def = EVENTS[e.event] || [titleCase(e.event), 'info', ''];
      var subject = e.ticker && CONFIG.universe.indexOf(e.ticker) >= 0 ? e.ticker : null;
      var desc = def[2].replace('{t}', subject || 'A constituent');
      var detail = [e.state ? titleCase(e.state) : null, isNum(e.score) ? e.score.toFixed(1) : null].filter(Boolean).join(' · ');
      var meta = [el('b', { text: timeLabel(e.received_at || e.time) }), detail ? el('span', { text: detail }) : null];
      list.appendChild(el('li', { className: 'timeline__event', 'data-family': def[1] }, [
        el('div', null, [el('span', { className: 'timeline__title', text: def[0] }), subject ? el('span', { className: 'timeline__subject', text: subject }) : null]),
        el('div', { className: 'timeline__meta' }, meta),
        desc ? el('p', { className: 'timeline__desc', text: desc }) : null,
      ]));
    });
  }

  /* ================================================================== data */

  function renderData(d) {
    $('json-view').textContent = JSON.stringify(d, null, 2);
    var box = clear($('engine-meta'));
    box.appendChild(stat('Engine', d.engine && d.engine.version ? 'v' + d.engine.version : null, d.engine && d.engine.name ? d.engine.name : 'MAGS Leadership Rotation Engine', { text: true }));
    box.appendChild(stat('Timeframe', d.timeframe ? d.timeframe + (d.confirmed ? ' · confirmed' : '') : null, 'Alerts fire on confirmed bars only.', { text: true }));
    box.appendChild(stat('Attribution', d.market.mode === 'FULL' ? 'Full split' : d.market.mode === 'ENGINE_SHARE' ? 'Engine share' : 'Pending', d.market.mode === 'ENGINE_SHARE' ? 'SPY return not carried by the latest alert.' : 'Computed from raw engine values.', { text: true }));
    box.appendChild(stat('Proxy', d.proxy_symbol, 'S&P 500 return proxy.', { text: true }));
  }

  /* ================================================================ render */

  function render(d) {
    if (!d || !d.market) return;
    var first = !lastPayload;
    lastPayload = d;
    renderStatus(d);
    renderHero(d);
    renderRing(d);
    renderConfirm(d);
    renderLeadership(d);
    renderTransmission(d);
    renderGauges(d);
    renderNarrative(d);
    renderDynamics(d);
    renderTripwires(d);
    renderConfirmDetail(d);
    renderTable(d);
    renderTimeline(d.events);
    renderData(d);

    if (window.SEEngine) {
      window.SEEngine.setState({
        impactShare: d.market.mag7_impact_share,
        direction: d.market.direction,
        transmission: d.market.transmission,
      });
      if (!first || d.updated_at) window.SEEngine.pulse();
    }
  }

  /* ================================================================== tabs */

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var ink = document.querySelector('.tabs__ink');

    function moveInk(tab) {
      if (!ink || !tab) return;
      ink.style.width = tab.offsetWidth + 'px';
      ink.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
    }
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = $(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
      moveInk(tab);
      if (window.SEEngine && window.SEEngine.refreshNodes) setTimeout(window.SEEngine.refreshNodes, 60);
      try { history.replaceState(null, '', '#' + tab.id.replace('tab-', '')); } catch (e) { /* sandboxed frame */ }
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); select(tabs[j], true); }
      });
    });

    var initial = $('tab-' + (location.hash || '').replace('#', '')) || tabs[0];
    select(initial, false);
    window.addEventListener('resize', function () { moveInk(document.querySelector('.tab[aria-selected="true"]')); }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveInk(document.querySelector('.tab[aria-selected="true"]')); });
  }

  function initCopy() {
    var btn = $('copy-json');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var text = $('json-view').textContent;
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy JSON'; }, 1500);
      }, function () {});
    });
  }

  /* ============================================================= transport */

  function setConn(text, live) {
    setText($('conn-state'), text);
    $('conn-led').dataset.live = live ? 'true' : 'false';
  }

  function fetchLatest() {
    return fetch(CONFIG.latestUrl, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        transportStatus = null;
        render(d);
        setConn('Polling · every 30s', true);
      })
      .catch(function () {
        transportStatus = 'OFFLINE';
        renderStatus(lastPayload);
        setConn('Offline — retrying', false);
      });
  }

  var polling = false;
  function startPolling() {
    if (polling) return;
    polling = true;
    fetchLatest();
    setInterval(fetchLatest, CONFIG.pollMs);
  }

  function start() {
    if (typeof EventSource === 'undefined') return startPolling();
    var es;
    try { es = new EventSource(CONFIG.streamUrl); } catch (e) { return startPolling(); }

    es.addEventListener('open', function () { transportStatus = null; setConn('Live stream', true); });
    es.addEventListener('update', function (evt) {
      try { render(JSON.parse(evt.data)); setConn('Live stream', true); } catch (e) { /* next frame corrects it */ }
    });
    es.addEventListener('error', function () {
      // EventSource reconnects on its own; polling covers proxies that block SSE.
      setConn('Stream interrupted — polling', false);
      startPolling();
    });
  }

  /* ================================================================== boot */

  document.addEventListener('DOMContentLoaded', function () {
    buildTicks();
    initTabs();
    initSort();
    initCopy();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(function () { renderStatus(lastPayload); }, 15000);

    // Render the empty shell immediately so nothing reads as broken while the
    // first response is in flight.
    render({
      market: { mode: 'NONE', direction: 'N/A' }, leadership: {}, risk: { tripwires: [] },
      confirmation: {}, constituents: [], events: [], timeframe: '1D',
    });
    lastPayload = null;

    if (window.__PREVIEW__) {
      render(window.__PREVIEW__);
      setConn('Static preview', false);
      return;
    }
    start();
  });
})();
