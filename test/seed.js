#!/usr/bin/env node
'use strict';

/**
 * Push the sample snapshot + events into a running server.
 *   WEBHOOK_TOKEN=secret npm start
 *   WEBHOOK_TOKEN=secret npm run seed
 */

const { snapshot, events } = require('./payloads');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const TOKEN = process.env.WEBHOOK_TOKEN || '';

async function post(payload) {
  const res = await fetch(`${BASE}/webhook/mags-lre`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': TOKEN },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${res.status}  ${payload.event}`, body.ok ? '' : JSON.stringify(body));
}

(async () => {
  if (!TOKEN) {
    console.error('Set WEBHOOK_TOKEN to the same value the server was started with.');
    process.exit(1);
  }
  await post(snapshot());
  for (const e of events()) await post(e);
  console.log(`\nOpen ${BASE}/`);
})();
