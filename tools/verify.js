#!/usr/bin/env node
/* Frame — the verification ritual, as one runnable file.

   Run from anywhere:  node tools/verify.js
   CI runs this exact file on every pull request (.github/workflows/verify.yml),
   so a green check means the checks ran against the bytes about to be merged —
   not that someone said they ran.

   No dependencies, by design: same discipline as the pages themselves.
   Exits 0 only if every check passes. */

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PAGES = ['index.html', 'compose.html'];
var WORKER = 'sw.js';

var failures = 0;
function ok(m) { console.log('  ok    ' + m); }
function bad(m) { console.log('  FAIL  ' + m); failures++; }
function section(t) { console.log('\n' + t); }
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* Which files are on the deployed origin. Pages publishes the repo root, so
   this is "everything tracked", not just the two apps. */
function trackedCode() {
  try {
    return cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(function (f) { return /\.(html|js)$/.test(f); });
  } catch (e) {
    console.log('  note: git unavailable — checking the known files only');
    return PAGES.concat([WORKER]);
  }
}

function linesMatching(src, re) {
  var out = [];
  src.split('\n').forEach(function (line, i) {
    if (re.test(line)) out.push('line ' + (i + 1) + ': ' + line.trim().slice(0, 100));
  });
  return out;
}

function checkSyntax(label, code) {
  var tmp = path.join(os.tmpdir(), 'frame-verify-' + label.replace(/[^\w.]/g, '_') + '.js');
  fs.writeFileSync(tmp, code);
  try {
    cp.execSync('node --check ' + JSON.stringify(tmp), { stdio: 'pipe' });
    return null;
  } catch (e) {
    return String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' / ');
  } finally {
    try { fs.unlinkSync(tmp); } catch (e2) { /* best effort */ }
  }
}

/* 1. Deploy surface — nothing served from the site may point off it.
      Covers tools/ too: a "dev-only" page with a CDN <script src> is a live
      page on mattyuhz.github.io. (This file's own regex escapes its slashes,
      so it does not match itself.) */
section('Deploy surface — no external origins in any tracked .html/.js');
var EXTERNAL = /https?:\/\//g;
trackedCode().forEach(function (f) {
  var hits = read(f).match(EXTERNAL);
  if (hits) bad(f + ': ' + hits.length + ' external origin reference(s)');
  else ok(f);
});

/* 2. Shipped code — no network or dynamic-code capability.
      Scoped to the two pages plus sw.js, so a harness in tools/ may still use
      eval to test shipped functions (see "Testing ritual" in CLAUDE.md). */
section('Shipped code — no network or dynamic-code capability');
var NETWORK = /XMLHttpRequest|WebSocket|EventSource|sendBeacon|new Worker|\bimport\s*\(|@import/;
var DYNAMIC = /\beval\s*\(|new Function|innerHTML|document\.write/;
var FETCH = /\bfetch\s*\(/;

PAGES.concat([WORKER]).forEach(function (f) {
  var src = read(f);
  var net = linesMatching(src, NETWORK);
  var dyn = linesMatching(src, DYNAMIC);
  if (net.length) bad(f + ': network API — ' + net.join('; '));
  if (dyn.length) bad(f + ': dynamic code — ' + dyn.join('; '));
  if (!net.length && !dyn.length) ok(f + ': clean');

  /* sw.js is the one shipped file allowed to fetch, and only behind its guard. */
  var fetches = linesMatching(src, FETCH);
  if (f === WORKER) {
    if (src.indexOf('url.origin !== location.origin') === -1) {
      bad(f + ': the same-origin guard is missing');
    } else ok(f + ': same-origin guard present');
  } else if (fetches.length) {
    bad(f + ': fetch( is only allowed in ' + WORKER + ' — ' + fetches.join('; '));
  }
});

/* 3. The CSP must still be there, exactly once per page. */
section('Content-Security-Policy');
PAGES.forEach(function (f) {
  var n = read(f).split("connect-src 'none'").length - 1;
  if (n === 1) ok(f + ": connect-src 'none'");
  else bad(f + ": expected connect-src 'none' exactly once, found " + n);
});

/* 4. One IIFE per page is an invariant, not a convention — a second block
      would otherwise ship unchecked. */
section('Structure and syntax');
PAGES.forEach(function (f) {
  var blocks = read(f).match(/<script>[\s\S]*?<\/script>/g) || [];
  if (blocks.length !== 1) {
    bad(f + ': expected exactly 1 <script> block, found ' + blocks.length);
    return;
  }
  var body = blocks[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  var err = checkSyntax(f, body);
  if (err) bad(f + ': syntax — ' + err);
  else ok(f + ': one script block, parses');
});
var swErr = checkSyntax(WORKER, read(WORKER));
if (swErr) bad(WORKER + ': syntax — ' + swErr);
else ok(WORKER + ': parses');

/* 5. Every $('id') lookup must find its element. */
section('Markup — $() lookups resolve');
PAGES.forEach(function (f) {
  var src = read(f);
  var used = {}, ids = {}, m;
  var useRe = /\$\('([^']+)'\)/g;
  while ((m = useRe.exec(src))) used[m[1]] = true;
  var idRe = /id="([^"]+)"/g;
  while ((m = idRe.exec(src))) ids[m[1]] = true;
  var missing = Object.keys(used).filter(function (id) { return !ids[id]; });
  if (missing.length) bad(f + ': no element for ' + missing.join(', '));
  else ok(f + ': all ' + Object.keys(used).length + ' lookups resolve');
});

console.log('');
if (failures) {
  console.log(failures + ' check(s) FAILED.');
  process.exit(1);
}
console.log('All checks passed.');
