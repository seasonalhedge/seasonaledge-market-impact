#!/usr/bin/env node
'use strict';

/**
 * SeasonalEDGE Market Impact — webhook receiver + dashboard API + static host.
 *
 *   TradingView alert -> POST /webhook/mags-lre
 *                     -> normalize + store
 *                     -> GET /api/mags-lre/latest  (dashboard state)
 *                        GET /api/mags-lre/events  (history)
 *                        GET /api/mags-lre/stream  (SSE live push)
 *                     -> public/ dashboard
 *
 * Zero runtime dependencies: node:http + node:sqlite (JSON fallback).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parsePayload, applyToState, buildDashboard } = require('./lib/normalize');
const { createStore } = require('./lib/store');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const MAX_BODY_BYTES = 256 * 1024;

if (!WEBHOOK_TOKEN) {
  console.warn(
    '[warn] WEBHOOK_TOKEN is not set. The webhook endpoint will reject every request.\n' +
      '       Start with:  WEBHOOK_TOKEN=your-secret npm start'
  );
}

const store = createStore(DATA_DIR, { forceJson: process.env.STORE === 'json' });
console.log(`[store] backend=${store.kind} dir=${DATA_DIR} node=${process.version}`);

if (store.kind === 'json' && process.env.STORE !== 'json') {
  console.warn(
    '[warn] node:sqlite unavailable — using the JSON store. This works, but needs\n' +
      '       Node 22.5+ for SQLite. Check the deployed Node version if unexpected.'
  );
}

/* ------------------------------------------------------------------ helpers */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/** Timing-safe token comparison that does not leak length. */
function tokenMatches(provided) {
  if (!WEBHOOK_TOKEN || !provided) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(WEBHOOK_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function extractToken(req, url, body) {
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return (
    req.headers['x-webhook-token'] ||
    bearer ||
    url.searchParams.get('token') ||
    (body && typeof body === 'object' ? body.token || body.secret : null) ||
    null
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------ rate limit */

/**
 * Failure-only throttle for the public webhook. Successful alerts are never
 * limited (TradingView can legitimately burst), but repeated rejections from
 * one address back off hard — that is the only pattern a token-guesser makes.
 */
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 20;
const failures = new Map();

function clientIp(req) {
  // Railway terminates TLS and forwards the original address.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isBlocked(ip) {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return rec.count >= FAIL_LIMIT;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.first > FAIL_WINDOW_MS) {
    failures.set(ip, { first: now, count: 1 });
  } else {
    rec.count += 1;
  }
  // Bound the map so a spray of spoofed addresses can't grow it without limit.
  if (failures.size > 5000) {
    for (const [k, v] of failures) {
      if (now - v.first > FAIL_WINDOW_MS) failures.delete(k);
      if (failures.size <= 2500) break;
    }
  }
}

function noteSuccess(ip) {
  failures.delete(ip);
}

/* --------------------------------------------------------------------- SSE */

const sseClients = new Set();

function broadcast(payload) {
  const frame = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

function currentDashboard(limit = 25) {
  return buildDashboard(store.readState(), store.readEvents(limit));
}

/* ------------------------------------------------------------------ routes */

async function handleWebhook(req, res, url) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed' });
  }

  const ip = clientIp(req);
  if (isBlocked(ip)) {
    res.setHeader('Retry-After', '600');
    return sendJson(res, 429, { ok: false, error: 'too many failed attempts' });
  }

  let text;
  try {
    text = await readBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Authenticate before saying anything else about the request.
    if (!tokenMatches(extractToken(req, url, null))) {
      noteFailure(ip);
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    return sendJson(res, 400, { ok: false, error: 'invalid JSON' });
  }

  if (!tokenMatches(extractToken(req, url, body))) {
    noteFailure(ip);
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }
  noteSuccess(ip);

  const receivedAt = new Date().toISOString();
  const result = parsePayload(body, receivedAt);
  if (!result.ok) {
    return sendJson(res, 422, { ok: false, errors: result.errors });
  }

  const parsed = result.parsed;
  // Never persist the shared secret alongside the payload.
  if (parsed.raw && typeof parsed.raw === 'object') {
    delete parsed.raw.token;
    delete parsed.raw.secret;
  }

  const state = applyToState(store.readState(), parsed);
  store.writeState(state);
  store.appendEvent(parsed.event, receivedAt, parsed.raw);

  const dashboard = currentDashboard();
  broadcast(dashboard);

  sendJson(res, 202, {
    ok: true,
    accepted: parsed.event.event,
    is_snapshot: parsed.is_snapshot,
    constituents_known: dashboard.constituents.length,
  });
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.write(`event: update\ndata: ${JSON.stringify(currentDashboard())}\n\n`);
  sseClients.add(res);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* handled on close */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));

  // Path-traversal guard.
  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }
  fs.readFile(target, (err, data) => {
    if (err) return sendJson(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/webhook/mags-lre') return await handleWebhook(req, res, url);

    if (url.pathname === '/api/mags-lre/latest') {
      return sendJson(res, 200, currentDashboard());
    }

    if (url.pathname === '/api/mags-lre/events') {
      const raw = Number(url.searchParams.get('limit'));
      const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 25;
      return sendJson(res, 200, { events: store.readEvents(limit) });
    }

    if (url.pathname === '/api/mags-lre/stream') return handleStream(req, res);

    if (url.pathname === '/api/mags-lre/health') {
      const state = store.readState();
      return sendJson(res, 200, {
        ok: true,
        store: store.kind,
        node: process.version,
        data_dir: DATA_DIR,
        last_update: state.updated_at,
        constituents_known: Object.keys(state.constituents || {}).length,
        clients: sseClients.size,
        uptime_s: Math.round(process.uptime()),
      });
    }

    return serveStatic(req, res, url);
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SeasonalEDGE Market Impact listening on http://${HOST}:${PORT}`);
  console.log(`  dashboard : http://localhost:${PORT}/`);
  console.log(`  webhook   : POST http://localhost:${PORT}/webhook/mags-lre`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
