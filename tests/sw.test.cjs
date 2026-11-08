'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const scope = 'https://mattyuhz.github.io/Frame/previews/scenes/';
const prefix = 'frame:' + scope + ':';
const version = script.match(/var CACHE = CACHE_PREFIX \+ '([^']+)'/);
assert.ok(version, 'the worker must version its scope-specific cache');
const current = prefix + version[1];

function boot(options = {}) {
  const listeners = new Map(), opened = [], deleted = [], matches = [], puts = [], added = [], fetched = [];
  let claimed = 0, skipped = 0;
  const response = { ok: true, clone() { return { copy: true }; } };
  const cache = {
    addAll: async entries => { added.push([...entries]); },
    match: async (request, config) => { matches.push({ request, config }); return options.hit; },
    put: async (request, value) => { puts.push({ request, value }); }
  };
  vm.runInNewContext(script, {
    URL,
    location: { origin: 'https://mattyuhz.github.io' },
    self: {
      registration: { scope },
      addEventListener: (name, handler) => listeners.set(name, handler),
      skipWaiting: async () => { skipped++; },
      clients: { claim: async () => { claimed++; } }
    },
    caches: {
      open: async name => { opened.push(name); return cache; },
      keys: async () => options.keys || [],
      delete: async name => { deleted.push(name); return true; },
      match: () => { throw new Error('global cache lookup can leak another deployment'); }
    },
    fetch: request => {
      fetched.push(request);
      return options.fetch ? options.fetch(request) : Promise.resolve(response);
    }
  }, { filename: 'sw.js' });
  function lifecycle(name) {
    let pending;
    listeners.get(name)({ waitUntil: promise => { pending = promise; } });
    assert.ok(pending, name + ' must keep the worker alive');
    return pending;
  }
  function request(url = scope + 'index.html', method = 'GET', range = false) {
    const req = { url, method, headers: { has: name => range && name.toLowerCase() === 'range' } };
    let pending;
    listeners.get('fetch')({ request: req, respondWith: promise => { pending = promise; } });
    return { req, pending };
  }
  return { lifecycle, request, opened, deleted, matches, puts, added, fetched, response,
    get claimed() { return claimed; }, get skipped() { return skipped; } };
}

test('preview installation caches only its relative shell under its scoped cache name', async () => {
  const f = boot();await f.lifecycle('install');
  assert.deepEqual(f.opened, [current]);
  assert.deepEqual(f.added, [['./', './index.html', './compose.html']]);
  assert.equal(f.skipped, 1);
});

test('preview activation preserves production and unrelated caches and removes only older same-scope caches', async () => {
  const old = prefix + 'v15', production = 'frame:https://mattyuhz.github.io/Frame/:v16-scenes';
  const f = boot({ keys: ['frame-v15', production, 'other-app-cache', current, old,
    'frame:https://mattyuhz.github.io/Frame/previews/another/:v15'] });
  await f.lifecycle('activate');
  assert.deepEqual(f.deleted, [old]);
  assert.equal(f.claimed, 1);
});

test('worker leaves outside-scope, cross-origin, non-GET and Range requests to the browser', () => {
  const f = boot();
  for (const args of [
    ['https://mattyuhz.github.io/Frame/index.html'],
    ['https://mattyuhz.github.io/Frame/previews/scenes-other/index.html'],
    ['https://example.com/Frame/previews/scenes/index.html'],
    [scope + 'index.html', 'POST'],
    [scope + 'tests/fixtures/scenes/01-hard-cuts.mp4', 'GET', true]
  ]) assert.equal(f.request(...args).pending, undefined, JSON.stringify(args));
  assert.deepEqual(f.opened, []);assert.deepEqual(f.fetched, []);
});

test('non-document cache hit comes only from the named preview cache and does not wait for refresh', async () => {
  const hit = { cached: 'preview' }, f = boot({ hit, fetch: () => new Promise(() => {}) });
  const { req, pending } = f.request(scope + 'poster.png?test=1');
  assert.equal(await pending, hit);
  assert.deepEqual(f.opened, [current]);
  assert.equal(f.matches[0].request, req);
  assert.equal(f.matches[0].config.ignoreSearch, true);
  assert.deepEqual(f.fetched, [req]);
});

test('uncached same-scope response is fetched and saved only to the preview cache', async () => {
  const f = boot(), { req, pending } = f.request();
  assert.equal(await pending, f.response);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.deepEqual(f.opened, [current, current]);
  assert.equal(f.puts.length, 1);assert.equal(f.puts[0].request, req);
  assert.deepEqual(f.puts[0].value, { copy: true });
});

 test('HTML uses the current online response even when an older workspace is cached', async () => {
 const f=boot({hit:{cached:'old'}});assert.equal(await f.request(scope+'compose.html?workspace-embed=1').pending,f.response);
 });
 test('HTML falls back to the scoped shell when offline', async () => {
 const hit={cached:'offline'},f=boot({hit,fetch:()=>Promise.reject(new Error('offline'))});assert.equal(await f.request().pending,hit);
 });
