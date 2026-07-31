#!/usr/bin/env node
'use strict';

/**
 * Build a single-file static preview of the dashboard with the sample
 * snapshot baked in. Useful for design review and for sharing the look of
 * the page without running the backend.
 *
 *   node test/build-preview.js  ->  preview.html
 */

const fs = require('fs');
const path = require('path');
const N = require('../lib/normalize');
const { snapshot, events } = require('./payloads');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');

let state = N.applyToState(N.emptyState(), N.parsePayload(snapshot()).parsed);
const history = [];
for (const e of events()) {
  const parsed = N.parsePayload(e).parsed;
  state = N.applyToState(state, parsed);
  history.unshift(parsed.event);
}
history.push({
  time: state.as_of,
  event: 'DASHBOARD_SNAPSHOT',
  ticker: 'MAG7',
  state: 'CONCENTRATED',
  score: 93.3,
  transmission: 'CONCENTRATED',
  index_risk: 52.5,
});

const dashboard = N.buildDashboard(state, history);

const html = fs
  .readFileSync(path.join(pub, 'index.html'), 'utf8')
  .replace(
    '<link rel="stylesheet" href="styles.css">',
    '<style>\n' + fs.readFileSync(path.join(pub, 'styles.css'), 'utf8') + '\n</style>'
  )
  .replace(
    '<script src="engine.js"></script>',
    '<script>\n' + fs.readFileSync(path.join(pub, 'engine.js'), 'utf8') + '\n</script>'
  )
  .replace(
    '<script src="app.js"></script>',
    '<script>window.__PREVIEW__ = ' +
      JSON.stringify(dashboard).replace(/</g, '\\u003c') +
      ';</script>\n<script>\n' +
      fs.readFileSync(path.join(pub, 'app.js'), 'utf8') +
      '\n</script>'
  );

const out = path.join(root, 'preview.html');
fs.writeFileSync(out, html);
console.log('wrote ' + out);
