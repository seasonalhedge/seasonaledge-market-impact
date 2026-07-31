/* =============================================================================
   SeasonalEDGE Market Impact — rendering logic
   Vanilla JS, no framework. Every value that originates from the webhook is
   written with textContent or a dataset attribute; innerHTML is never used with
   dynamic content, so webhook strings cannot inject markup.
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    latestUrl: '/api/mags-lre/latest',
    eventsUrl: '/api/mags-lre/events?limit=25',
    streamUrl: '/api/mags-lre/stream',
    pollMs: 30000,
    universe: ['MSFT', 'META', 'AAPL', 'AMZN', 'GOOGL', 'NVDA', 'TSLA'],
  };

  var STATE_LABELS = {
    LEADER: 'Leader',
    ACCUM: 'Accumulation',
    NEUTRAL: 'Neutral',
    DIST: 'Distribution',
    FUNDING: 'Funding',
  };
  var POSITIVE_STATES = ['LEADER', 'ACCUM'];

  var TRANSMISSION_DEFINITIONS = {
    BROAD: 'At least five healthy leaders with positive diffusion and velocity.',
    HEALTHY: 'Index support is reasonably distributed.',
    CONCENTRATED:
      'MAG7 is driving a large share of the index through three or fewer healthy leaders.',
    FRAGILE: 'Internal structure is weak or MAG7 is offsetting the index.',
    BROKEN: 'Severe health deterioration or active divergence.',
  };

  var MINUS = '−'; // typographic minus, keeps figures aligned
  var EM = '—';

  /* ------------------------------------------------------------- utilities */

  function $(id) {
    return document.getElementById(id);
  }

  function setText(el, value) {
    if (el) el.textContent = value === null || value === undefined || value === '' ? EM : String(value);
  }

  var reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Digital roll. Each digit becomes a column holding two 0–9 strips; the
   * column translates a full turn plus the target digit, staggered left to
   * right, so a changing figure physically rolls into place.
   *
   * Built entirely from createElement/textContent — the value is never parsed
   * as markup, and non-digits pass through as static glyphs.
   */
  function rollTo(el, value) {
    if (!el) return;
    var text = value === null || value === undefined || value === '' ? EM : String(value);
    if (el.dataset.roll === text) return;
    var isUpdate = el.dataset.roll !== undefined;
    el.dataset.roll = text;

    if (reduceMotion) {
      el.textContent = text;
      return;
    }

    el.textContent = '';

    // The rolling columns contain every digit 0–9 and would be gibberish to a
    // screen reader, so they are hidden and the real value is exposed instead.
    var sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = text;
    el.appendChild(sr);

    var wrap = document.createElement('span');
    wrap.className = 'roll';
    wrap.setAttribute('aria-hidden', 'true');

    var digitIndex = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch >= '0' && ch <= '9') {
        var col = document.createElement('span');
        col.className = 'roll__col';
        var strip = document.createElement('span');
        strip.className = 'roll__strip';
        // Two passes so every column travels a full revolution.
        for (var d = 0; d < 20; d++) {
          var s = document.createElement('span');
          s.textContent = String(d % 10);
          strip.appendChild(s);
        }
        strip.style.transitionDelay = digitIndex * 34 + 'ms';
        col.appendChild(strip);
        wrap.appendChild(col);
        (function (stripEl, target) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              stripEl.style.transform = 'translateY(-' + (10 + target) + 'em)';
            });
          });
        })(strip, Number(ch));
        digitIndex++;
      } else {
        var stat = document.createElement('span');
        stat.className = 'roll__static';
        stat.textContent = ch;
        wrap.appendChild(stat);
      }
    }

    el.appendChild(wrap);

    if (isUpdate) {
      el.classList.remove('roll--printing');
      void el.offsetWidth; // restart the flash
      el.classList.add('roll--printing');
    }
  }

  function setData(el, key, value) {
    if (el) el.dataset[key] = value === null || value === undefined ? '' : String(value);
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /** Signed fixed-decimal string using a typographic minus. */
  function signed(v, dp, suffix) {
    if (!isNum(v)) return EM;
    var s = Math.abs(v).toFixed(dp);
    var sign = v > 0 ? '+' : v < 0 ? MINUS : '';
    return sign + s + (suffix || '');
  }

  function plain(v, dp, suffix) {
    if (!isNum(v)) return EM;
    return v.toFixed(dp) + (suffix || '');
  }

  function directionClass(v) {
    if (!isNum(v) || v === 0) return 'value-flat';
    return v > 0 ? 'value-up' : 'value-down';
  }

  function applyValueClass(el, v) {
    if (!el) return;
    el.classList.remove('value-up', 'value-down', 'value-flat');
    el.classList.add(directionClass(v));
  }

  function formatTime(iso, withDate) {
    if (!iso) return EM;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return EM;
    var opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (withDate) {
      opts.month = 'short';
      opts.day = 'numeric';
    }
    try {
      return new Intl.DateTimeFormat(undefined, opts).format(d);
    } catch (e) {
      return d.toISOString();
    }
  }

  function relativeAge(iso) {
    if (!iso) return '';
    var secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return Math.round(secs) + 's ago';
    if (secs < 3600) return Math.round(secs / 60) + 'm ago';
    if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
    return Math.round(secs / 86400) + 'd ago';
  }

  function cell(tag, text, className) {
    var el = document.createElement(tag);
    el.textContent = text === null || text === undefined || text === '' ? EM : String(text);
    if (className) el.className = className;
    return el;
  }

  function emptyRow(tbody, colspan, message) {
    var tr = document.createElement('tr');
    tr.className = 'empty-row';
    var td = document.createElement('td');
    td.colSpan = colspan;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  /* ------------------------------------------------------------ public copy */

  /**
   * Primary hero sentence. Follows the DYNAMIC PUBLIC COPY matrix:
   * direction first, then transmission state.
   */
  function heroStatement(d) {
    var m = d.market;
    var share = m.mag7_impact_share;
    var t = m.transmission;

    if (m.direction === 'N/A' || !isNum(m.spy_return)) {
      return 'Index attribution is not yet available for this session.';
    }
    if (m.direction === 'OFFSETTING') {
      return 'MAG7 is opposing today’s SPX move.';
    }
    if (m.direction === 'FLAT') {
      return 'MAG7 is contributing almost nothing to today’s SPX movement.';
    }
    if (t === 'BROKEN') {
      return 'SPX price and MAG7 leadership internals are no longer confirming one another.';
    }
    if (!isNum(share)) {
      return 'MAG7 is moving with the index today.';
    }
    return 'MAG7 is driving ' + share.toFixed(1) + '% of today’s SPX movement.';
  }

  /** Supporting line beneath the hero statement. */
  function heroSupport(d) {
    var m = d.market;
    var count = d.leadership.positive_count;
    var universe = d.leadership.universe_count || 7;
    var parts = [];

    if (m.direction === 'OFFSETTING' && isNum(m.mag7_contribution_points)) {
      parts.push(
        'MAG7 contributed ' +
          signed(m.mag7_contribution_points, 2) +
          ' percentage points against the index direction.'
      );
    } else if (m.direction === 'DRIVING' && isNum(count)) {
      if (m.transmission === 'CONCENTRATED') {
        parts.push('Healthy leadership exists in only ' + count + ' of ' + universe + ' stocks.');
      } else if (m.transmission === 'BROAD') {
        parts.push(
          'Participation is broad across ' + count + ' of ' + universe + ' stocks.'
        );
      }
    }

    if (m.transmission === 'FRAGILE' && isNum(m.spy_return)) {
      parts.push(
        'SPX is moving ' +
          (m.spy_return >= 0 ? 'higher' : 'lower') +
          ', but its leadership structure remains fragile.'
      );
    }

    if (isNum(m.spy_return) && isNum(m.mag7_contribution_points)) {
      parts.push(
        'SPY is ' +
          signed(m.spy_return, 2, '%') +
          ' today. MAG7 contributed ' +
          signed(m.mag7_contribution_points, 2) +
          ' SPX percentage points.'
      );
    }

    return parts.join(' ');
  }

  /**
   * Plain-English interpretation. Deliberately free of indicator names,
   * scores and formulas — this is the public-facing sentence.
   */
  function interpretation(d) {
    var m = d.market;
    var count = d.leadership.positive_count;
    var universe = d.leadership.universe_count || 7;

    if (m.direction === 'N/A' || !isNum(m.spy_return)) {
      return 'There is not enough movement in the index today to attribute meaningfully between the largest companies and everything else.';
    }

    var moveWord = m.spy_return > 0 ? 'rising' : m.spy_return < 0 ? 'falling' : 'flat';
    var leaderWord =
      count === 1 ? 'only one constituent currently has' : 'only ' + count + ' constituents currently have';

    if (m.transmission === 'BROKEN') {
      return 'The index and its largest companies are telling different stories right now, which historically makes the current price move less reliable.';
    }
    if (m.direction === 'OFFSETTING') {
      return (
        'The index is ' +
        moveWord +
        ' despite the largest companies, not because of them — the rest of the market is carrying the move while the biggest names pull the other way.'
      );
    }
    if (m.direction === 'FLAT') {
      return 'The largest companies are sitting out today’s move; whatever the index is doing is coming from everything else.';
    }
    if (m.transmission === 'CONCENTRATED' && isNum(count)) {
      return (
        'The index is ' +
        moveWord +
        ', but almost the entire move depends on the largest companies — and ' +
        leaderWord +
        ' healthy structural leadership.'
      );
    }
    if (m.transmission === 'FRAGILE') {
      return (
        'The index is ' +
        moveWord +
        ', but the companies leading it are not in strong shape, so the move rests on a narrower base than the headline number suggests.'
      );
    }
    if (m.transmission === 'BROAD' && isNum(count)) {
      return (
        'The index is ' +
        moveWord +
        ' with the largest companies participating widely — ' +
        count +
        ' of ' +
        universe +
        ' show healthy leadership, which makes the move broadly supported.'
      );
    }
    return (
      'The index is ' +
      moveWord +
      ', and support for the move is reasonably spread between the largest companies and the rest of the market.'
    );
  }

  /* ------------------------------------------------------------- rendering */

  function renderHeader(d) {
    var status = $('data-status');
    setText(status, d.data_status || EM);
    setData(status, 'status', d.data_status || '');

    var age = d.updated_at ? ' (' + relativeAge(d.updated_at) + ')' : '';
    setText($('last-update'), d.updated_at ? formatTime(d.updated_at, true) + age : EM);
    setText($('timeframe'), (d.timeframe || '1D') + (d.confirmed ? ' Confirmed' : ' Intraday'));
    setText($('proxy-symbol'), d.proxy_symbol || EM);

    setText(
      $('confirmation-note'),
      d.confirmed
        ? 'Values confirmed at the daily close' +
            (d.snapshot_at ? ' · snapshot ' + formatTime(d.snapshot_at, true) : '') +
            '.'
        : 'Values are intraday and will be restated at the confirmed daily close.'
    );
  }

  function renderHero(d) {
    var m = d.market;
    setText($('hero-statement'), heroStatement(d));
    setText($('hero-support'), heroSupport(d));

    var spy = $('fig-spy');
    rollTo(spy, signed(m.spy_return, 2, '%'));
    applyValueClass(spy, m.spy_return);

    var mag7 = $('fig-mag7');
    rollTo(mag7, signed(m.mag7_contribution_points, 2, ' pts'));
    applyValueClass(mag7, m.mag7_contribution_points);

    var resid = $('fig-residual');
    rollTo(resid, signed(m.residual_contribution_points, 2, ' pts'));
    applyValueClass(resid, m.residual_contribution_points);
  }

  function renderEquation(d) {
    var m = d.market;
    if (!isNum(m.mag7_contribution_points) || !isNum(m.residual_contribution_points) || !isNum(m.spy_return)) {
      rollTo($('equation'), EM);
      return;
    }
    var residual = m.residual_contribution_points;
    var joiner = residual < 0 ? ' ' + MINUS + ' ' : ' + ';
    rollTo(
      $('equation'),
      signed(m.mag7_contribution_points, 2) +
        ' points' +
        joiner +
        Math.abs(residual).toFixed(2) +
        ' points = ' +
        signed(m.spy_return, 2, '%')
    );
  }

  function renderBar(d) {
    var m = d.market;
    var pill = $('direction-pill');
    setText(pill, m.direction || 'N/A');
    setData(pill, 'direction', m.direction || 'N/A');

    var mag7Seg = $('seg-mag7');
    var residSeg = $('seg-residual');
    var share = m.mag7_impact_share;

    if (!isNum(share)) {
      mag7Seg.style.flexBasis = '0%';
      residSeg.style.flexBasis = '100%';
      setText($('seg-mag7-value'), '');
      setText($('seg-residual-value'), 'No reliable attribution');
      rollTo($('legend-mag7'), EM);
      rollTo($('legend-residual'), EM);
      $('attribution-bar').setAttribute('aria-label', 'Attribution unavailable');
      return;
    }

    var residShare = isNum(m.residual_share) ? m.residual_share : 100 - share;
    mag7Seg.style.flexBasis = share + '%';
    residSeg.style.flexBasis = residShare + '%';

    // Hide in-segment labels when a segment is too narrow to hold them.
    $('seg-mag7-value').textContent = share >= 14 ? share.toFixed(1) + '%' : '';
    $('seg-residual-value').textContent = residShare >= 14 ? residShare.toFixed(1) + '%' : '';

    rollTo($('legend-mag7'), share.toFixed(1) + '%');
    rollTo($('legend-residual'), residShare.toFixed(1) + '%');
    $('attribution-bar').setAttribute(
      'aria-label',
      'MAG7 ' + share.toFixed(1) + ' percent of gross movement, rest of SPX ' + residShare.toFixed(1) + ' percent'
    );
  }

  function renderBreadth(d) {
    var l = d.leadership;
    var universe = l.universe_count || 7;
    rollTo($('breadth-count'), (isNum(l.positive_count) ? l.positive_count : EM) + ' / ' + universe);

    var byTicker = {};
    (d.constituents || []).forEach(function (c) {
      byTicker[c.ticker] = c;
    });

    var list = $('constituent-cells');
    list.textContent = '';
    CONFIG.universe.forEach(function (ticker) {
      var c = byTicker[ticker];
      var state = c && c.state ? c.state : null;
      var li = document.createElement('li');
      li.className = 'cell';
      li.dataset.state = state || '';
      li.dataset.positive = state && POSITIVE_STATES.indexOf(state) !== -1 ? 'true' : 'false';
      li.appendChild(cell('span', ticker, 'cell__ticker'));
      li.appendChild(cell('span', state ? STATE_LABELS[state] || state : 'No data', 'cell__state'));
      list.appendChild(li);
    });

    var positives = (l.positive_tickers || []).join(', ');
    setText($('breadth-positive'), positives || 'None');

    var badge = $('breadth-state');
    setText(badge, l.breadth_state || EM);
    setData(badge, 'breadth', l.breadth_state || '');
  }

  function renderTransmission(d) {
    var t = d.market.transmission;
    var el = $('transmission-value');
    setText(el, t || EM);
    setData(el, 'transmission', t || '');
    setText($('transmission-definition'), t ? TRANSMISSION_DEFINITIONS[t] || '' : EM);

    // The card carries the state so the meter can inherit its colour.
    var card = el.closest('.card--transmission');
    if (card) setData(card, 'transmission', t || '');

    // Meter shows how much of the universe holds healthy leadership — the
    // structural basis for whatever transmission state is displayed.
    var l = d.leadership;
    var fill = $('transmission-meter-fill');
    if (fill) {
      var pct =
        isNum(l.positive_count) && l.universe_count
          ? (l.positive_count / l.universe_count) * 100
          : 0;
      fill.style.width = pct.toFixed(1) + '%';
    }
  }

  function renderInterpretation(d) {
    setText($('interpretation'), interpretation(d));
  }

  function renderProfessional(d) {
    var r = d.risk;
    var l = d.leadership;

    var metrics = [
      { label: 'SPX Health', value: plain(r.spx_health, 1), state: r.spx_health_state },
      { label: 'Index Risk', value: plain(r.index_risk, 1), state: r.index_risk_state },
      { label: 'Structural Risk', value: plain(r.structural_risk, 1), state: null },
      { label: 'Divergence Risk', value: plain(r.divergence_risk, 1), state: null },
      { label: 'Funding Pressure', value: plain(r.funding_pressure, 1), state: null },
      { label: 'Leadership Diffusion', value: signed(l.diffusion, 2), state: null },
      { label: 'Average Velocity', value: signed(l.average_velocity, 1), state: null },
      { label: 'Breadth Trend', value: l.breadth_trend || EM, state: l.breadth_state },
      { label: 'Rotation', value: l.rotation_state || EM, state: null },
      {
        label: 'Healthy Leaders',
        value: (isNum(l.positive_count) ? l.positive_count : EM) + ' / ' + (l.universe_count || 7),
        state: null,
      },
    ];

    var grid = $('metric-grid');
    grid.textContent = '';
    metrics.forEach(function (m) {
      var wrap = document.createElement('div');
      wrap.className = 'metric';
      wrap.appendChild(cell('dt', m.label));
      var dd = document.createElement('dd');
      dd.textContent = m.value;
      if (m.state) dd.appendChild(cell('span', m.state, 'metric__state'));
      wrap.appendChild(dd);
      grid.appendChild(wrap);
    });

    var tw = $('tripwires');
    tw.textContent = '';
    var list = r.tripwires && r.tripwires.length ? r.tripwires : null;
    if (!list) {
      tw.appendChild(cell('li', 'None active', 'tripwire tripwire--none'));
    } else {
      list.forEach(function (t) {
        tw.appendChild(cell('li', t, 'tripwire'));
      });
    }
  }

  function renderRotation(d) {
    var tbody = $('rotation-body');
    tbody.textContent = '';
    var rows = d.constituents || [];

    setText(
      $('coverage-note'),
      rows.length + ' of ' + (d.leadership.universe_count || 7) + ' constituents known' +
        (rows.length < 7 ? ' · awaiting DASHBOARD_SNAPSHOT' : '')
    );

    if (!rows.length) {
      emptyRow(tbody, 11, 'No constituent data received yet.');
      return;
    }

    rows.forEach(function (c, i) {
      var tr = document.createElement('tr');
      tr.appendChild(cell('td', isNum(c.rank) ? c.rank : i + 1, 'num'));
      tr.appendChild(cell('td', c.ticker, 'ticker'));
      tr.appendChild(cell('td', plain(c.score, 1), 'num'));

      var stateTd = document.createElement('td');
      var tag = cell('span', c.state ? STATE_LABELS[c.state] || c.state : EM, 'state-tag');
      tag.dataset.state = c.state || '';
      stateTd.appendChild(tag);
      tr.appendChild(stateTd);

      tr.appendChild(cell('td', signed(c.delta_5, 1), 'num'));
      tr.appendChild(cell('td', signed(c.delta_20, 1), 'num'));
      tr.appendChild(cell('td', signed(c.rank_change_5, 0), 'num'));
      tr.appendChild(cell('td', isNum(c.persistence_bars) ? c.persistence_bars : EM, 'num'));
      tr.appendChild(cell('td', signed(c.velocity, 1), 'num'));

      var flowTd = document.createElement('td');
      var flow = cell('span', c.flow || EM, 'flow-tag');
      flow.dataset.flow = c.flow || '';
      flowTd.appendChild(flow);
      tr.appendChild(flowTd);

      tr.appendChild(cell('td', plain(c.risk, 1), 'num'));
      tbody.appendChild(tr);
    });
  }

  function renderEvents(events) {
    var tbody = $('events-body');
    tbody.textContent = '';
    if (!events || !events.length) {
      emptyRow(tbody, 7, 'No events received yet.');
      return;
    }
    events.slice(0, 25).forEach(function (e) {
      var tr = document.createElement('tr');
      tr.appendChild(cell('td', formatTime(e.time, true)));
      tr.appendChild(cell('td', e.event));
      tr.appendChild(cell('td', e.ticker));
      tr.appendChild(cell('td', e.state));
      tr.appendChild(cell('td', isNum(e.score) ? e.score.toFixed(1) : EM, 'num'));
      tr.appendChild(cell('td', e.transmission));
      tr.appendChild(cell('td', isNum(e.index_risk) ? e.index_risk.toFixed(1) : EM, 'num'));
      tbody.appendChild(tr);
    });
  }

  function renderJson(d) {
    // JSON.stringify output is inserted as text only — never parsed as markup.
    $('json-view').textContent = JSON.stringify(d, null, 2);
  }

  function render(d) {
    if (!d || !d.market) return;
    lastPayload = d;
    renderHeader(d);
    renderHero(d);
    renderEquation(d);
    renderBar(d);
    renderBreadth(d);
    renderTransmission(d);
    renderInterpretation(d);
    renderProfessional(d);
    renderRotation(d);
    renderEvents(d.events);
    renderJson(d);

    // Hand the engine the two things it visualises: how much capital is
    // routing through MAG7, and which nodes it should pool at.
    if (window.SEEngine) {
      window.SEEngine.setState({
        impactShare: d.market.mag7_impact_share,
        direction: d.market.direction,
        transmission: d.market.transmission,
      });
      window.SEEngine.pulse();
    }
  }

  /* ------------------------------------------------------------------ tabs */

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var selected = t === tab;
          t.setAttribute('aria-selected', selected ? 'true' : 'false');
          var panel = $(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !selected;
        });
      });
    });
  }

  function initCopyButton() {
    var btn = $('copy-json');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var text = $('json-view').textContent;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () {
          btn.textContent = 'Copy JSON';
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  }

  /* ------------------------------------------------------------- transport */

  var lastPayload = null;

  function setConn(text, live) {
    setText($('conn-state'), text);
    var led = $('conn-led');
    if (led) led.dataset.live = live ? 'true' : 'false';
  }

  /**
   * Live session clock. This ticks because time genuinely passes — market
   * figures are only ever redrawn when the engine sends new data, never
   * simulated between updates.
   */
  function tickClock() {
    var el = $('session-clock');
    if (!el) return;
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return '00';
    };
    var hh = Number(get('hour'));
    var mm = Number(get('minute'));
    var weekday = get('weekday');
    var minutes = hh * 60 + mm;
    var weekend = weekday === 'Sat' || weekday === 'Sun';
    var open = 9 * 60 + 30;
    var close = 16 * 60;
    var clock = get('hour') + ':' + get('minute') + ':' + get('second');

    var suffix;
    if (weekend) {
      suffix = 'CLOSED';
    } else if (minutes < open) {
      suffix = 'PRE · ' + fmtGap(open - minutes) + ' to open';
    } else if (minutes < close) {
      suffix = fmtGap(close - minutes) + ' to close';
    } else {
      suffix = 'POST';
    }
    el.textContent = clock + ' ET · ' + suffix;
  }

  function fmtGap(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h ? h + 'h ' + m + 'm' : m + 'm';
  }

  function fetchLatest() {
    return fetch(CONFIG.latestUrl, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        render(d);
        setConn('POLLING · ' + formatTime(new Date().toISOString()), true);
      })
      .catch(function (err) {
        setConn('OFFLINE — ' + err.message, false);
      });
  }

  function startPolling() {
    fetchLatest();
    setInterval(fetchLatest, CONFIG.pollMs);
  }

  function start() {
    if (typeof EventSource === 'undefined') return startPolling();

    var es;
    var fellBack = false;
    try {
      es = new EventSource(CONFIG.streamUrl);
    } catch (e) {
      return startPolling();
    }

    es.addEventListener('open', function () {
      setConn('LIVE STREAM', true);
    });

    es.addEventListener('update', function (evt) {
      try {
        render(JSON.parse(evt.data));
        setConn('LIVE STREAM · ' + formatTime(new Date().toISOString()), true);
      } catch (e) {
        /* malformed frame — the next poll or frame will correct it */
      }
    });

    es.addEventListener('error', function () {
      // EventSource retries on its own; fall back to polling once so the page
      // keeps updating even when SSE is unavailable behind a proxy.
      if (!fellBack) {
        fellBack = true;
        setConn('STREAM UNAVAILABLE — polling every 30s', false);
        startPolling();
      }
    });

    // Belt and braces: refresh the relative timestamp even without new frames.
    setInterval(function () {
      if (lastPayload) renderHeader(lastPayload);
    }, 15000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTabs();
    initCopyButton();
    renderEvents([]);
    tickClock();
    setInterval(tickClock, 1000);

    // Static preview mode: a page may bake a dashboard payload into
    // window.__PREVIEW__ to render without a backend (used by preview.html).
    if (window.__PREVIEW__) {
      render(window.__PREVIEW__);
      setConn('STATIC PREVIEW — no live connection', false);
      return;
    }
    start();
  });
})();
