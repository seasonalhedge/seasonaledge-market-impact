/* =============================================================================
   SeasonalEDGE Market Impact — command environment engine

   Four independent systems, one rAF loop:
     1. CAPITAL   — particles spawn at the market edge, route through the
                    substrate and pool at whichever nodes currently hold healthy
                    leadership. Flow volume tracks the MAG7 impact share.
     2. BREATH    — a scoring pulse emitted from the hero core on a slow cycle,
                    plus halo respiration at every active node.
     3. SPOTLIGHT — pointer position published as CSS variables; the stylesheet
                    does the rest (substrate reveal + per-panel specular).
     4. PARALLAX  — [data-depth] elements offset against pointer travel.

   Purely decorative: the canvas is aria-hidden, carries no information that
   isn't already in the DOM, and disables itself under prefers-reduced-motion.
   ========================================================================== */
(function (global) {
  'use strict';

  var reduceMotion =
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;

  var canvas = null;
  var ctx = null;
  var dpr = 1;
  var W = 0;
  var H = 0;

  var particles = [];
  var nodes = [];          // active pooling targets, viewport coordinates
  var core = null;         // hero element rect — origin of the scoring pulse
  var rings = [];          // expanding scoring sweeps

  var state = {
    intensity: 0.4,        // 0–1, driven by MAG7 impact share
    direction: 'N/A',
    transmission: null,
    // Brand season palette: MAG7 capital rides winter (#60A5FA), the rest of
    // the index rides fall (#F97316). Read off the stylesheet at boot so the
    // canvas and the CSS can never drift apart.
    accent: [96, 165, 250],
    residual: [249, 115, 22],
  };

  var pointer = { x: 0.5, y: 0.35, tx: 0.5, ty: 0.35 };
  var running = false;
  var lastT = 0;
  var nodeRefreshT = 0;

  /* ---------------------------------------------------------- brand tokens */

  /**
   * Resolve a CSS custom property to an [r,g,b] triple.
   * Accepts "#RGB", "#RRGGBB" and "r g b" / "r, g, b" forms, so the same reader
   * works for --winter (#60A5FA) and for --info-rgb (96 165 250).
   */
  function readRgbToken(name, fallback) {
    try {
      var raw = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      if (!raw) return fallback;

      if (raw.charAt(0) === '#') {
        var hex = raw.slice(1);
        if (hex.length === 3) {
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (hex.length < 6) return fallback;
        var n = parseInt(hex.slice(0, 6), 16);
        if (!isFinite(n)) return fallback;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }

      var parts = raw.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.every(function (v) { return isFinite(v); })) {
        return [parts[0], parts[1], parts[2]];
      }
    } catch (err) {
      /* fall through to the baked-in brand values */
    }
    return fallback;
  }

  /**
   * Pull the capital colours off the stylesheet so the canvas always matches
   * the brand tokens. If the sheet has not parsed yet the baked season values
   * stand in — they are the same colours, so a miss is invisible.
   */
  function syncBrandTokens() {
    state.accent = readRgbToken('--color-mag7', state.accent);
    state.residual = readRgbToken('--color-residual', state.residual);
  }

  /* --------------------------------------------------------------- sprites */

  // Pre-rendered radial sprite; drawing a cached bitmap with 'lighter' is an
  // order of magnitude cheaper than per-particle shadowBlur.
  function makeSprite(rgb, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(' + rgb.join(',') + ',1)');
    grad.addColorStop(0.28, 'rgba(' + rgb.join(',') + ',0.55)');
    grad.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  var spriteAccent = null;
  var spriteResidual = null;

  /* ------------------------------------------------------------ dimensions */

  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    refreshNodes();
  }

  /** Particle budget scales with viewport area and current flow intensity. */
  function targetCount() {
    var area = W * H;
    var base = Math.round(area / 9000);
    var capped = Math.max(28, Math.min(base, 190));
    return Math.round(capped * (0.45 + state.intensity * 0.55));
  }

  /* ------------------------------------------------------------ node graph */

  function rectToNode(el, weight) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    // Ignore nodes scrolled well outside the viewport.
    if (r.bottom < -200 || r.top > H + 200) return null;
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      rx: r.width / 2,
      ry: r.height / 2,
      r: Math.max(18, Math.min(r.width, r.height) / 2),
      weight: weight || 1,
      pooled: 0,
      el: el,
    };
  }

  function refreshNodes() {
    if (!canvas) return;
    var found = [];

    // Constituents holding healthy leadership are the primary sinks.
    var cells = document.querySelectorAll('.cell[data-positive="true"]');
    for (var i = 0; i < cells.length; i++) {
      var n = rectToNode(cells[i], 1.3);
      if (n) found.push(n);
    }

    // The MAG7 arc of the attribution ring is always a sink while it carries
    // share. It is an SVG element, so read its painted extent, not offsetWidth.
    var arc = document.querySelector('[data-node="mag7"]');
    if (arc) {
      var dash = String(arc.getAttribute('stroke-dasharray') || '0').split(/[ ,]+/)[0];
      if (parseFloat(dash) > 2) {
        var s = rectToNode(arc, 1);
        if (s) found.push(s);
      }
    }

    var heroEl = document.querySelector('[data-node="core"]');
    core = heroEl ? rectToNode(heroEl, 1) : null;

    // With no healthy leadership anywhere, capital pools at the core instead —
    // visually, the index has nowhere to route.
    if (!found.length && core) found.push(core);

    nodes = found;
  }

  /* ------------------------------------------------------------- particles */

  function spawn(p) {
    // Capital enters from the outer edge, biased to the bottom — "the market".
    var edge = Math.random();
    if (edge < 0.55) {
      p.x = Math.random() * W;
      p.y = H + 20 + Math.random() * 60;
    } else if (edge < 0.78) {
      p.x = -20 - Math.random() * 60;
      p.y = Math.random() * H;
    } else {
      p.x = W + 20 + Math.random() * 60;
      p.y = Math.random() * H;
    }
    p.px = p.x;
    p.py = p.y;
    p.vx = 0;
    p.vy = 0;
    p.phase = 'route';
    p.age = 0;
    p.poolAge = 0;
    p.life = 9000 + Math.random() * 9000;
    p.size = 1.4 + Math.random() * 2.6;
    p.speed = 0.055 + Math.random() * 0.055;
    p.wander = Math.random() * Math.PI * 2;
    p.target = null;
    // A slice of flow is residual capital: cooler, never pools at MAG7 nodes.
    p.residual = Math.random() > 0.28 + state.intensity * 0.62;
    return p;
  }

  function seed() {
    var want = targetCount();
    while (particles.length < want) particles.push(spawn({}));
    if (particles.length > want) particles.length = want;
  }

  function pickTarget(p) {
    if (!nodes.length) return null;
    // Weighted-nearest: closer and heavier nodes win, with jitter so the
    // routing never collapses into identical lanes.
    var best = null;
    var bestScore = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var dx = n.x - p.x;
      var dy = n.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var score = (d / n.weight) * (0.82 + Math.random() * 0.36);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  function step(p, dt, t) {
    p.age += dt;
    p.px = p.x;
    p.py = p.y;

    if (p.residual) {
      // Residual capital drifts across the substrate without pooling.
      p.wander += dt * 0.0007;
      p.vx += Math.cos(p.wander) * 0.0016 * dt;
      p.vy += (Math.sin(p.wander * 0.7) * 0.0012 - 0.0022) * dt;
    } else {
      if (!p.target || !nodes.length) p.target = pickTarget(p);
      var n = p.target;
      if (n) {
        var dx = n.x - p.x;
        var dy = n.y - p.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;

        if (p.phase === 'route') {
          // Seek, with a curl field so paths bow like routed capital rather
          // than firing along straight lines.
          var curl = Math.sin((p.y + t * 0.02) * 0.006) * 0.02;
          p.vx += ((dx / d) * p.speed + curl) * dt * 0.06;
          p.vy += ((dy / d) * p.speed - curl * 0.5) * dt * 0.06;
          if (d < n.r * 1.15) {
            p.phase = 'pool';
            p.ang = Math.atan2(p.y - n.y, p.x - n.x);
            p.rad = d;
            p.angVel = (Math.random() > 0.5 ? 1 : -1) * (0.0008 + Math.random() * 0.0014);
            p.poolAge = 0;
          }
        } else {
          // Pooled: orbit the node, breathing in and out, then release.
          p.poolAge += dt;
          n.pooled += 1;
          p.ang += p.angVel * dt;
          var breath = 1 + Math.sin(t * 0.0012 + p.rad) * 0.14;
          p.rad += (n.r * 0.62 * breath - p.rad) * 0.006 * dt * 0.1;
          p.x = n.x + Math.cos(p.ang) * p.rad;
          p.y = n.y + Math.sin(p.ang) * p.rad;
          p.vx = p.vy = 0;
          if (p.poolAge > 3200 + Math.random() * 2600) {
            p.phase = 'route';
            p.target = null;
            p.vx = Math.cos(p.ang) * 0.35;
            p.vy = Math.sin(p.ang) * 0.35;
          }
          return;
        }
      }
    }

    var damp = Math.pow(0.985, dt * 0.06);
    p.vx *= damp;
    p.vy *= damp;
    var max = 0.9;
    var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (sp > max) {
      p.vx = (p.vx / sp) * max;
      p.vy = (p.vy / sp) * max;
    }
    p.x += p.vx * dt * 0.12;
    p.y += p.vy * dt * 0.12;

    var out = p.x < -140 || p.x > W + 140 || p.y < -160 || p.y > H + 160;
    if (out || p.age > p.life) spawn(p);
  }

  /* --------------------------------------------------------------- drawing */

  function drawParticle(p) {
    var sprite = p.residual ? spriteResidual : spriteAccent;
    var alpha = p.residual ? 0.16 : p.phase === 'pool' ? 0.5 : 0.34;
    var size = p.size * (p.residual ? 4 : 7);

    // Streak from the previous position — motion blur without an accum buffer.
    if (!p.residual && p.phase === 'route') {
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = 'rgba(' + state.accent.join(',') + ',0.5)';
      ctx.lineWidth = p.size * 0.5;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
  }

  function drawNodeHalo(n, t) {
    var breath = 0.55 + Math.sin(t * 0.0011 + n.x * 0.01) * 0.45;
    var load = Math.min(n.pooled / 14, 1);
    var radius = n.r * (1.6 + load * 0.9);
    ctx.globalAlpha = 0.05 + load * 0.13 + breath * 0.04;
    ctx.drawImage(spriteAccent, n.x - radius, n.y - radius, radius * 2, radius * 2);
    n.pooled = 0;
  }

  function drawRings(dt) {
    for (var i = rings.length - 1; i >= 0; i--) {
      var r = rings[i];
      r.age += dt;
      var k = r.age / r.life;
      if (k >= 1) {
        rings.splice(i, 1);
        continue;
      }
      var eased = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = (1 - k) * 0.22 * (0.4 + state.intensity * 0.6);
      ctx.strokeStyle = 'rgba(' + state.accent.join(',') + ',1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.rx + eased * r.reach, r.ry + eased * r.reach * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  var lastPulse = -Infinity;

  /** Emit one scoring sweep from the hero core. */
  function emitRing() {
    if (!canvas || rings.length > 3) return;
    var origin = core || { x: W / 2, y: H * 0.3, rx: 60, ry: 30 };
    rings.push({
      x: origin.x,
      y: origin.y,
      rx: origin.rx || 60,
      ry: origin.ry || 30,
      reach: Math.max(W, H) * 0.55,
      age: 0,
      life: 2600,
    });
  }

  function maybePulse(t) {
    // The scoring engine breathing: one sweep per cycle, faster when the
    // index is more concentrated.
    var period = 5200 - state.intensity * 1800;
    if (t - lastPulse < period) return;
    lastPulse = t;
    emitRing();
  }

  /* ------------------------------------------------------------- main loop */

  function frame(t) {
    if (!running) return;
    var dt = Math.min(t - lastT, 48);
    lastT = t;

    // Nodes move with scroll, tab switches and data updates.
    if (t - nodeRefreshT > 400) {
      nodeRefreshT = t;
      refreshNodes();
    }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (var i = 0; i < nodes.length; i++) drawNodeHalo(nodes[i], t);

    for (var j = 0; j < particles.length; j++) {
      step(particles[j], dt, t);
      drawParticle(particles[j]);
    }

    maybePulse(t);
    drawRings(dt);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Pointer easing — spotlight and parallax share the same smoothed value.
    pointer.x += (pointer.tx - pointer.x) * 0.12;
    pointer.y += (pointer.ty - pointer.y) * 0.12;
    publishPointer();

    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------- pointer / depth */

  var root = document.documentElement;
  var depthEls = [];

  function collectDepth() {
    depthEls = Array.prototype.slice.call(document.querySelectorAll('[data-depth]'));
  }

  function publishPointer() {
    if (coarse) return;
    root.style.setProperty('--mx', pointer.x.toFixed(4));
    root.style.setProperty('--my', pointer.y.toFixed(4));
    root.style.setProperty('--mx-px', (pointer.x * global.innerWidth).toFixed(1) + 'px');
    root.style.setProperty('--my-px', (pointer.y * global.innerHeight).toFixed(1) + 'px');

    var ox = (pointer.x - 0.5) * 2;
    var oy = (pointer.y - 0.5) * 2;
    for (var i = 0; i < depthEls.length; i++) {
      var el = depthEls[i];
      var d = parseFloat(el.dataset.depth) || 0;
      el.style.transform =
        'translate3d(' + (-ox * d * 5).toFixed(2) + 'px,' + (-oy * d * 4).toFixed(2) + 'px,0)' +
        ' rotateX(' + (oy * d * 0.32).toFixed(3) + 'deg)' +
        ' rotateY(' + (-ox * d * 0.42).toFixed(3) + 'deg)';
    }
  }

  var hoveredGlass = null;

  function onPointerMove(e) {
    pointer.tx = e.clientX / global.innerWidth;
    pointer.ty = e.clientY / global.innerHeight;

    // Per-panel specular position, only for the panel under the cursor.
    if (hoveredGlass) {
      var r = hoveredGlass.getBoundingClientRect();
      hoveredGlass.style.setProperty('--lx', (e.clientX - r.left).toFixed(0) + 'px');
      hoveredGlass.style.setProperty('--ly', (e.clientY - r.top).toFixed(0) + 'px');
    }
  }

  function onPointerOver(e) {
    var g = e.target && e.target.closest ? e.target.closest('.glass') : null;
    if (g !== hoveredGlass) hoveredGlass = g;
  }

  /* ------------------------------------------------------------------ API */

  function setIntensity(v) {
    state.intensity = Math.max(0, Math.min(1, v));
    root.style.setProperty('--intensity', state.intensity.toFixed(3));
    seed();
  }

  var api = {
    /**
     * @param {object} s  { impactShare, direction, transmission }
     * Impact share drives flow volume; a MAG7 that is offsetting the index
     * still routes capital, so intensity is share-based, not sign-based.
     */
    setState: function (s) {
      if (!s) return;
      if (typeof s.impactShare === 'number' && isFinite(s.impactShare)) {
        setIntensity(s.impactShare / 100);
      } else if (s.impactShare === null) {
        setIntensity(0.15);
      }
      if (s.direction) state.direction = s.direction;
      if (s.transmission) state.transmission = s.transmission;
      collectDepth();
      refreshNodes();
    },
    refreshNodes: refreshNodes,
    /** Emit a scoring sweep immediately — called when new data lands. */
    pulse: function () {
      lastPulse = typeof performance !== 'undefined' ? performance.now() : 0;
      emitRing();
    },
    enabled: !reduceMotion,
  };

  /* ------------------------------------------------------------------ init */

  function init() {
    collectDepth();

    if (!coarse) {
      global.addEventListener('pointermove', onPointerMove, { passive: true });
      global.addEventListener('pointerover', onPointerOver, { passive: true });
    }

    canvas = document.getElementById('fx-canvas');
    if (!canvas || reduceMotion) {
      // Static presentation still gets depth tokens at their resting values.
      return;
    }
    ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    syncBrandTokens();

    spriteAccent = makeSprite(state.accent, 64);
    spriteResidual = makeSprite(state.residual, 64);

    resize();
    global.addEventListener('resize', resize, { passive: true });
    global.addEventListener('scroll', function () {
      nodeRefreshT = 0;
    }, { passive: true });

    // Never burn frames on a hidden tab.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        lastT = performance.now();
        requestAnimationFrame(frame);
      }
    });

    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.SEEngine = api;
})(window);
