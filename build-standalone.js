#!/usr/bin/env node
'use strict';

/**
 * Build the portable single-file dashboard.
 *
 *   public/index.html + styles.css + engine.js + app.js
 *     -> seasonaledge-market-impact.html
 *
 * Everything is inlined, so the result opens from anywhere — file://, an
 * embed, another host — with no asset requests of its own. The API is the one
 * thing it still reaches for, and the origin switch below handles that:
 * served from seasonaledge.ai it uses relative paths, anywhere else it
 * addresses the live deployment.
 *
 * Usage:  node build-standalone.js [outfile]
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const OUT = process.argv[2] || path.join(__dirname, '..', 'seasonaledge-market-impact.html');

const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

let html = read('index.html');
const css = read('styles.css');
const engine = read('engine.js');
let app = read('app.js');

/* ------------------------------------------------------- origin switch --- */

const ORIGIN_SHIM = `  // --- standalone build -----------------------------------------------------
  // Served from the dashboard's own origin we use relative paths, so staging
  // and preview domains keep working. Opened anywhere else — file://, an
  // embed, a local preview — the API is addressed absolutely against the live
  // deployment. The read-only API sends CORS headers for exactly this.
  var ORIGIN = (location.protocol === 'http:' || location.protocol === 'https:')
    && /(^|\\.)seasonaledge\\.ai$/.test(location.hostname)
      ? ''
      : 'https://impact.seasonaledge.ai';

  var CONFIG = {`;

if (!app.includes('var CONFIG = {')) {
  throw new Error('app.js: CONFIG block not found — build aborted.');
}
app = app.replace('  var CONFIG = {', ORIGIN_SHIM);

// Prefix every API path with the resolved origin.
const before = app;
app = app.replace(/(\s*)(latestUrl|eventsUrl|streamUrl):\s*'(\/api\/[^']*)'/g,
  (_m, ws, key, p) => `${ws}${key}: ORIGIN + '${p}'`);
if (app === before) {
  throw new Error('app.js: no API paths rewritten — build aborted.');
}

/* --------------------------------------------------------------- inline --- */

const inline = (src, tag, open, close) => {
  if (!src.includes(tag)) throw new Error(`index.html: "${tag}" not found — build aborted.`);
  return src.replace(tag, `${open}\n${close}`);
};

html = inline(html, '<link rel="stylesheet" href="styles.css">', '<style>', css.trimEnd() + '\n</style>');
html = inline(html, '<script src="engine.js"></script>', '<script>', engine.trimEnd() + '\n</script>');
html = inline(html, '<script src="app.js"></script>', '<script>', app.trimEnd() + '\n</script>');

/* ---------------------------------------------------------------- verify --- */

const problems = [];
if (/<script[^>]+\ssrc=/.test(html)) problems.push('a <script src> survived inlining');
if (/<link[^>]+stylesheet[^>]*href="(?!https:\/\/fonts)/.test(html)) {
  problems.push('a local stylesheet link survived inlining');
}
if (!html.includes('impact.seasonaledge.ai')) problems.push('origin switch missing');
if (!html.includes('id="turn"')) problems.push('The Turn symbols missing');
if (problems.length) throw new Error('build verification failed:\n  - ' + problems.join('\n  - '));

fs.writeFileSync(OUT, html);

console.log(`built ${path.resolve(OUT)}`);
console.log(`  ${(html.length / 1024).toFixed(1)} kB`);
console.log(`  external requests: google fonts only`);
