'use strict';

// Run with `node --test tests/crop.test.cjs`. The page stays dependency-free:
// this harness evaluates the shipped script and instruments its IIFE in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shippedScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function boot(options = {}) {
  const ids = new Map();
  const captured = new Map();
  const canvases = [];
  const timers = new Map();
  let nextTimer = 1;

  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.listeners = new Map();
      this.className = '';
      this._text = '';
      this.disabled = false;
      this.value = '';
      this.paused = true;
      this.readyState = 4;
      this.videoWidth = 0;
      this.videoHeight = 0;
      this.currentTime = 0;
      this.duration = 10;
      this.seeking = false;
      this.dataset = {};
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const on = force === undefined ? !this.classList.contains(name) : force;
          this.classList[on ? 'add' : 'remove'](name);
          return on;
        }
      };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') { this.id = String(value); ids.set(this.id, this); }
      if (name === 'class') this.className = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    matches(selector) {
      if (selector[0] === '#') return this.id === selector.slice(1);
      if (selector[0] === '.') return selector.slice(1).split('.').every(name => this.classList.contains(name));
      const attr = selector.match(/^\[([^=\]]+)(?:="?([^"\]]+)"?)?\]$/);
      if (attr) return this.hasAttribute(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
      return this.tagName === selector.toUpperCase();
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
    }
    setPointerCapture(id) { captured.set(id, this); }
    hasPointerCapture(id) { return captured.get(id) === this; }
    releasePointerCapture(id) {
      if (this.hasPointerCapture(id)) {
        captured.delete(id);
        dispatch(this, 'lostpointercapture', { pointerId: id });
      }
    }
    click() { dispatch(this, 'click'); }
    focus() {}
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    load() {}
    get offsetWidth() {
      if (this.id === 'viewport') return 600;
      if (this.id === 'vframe') return ids.get('video').offsetWidth;
      if (this.style.width) return parseFloat(this.style.width) * (this.style.width.endsWith('%') ? this.parentNode.offsetWidth / 100 : 1);
      if (this.id === 'video') return 600;
      return this.parentNode?.offsetWidth || 600;
    }
    get offsetHeight() {
      if (this.id === 'vframe') return ids.get('video').offsetHeight;
      if (this.style.height) return parseFloat(this.style.height) * (this.style.height.endsWith('%') ? this.parentNode.offsetHeight / 100 : 1);
      if (this.id === 'video') return this.videoWidth ? this.offsetWidth * this.videoHeight / this.videoWidth : 337.5;
      return this.parentNode?.offsetHeight || 337.5;
    }
    get clientWidth() { return this.offsetWidth; }
    get clientHeight() { return this.offsetHeight; }
    getBoundingClientRect() {
      const parent = this.parentNode?.getBoundingClientRect();
      const left = this.id === 'viewport' ? 100 : (parent?.left || 100) + (parseFloat(this.style.left) || 0);
      const top = this.id === 'viewport' ? 80 : (parent?.top || 80) + (parseFloat(this.style.top) || 0);
      return { left, top, x: left, y: top, width: this.offsetWidth, height: this.offsetHeight, right: left + this.offsetWidth, bottom: top + this.offsetHeight };
    }
    getContext() {
      if (!this.context) {
        const calls = [];
        this.context = { calls };
        ['save', 'restore', 'translate', 'rotate', 'scale', 'drawImage', 'clearRect', 'fillRect'].forEach(name => {
          this.context[name] = (...args) => calls.push({ name, args });
        });
      }
      return this.context;
    }
    toBlob(callback, type) { callback({ type, width: this.width, height: this.height, canvas: this }); }
  }

  function dispatch(target, type, properties = {}) {
    const event = { type, target, button: 0, buttons: 1, pointerType: 'touch', ...properties,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; this.propagationStopped = true; }
    };
    for (let node = target; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(type) || [])]) {
        listener.call(node, event);
        if (event.immediateStopped) break;
      }
      if (event.propagationStopped) break;
    }
    return event;
  }

  const document = new Element('document');
  const stack = [document];
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  const voidTags = new Set(['META', 'LINK', 'INPUT', 'IMG', 'BR', 'HR', 'SOURCE', 'PATH']);
  for (const match of markup.matchAll(/<(\/)?([a-z][a-z\d-]*)\b([^>]*)>/gi)) {
    const tag = match[2].toUpperCase();
    if (match[1]) {
      while (stack.length > 1 && stack[stack.length - 1].tagName !== tag) stack.pop();
      if (stack[stack.length - 1].tagName === tag) stack.pop();
      continue;
    }
    const element = new Element(tag);
    for (const attr of match[3].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) element.setAttribute(attr[1], attr[2]);
    stack[stack.length - 1].appendChild(element);
    if (!voidTags.has(tag) && !match[3].endsWith('/')) stack.push(element);
  }
  document.body = document.querySelector('body');
  document.getElementById = id => ids.get(id) || null;
  document.createElement = tag => {
    const element = new Element(tag);
    if (tag === 'canvas') canvases.push(element);
    return element;
  };

  const window = new Element('window');
  document.parentNode = window;
  window.document = document;
  window.self = window.top = window;
  window.origin = 'http://localhost';
  window.isSecureContext = false;
  window.innerHeight = 1000;
  window.devicePixelRatio = 1;
  window.navigator = { userAgent: 'Crop regression harness', ...options.navigator };
  const schedule = callback => { const id = nextTimer++; timers.set(id, callback); return id; };
  const globals = { window, document, navigator: window.navigator, location: { protocol: 'http:' },
    console, Blob, File: require('node:buffer').File, TextDecoder, TextEncoder, URL, Date, Uint8Array, ArrayBuffer, DataView,
    setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: schedule,
    clearInterval: id => timers.delete(id), requestAnimationFrame: schedule,
    cancelAnimationFrame: id => timers.delete(id), performance: { now: () => 0 },
    ...options.globals
  };
  const exposure = `
    window.__cropTest = {
      state, cropRect, setCropToRect, setCropMode, layoutCrop, layoutViewer,
      setRotation, currentBlob, unrotate, cropPoint, panCrop, zoomCrop, resizeCrop,
      fitCropView, MIN_CROP_SCALE,
      get view(){ return vz; }, get cropMode(){ return cropMode; },
      get cropView(){ return cropView; }, get cropDrag(){ return cropDrag; },
      get cropPointers(){ return cPtr; }, get viewerPointers(){ return vPtr; },
      saveCurrent, saveAllMarks, runSeek, goToFrame,
      get sharePrepared(){ return typeof sharePrepared==='function' ? sharePrepared : undefined; },
      get clearSaveToast(){ return typeof clearSaveToast==='function' ? clearSaveToast : undefined; },
      get closeSheet(){ return typeof closeSheet==='function' ? closeSheet : undefined; },
      get saving(){ return typeof saving==='undefined' ? undefined : saving; },
      get preparedSave(){ return typeof preparedSave==='undefined' ? undefined : preparedSave; },
      stubExport(stubs){
        if(stubs.currentBlob) currentBlob=stubs.currentBlob;
        if(stubs.verifyImage) verifyImage=stubs.verifyImage;
        if(stubs.goToFrame) goToFrame=stubs.goToFrame;
        if(stubs.downloadBlob) downloadBlob=stubs.downloadBlob;
      }
    };
  `;
  const instrumented = shippedScript.replace(/\}\)\(\);\s*$/, exposure + (options.exposure || '') + '\n})();');
  assert.notEqual(instrumented, shippedScript, 'the shipped IIFE must be instrumented');
  vm.runInNewContext(instrumented, globals, { filename: 'index.html' });
  const api = window.__cropTest;
  const video = ids.get('video');
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  api.state.ready = true;
  api.state.metaCount = 0;
  api.layoutViewer();
  function pointer(type, id, x, y, target = ids.get('cropwrap'), pointerType = 'touch') {
    const recipient = type === 'pointerdown' ? target : captured.get(id) || target;
    const event = dispatch(recipient, type, { pointerId: id, clientX: x, clientY: y, pointerType });
    if (type === 'pointerup' || type === 'pointercancel') {
      const owner = captured.get(id);
      captured.delete(id);
      if (owner) dispatch(owner, 'lostpointercapture', { pointerId: id, clientX: x, clientY: y, pointerType });
    }
    return event;
  }
  return { api, ids, video, document, window, pointer, dispatch, captured, canvases, globals,
    navigator: window.navigator, timers };
}

function near(actual, expected, message, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}

function assertWithin(rect, width, height) {
  assert.ok(rect && Object.values(rect).every(Number.isFinite), 'crop coordinates remain finite');
  assert.ok(rect.w > 0 && rect.h > 0, 'crop has positive dimensions');
  assert.ok(rect.sx >= -1e-7 && rect.sy >= -1e-7, 'crop does not cross the leading edges');
  assert.ok(rect.sx + rect.w <= width + 1e-7 && rect.sy + rect.h <= height + 1e-7, 'crop does not cross the trailing edges');
}

if (require.main === module) {

test('shipped page starts and all literal ID references exist', () => {
  const { ids } = boot();
  for (const match of shippedScript.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(match[1]), `missing element: ${match[1]}`);
});

test('aspect presets remain inside landscape and portrait sources at every rotation', () => {
  const { api, video } = boot();
  for (const [width, height] of [[1920, 1080], [1080, 1920], [4032, 3024]]) {
    video.videoWidth = width;
    video.videoHeight = height;
    for (const rot of [0, 90, 180, 270]) {
      api.state.rot = rot;
      for (const ratio of [0, 1, 4 / 5, 5 / 4, 2 / 3, 3 / 2, 9 / 16, 16 / 9]) {
        for (const scale of [0.12, 0.5, 1]) {
          for (const center of [-0.2, 0, 0.5, 1, 1.2]) {
            Object.assign(api.state.crop, { ratio, scale, cx: center, cy: 1 - center });
            const rect = api.cropRect();
            assertWithin(rect, width, height);
            const expected = ratio ? (rot % 180 ? 1 / ratio : ratio) : width / height;
            near(rect.w / rect.h, expected, 'source crop ratio');
          }
        }
      }
    }
  }
});

test('exports use the selected source rectangle and bake every rotation into output pixels', async () => {
  const { api, video } = boot();
  const rect = { sx: 320, sy: 120, w: 960, h: 640 };
  for (const rot of [0, 90, 180, 270]) {
    api.state.rot = rot;
    api.setCropToRect(rect);
    const selected = api.cropRect();
    for (const key of Object.keys(rect)) near(selected[key], rect[key], key);
    const blob = await api.currentBlob();
    assert.equal(blob.width, rot % 180 ? rect.h : rect.w);
    assert.equal(blob.height, rot % 180 ? rect.w : rect.h);
    const draws = blob.canvas.context.calls.filter(call => call.name === 'drawImage');
    assert.equal(draws.length, 1);
    assert.equal(draws[0].args[0], video);
    assert.deepEqual(Array.from(draws[0].args.slice(1)), [rect.sx, rect.sy, rect.w, rect.h, -rect.w / 2, -rect.h / 2, rect.w, rect.h]);
    const rotation = blob.canvas.context.calls.find(call => call.name === 'rotate');
    if (rot) near(rotation.args[0], rot * Math.PI / 180, 'canvas rotation');
    else assert.equal(rotation, undefined);
  }
});

test('crop drag is not stolen by viewer pointer capture', () => {
  const { api, ids, pointer } = boot();
  api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
  api.setCropMode(true);
  const before = { ...api.cropRect() };
  const view = { ...api.view };
  const box = ids.get('cropbox').getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  pointer('pointerdown', 1, x, y, ids.get('cropbox'), 'mouse');
  pointer('pointermove', 1, x + 25, y + 10, ids.get('cropwrap'), 'mouse');
  pointer('pointerup', 1, x + 25, y + 10);
  assert.notEqual(api.cropRect().sx, before.sx, 'drag changes the selected source pixels');
  assert.deepEqual({ ...api.view }, view, 'crop gesture does not change normal viewer zoom');
  assert.equal(Object.keys(api.viewerPointers).length, 0, 'viewer does not track crop pointers');
  assert.equal(Object.keys(api.cropPointers).length, 0, 'crop pointer finishes cleanly');
});

test('ending crop during a pointer gesture leaves no stale pointer on reentry', () => {
  const { api, pointer } = boot();
  api.setCropMode(true);
  pointer('pointerdown', 1, 350, 220);
  api.setCropMode(false);
  api.setCropMode(true);
  assert.equal(Object.keys(api.cropPointers).length, 0);
  assert.equal(Object.keys(api.viewerPointers).length, 0);
  pointer('pointerdown', 2, 350, 220);
  pointer('pointercancel', 2, 350, 220);
  assert.equal(Object.keys(api.cropPointers).length, 0);
});

test('image panning responds immediately when reversing at every rotated source boundary', () => {
  for (const rot of [0, 90, 180, 270]) {
    const { api } = boot();
    api.state.rot = rot;
    api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
    api.setCropMode(true);
    api.panCrop(10000, 10000);
    const edge = { ...api.cropRect() };
    api.panCrop(-1, -1);
    const reversed = api.cropRect();
    assertWithin(reversed, 1920, 1080);
    near(Math.abs(reversed.sx - edge.sx), 1 / api.cropView.k, 'horizontal reverse responds without a dead zone');
    near(Math.abs(reversed.sy - edge.sy), 1 / api.cropView.k, 'vertical reverse responds without a dead zone');
  }
});

test('pinch keeps its source focal point, supports translation, and stops panning when one finger remains', () => {
  for (const rot of [0, 90, 180, 270]) {
    const { api, pointer } = boot();
    api.state.rot = rot;
    api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
    api.setCropMode(true);
    const b = api.cropView.box;
    const midpoint = { x: b.x + b.w / 2 + 12, y: b.y + b.h / 2 - 8 };
    const anchor = api.cropPoint(midpoint);
    const before = { ...api.cropRect() };
    const view = { ...api.view };
    const x = 100 + midpoint.x, y = 80 + midpoint.y;
    pointer('pointerdown', 1, x - 40, y);
    pointer('pointerdown', 2, x + 40, y);
    // 80 -> 120 px separation, with a simultaneous 10 px midpoint shift.
    pointer('pointermove', 1, x - 50, y + 5);
    pointer('pointermove', 2, x + 70, y + 5);
    const after = api.cropRect();
    near(after.w, before.w * 80 / 120, 'spreading fingers selects fewer source pixels');
    const focal = api.cropPoint({ x: midpoint.x + 10, y: midpoint.y + 5 });
    near(focal.x, anchor.x, 'pinch focal source x');
    near(focal.y, anchor.y, 'pinch focal source y');
    pointer('pointerup', 2, x + 70, y + 5);
    const prior = { ...api.cropRect() };
    pointer('pointermove', 1, x - 46, y + 5);
    const next = api.cropRect();
    near(next.w, prior.w, 'one-finger continuation keeps the crop scale');
    assert.deepEqual({ ...next }, prior, 'one remaining finger does not move the crop');
    pointer('pointerup', 1, x - 46, y + 5);
    assert.equal(Object.keys(api.cropPointers).length, 0);
    assert.deepEqual({ ...api.view }, view, 'pinch does not alter the normal viewer');
  }
});

test('two fingers can translate the image without changing final zoom', () => {
  const { api, pointer } = boot();
  api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
  api.setCropMode(true);
  const b = api.cropView.box;
  const x = 100 + b.x + b.w / 2, y = 80 + b.y + b.h / 2;
  const before = { ...api.cropRect() }, k = api.cropView.k;
  pointer('pointerdown', 1, x - 40, y);
  pointer('pointerdown', 2, x + 40, y);
  pointer('pointermove', 1, x - 25, y + 8);
  pointer('pointermove', 2, x + 55, y + 8);
  const after = api.cropRect();
  near(after.w, before.w, 'constant finger separation retains scale');
  near(after.sx, before.sx - 15 / k, 'horizontal midpoint translation pans image');
  near(after.sy, before.sy - 8 / k, 'vertical midpoint translation pans image');
  pointer('pointerup', 1, x - 25, y + 8);
  pointer('pointerup', 2, x + 55, y + 8);
});

test('default free crop shrinks by dragging a corner and retains its new shape', () => {
  const { api, ids, pointer } = boot();
  api.setCropMode(true);
  const before = { ...api.cropRect() };
  const b = { ...api.cropView.box };
  const handle = ids.get('cropbox').children.find(child => child.getAttribute('data-handle') === 'nw');
  assert.ok(handle, 'top-left handle exists');
  const x = 100 + b.x, y = 80 + b.y;
  pointer('pointerdown', 1, x, y, handle);
  pointer('pointermove', 1, x + 35, y + 17);
  const resized = { ...api.cropRect() };
  assert.ok(resized.w < before.w && resized.h < before.h, 'corner removes source pixels');
  assert.notEqual(resized.w / resized.h, before.w / before.h, 'Free allows an independent aspect ratio');
  pointer('pointerup', 1, x + 35, y + 17);
  for (const key of Object.keys(resized)) near(api.cropRect()[key], resized[key], 'refitting crop keeps ' + key);
  api.setCropMode(false);
  api.setCropMode(true);
  for (const key of Object.keys(resized)) near(api.cropRect()[key], resized[key], 'reentry keeps ' + key);
});

test('rotating a free crop preserves its source pixels and swaps the output dimensions', () => {
  const { api, ids } = boot();
  api.setCropToRect({ sx: 270, sy: 160, w: 820, h: 530 });
  const original = { ...api.cropRect() };
  api.setCropMode(true);
  for (const rot of [90, 180, 270, 0]) {
    api.setRotation(rot);
    const rect = api.cropRect();
    for (const key of Object.keys(original)) near(rect[key], original[key], `${rot}° preserves ${key}`);
    const width = Math.round(rot % 180 ? original.h : original.w);
    const height = Math.round(rot % 180 ? original.w : original.h);
    assert.equal(ids.get('cropdims').textContent, `${width} × ${height} px`);
    near(api.cropView.box.w / api.cropView.k, width, 'screen crop width is output width');
    near(api.cropView.box.h / api.cropView.k, height, 'screen crop height is output height');
  }
});

test('one zoom toggle switches between actual pixels and fit, and crop mode disables it', () => {
  const { api, ids, dispatch } = boot();
  const toggle = ids.get('bzoomtoggle');
  assert.ok(toggle, 'single zoom toggle exists');
  assert.ok(!ids.has('bzoomfit') && !ids.has('bzoomone') && !ids.has('zoomlabel'), 'old controls and redundant label removed');
  assert.equal(api.view.z, 1);
  assert.match(toggle.getAttribute('aria-label'), /actual|1:1/i);
  dispatch(toggle, 'click');
  assert.ok(api.view.z > 1, 'first tap zooms into actual pixels');
  assert.match(toggle.getAttribute('aria-label'), /fit/i);
  dispatch(toggle, 'click');
  assert.equal(api.view.z, 1, 'second tap returns to fit');
  assert.match(toggle.getAttribute('aria-label'), /actual|1:1/i);
  api.setCropMode(true);
  assert.equal(toggle.disabled, true, 'crop mode owns zoom');
  api.setCropMode(false);
  assert.equal(toggle.disabled, false, 'inspection zoom is available again');
});

test('fitted video allows scrolling and cancelled swipes do not trigger zoom', () => {
  const { api, ids, pointer, dispatch } = boot();
  const viewport = ids.get('viewport');
  api.setCropMode(false);
  assert.equal(viewport.style.touchAction, 'pan-y');
  for (let id = 1; id <= 2; id++) {
    assert.ok(!pointer('pointerdown', id, 200, 200, viewport).defaultPrevented);
    assert.ok(!pointer('pointermove', id, 200, 198, viewport).defaultPrevented);
    pointer('pointercancel', id, 200, 198, viewport);
  }
  assert.equal(api.view.z, 1);
  assert.equal(Object.keys(api.viewerPointers).length, 0);
  dispatch(ids.get('bzoomtoggle'), 'click');
  assert.equal(viewport.style.touchAction, 'pan-y');
  pointer('pointerdown', 3, 200, 200, viewport);
  assert.ok(!pointer('pointermove', 3, 200, 220, viewport).defaultPrevented);
  assert.equal(api.view.ty, 0);
  pointer('pointerup', 3, 200, 220, viewport);
  dispatch(ids.get('bzoomtoggle'), 'click');
  assert.equal(viewport.style.touchAction, 'pan-y');
  api.setCropMode(true);
  assert.equal(viewport.style.touchAction, 'pan-y');
});

test('actual pixels can zoom out for a small source on a high-density display', () => {
  const { api, ids, video, window, dispatch } = boot();
  video.videoWidth = 960;
  video.videoHeight = 540;
  window.devicePixelRatio = 2;
  api.layoutViewer();
  const toggle = ids.get('bzoomtoggle');
  dispatch(toggle, 'click');
  const actual = video.videoWidth / (video.offsetWidth * window.devicePixelRatio);
  assert.ok(actual < 1, 'fixture needs to shrink to render one source pixel per physical pixel');
  near(api.view.z, actual, 'actual pixel view uses the physical display density');
  assert.match(toggle.getAttribute('aria-label'), /fit/i);
  assert.equal(toggle.classList.contains('zoomed'), true, 'toggle shows the fit action for a reduced view');
  dispatch(toggle, 'click');
  near(api.view.z, 1, 'second tap restores fit');
  assert.match(toggle.getAttribute('aria-label'), /actual|1:1/i);
});

test('all resize handles preserve bounds and locked aspect ratios through rotation', () => {
  for (const rot of [0, 90, 180, 270]) {
    for (const free of [true, false]) {
      for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const { api } = boot();
        api.state.rot = rot;
        api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
        api.state.crop.free = free;
        api.setCropMode(true);
        const before = { ...api.cropRect() };
        const dx = handle.includes('w') ? 15 : handle.includes('e') ? -15 : 0;
        const dy = handle.includes('n') ? 10 : handle.includes('s') ? -10 : 0;
        api.resizeCrop(handle, dx, dy);
        const resized = api.cropRect();
        assertWithin(resized, 1920, 1080);
        assert.ok(resized.w < before.w || resized.h < before.h, `${rot}° ${free ? 'free' : 'locked'} ${handle} shrinks`);
        if (!free) near(resized.w / resized.h, before.w / before.h, 'locked source aspect');
        const b = api.cropView.box, k = api.cropView.k;
        near((rot % 180 ? resized.h : resized.w) * k, b.w, 'source crop matches screen box width');
        near((rot % 180 ? resized.w : resized.h) * k, b.h, 'source crop matches screen box height');
        api.resizeCrop(handle, -dx * 1000, -dy * 1000);
        assertWithin(api.cropRect(), 1920, 1080);
      }
    }
  }
});

test('one-finger crop swipes allow page scrolling without changing the crop', () => {
  const { api, ids, pointer } = boot();
  api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
  api.setCropMode(true);
  const before = { ...api.cropRect() };
  assert.ok(!pointer('pointerdown', 1, 300, 220).defaultPrevented);
  assert.ok(!pointer('pointermove', 1, 300, 160).defaultPrevented);
  assert.deepEqual({ ...api.cropRect() }, before);
  pointer('pointercancel', 1, 300, 160);
  assert.equal(Object.keys(api.cropPointers).length, 0);
  assert.equal(ids.get('viewport').style.touchAction, 'pan-y');
});

test('ordinary trackpad scrolling over the crop does not zoom or block the page', () => {
  const { api, ids, dispatch } = boot();
  api.setCropMode(true);
  const before = { ...api.cropRect() };
  const event = dispatch(ids.get('cropwrap'), 'wheel', {
    clientX: 300, clientY: 200, deltaY: 80, deltaMode: 0, ctrlKey: false
  });
  assert.ok(!event.defaultPrevented);
  assert.ok(!event.propagationStopped);
  assert.deepEqual({ ...api.cropRect() }, before);
});

test('wheel zoom and keyboard panning use the crop while preserving viewer state', () => {
  const { api, ids, dispatch } = boot();
  api.view.z = 2;
  api.view.tx = 30;
  api.view.ty = -10;
  const view = { ...api.view };
  api.setCropToRect({ sx: 480, sy: 270, w: 960, h: 540 });
  api.setCropMode(true);
  const b = api.cropView.box;
  const before = { ...api.cropRect() };
  const event = dispatch(ids.get('cropwrap'), 'wheel', { clientX: 100 + b.x + b.w / 2, clientY: 80 + b.y + b.h / 2, deltaY: -50, deltaMode: 0, ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.ok(api.cropRect().w < before.w, 'wheel zooms into selected source pixels');
  const zoomed = { ...api.cropRect() };
  dispatch(ids.get('cropbox'), 'keydown', { key: 'ArrowRight' });
  assert.ok(api.cropRect().sx < zoomed.sx, 'arrow moves image right');
  api.setCropMode(false);
  assert.deepEqual({ ...api.view }, view, 'normal viewer zoom and position are restored');
});

test('blur, capture loss, and browser resize cancel active crop gestures', () => {
  for (const event of ['blur', 'lostpointercapture', 'resize']) {
    const { api, pointer, dispatch, window, ids } = boot();
    api.setCropMode(true);
    pointer('pointerdown', 1, 350, 220);
    dispatch(event === 'lostpointercapture' ? ids.get('cropwrap') : window, event, { pointerId: 1 });
    assert.equal(Object.keys(api.cropPointers).length, 0, event + ' clears pointers');
    assert.equal(api.cropDrag, null, event + ' clears resize state');
    assertWithin(api.cropRect(), 1920, 1080);
  }
});

test('Original keeps source proportions and selection across orientation switches', () => {
  for (const [width, height] of [[1080,1920],[1920,1080],[1000,1000],[1500,1000]]) {
    for (const rotation of [0,90,180,270]) {
      const { api, ids, video } = boot();
      video.videoWidth=width; video.videoHeight=height;
      api.setRotation(rotation);
      api.setCropMode(true);
      const chip = label => ids.get('cropstrip').children.find(b => b.textContent===label);
      for (const orientation of ['portrait','landscape','portrait']) {
        ids.get('bcrop'+orientation).click();
        chip('Original').click();
        const r=api.cropRect();
        const outputRatio=rotation%180?r.h/r.w:r.w/r.h;
        const wide=Math.max(width/height,height/width);
        near(outputRatio,orientation==='portrait'?1/wide:wide);
        assert.equal(chip('Original').getAttribute('aria-pressed'),'true');
        assertWithin(r,width,height);
      }
      ids.get('bcroplandscape').click();
      assert.equal(chip('Original').getAttribute('aria-pressed'),'true');
      chip('1:1').click();
      assert.equal(chip('Original').getAttribute('aria-pressed'),'false');
      assert.equal(chip('1:1').getAttribute('aria-pressed'),'true');
    }
  }
});

test('orientation switch filters presets and flips a locked crop at every rotation', () => {
  for (const rot of [0, 90, 180, 270]) {
    const { api, ids } = boot();
    api.setRotation(rot);
    api.setCropMode(true);
    ids.get('bcropportrait').click();
    const labels = () => ids.get('cropstrip').children.map(b => b.textContent);
    assert.deepEqual(labels(), ['Free','Original','1:1','4:5','2:3','9:16']);
    ids.get('cropstrip').children.find(b => b.textContent === '4:5').click();
    ids.get('bcroplandscape').click();
    assert.deepEqual(labels(), ['Free','Original','1:1','5:4','3:2','16:9']);
    const r=api.cropRect();
    near(rot % 180 ? r.h/r.w : r.w/r.h, 1.25, 'landscape output ratio');
    assert.equal(ids.get('bcroplandscape').getAttribute('aria-pressed'), 'true');
    assertWithin(r,1920,1080);
    ids.get('bcropportrait').click();
    near(api.state.crop.ratio,0.8,'portrait counterpart restored');
  }
});

test('rotation preserves its arrow and does not print a routine status message', () => {
  const { api, ids } = boot();
  const icon=ids.get('brotate').children[0];
  assert.equal(icon.tagName,'SVG');
  for (const rot of [90,180,270,0]) {
    api.setRotation(rot);
    assert.equal(ids.get('brotate').children[0],icon);
    assert.equal(ids.has('status'),false,'no persistent status area below the actions');
    assert.equal(ids.get('savetoasttext').textContent,'');
    assert.ok(ids.get('brotate').getAttribute('aria-label').includes(String(rot)));
  }
});

test('full-frame crop reaches the viewer edges and crop actions replace zoom', () => {
  const { api, ids }=boot();
  for (const rot of [0,90,180,270]) {
    api.setRotation(rot);
    api.setCropMode(true);
    assert.ok(Math.abs(api.cropView.box.x)<0.5,'no horizontal inset beyond pixel rounding');
    assert.ok(Math.abs(api.cropView.box.y)<0.5,'no vertical inset beyond pixel rounding');
    assert.ok(Math.abs(api.cropView.box.w-ids.get('viewport').clientWidth)<1,'crop fills viewer width within pixel rounding');
    assert.equal(ids.get('bzoomtoggle').hidden,true);
    assert.equal(ids.get('cropactions').className,'cropactions on');
    assert.equal(ids.has('cropoptions'),false);
    api.setCropMode(false);
    assert.equal(ids.get('bzoomtoggle').hidden,false);
    assert.equal(ids.get('cropactions').className,'cropactions');
  }
});

test('Done shows only the applied crop, while reopening restores the editor', () => {
  for(const rot of [0,90,180,270]) {
    const { api, ids }=boot();
    api.setRotation(rot);
    api.setCropToRect({sx:300,sy:200,w:800,h:500});
    const before={...api.cropRect()};
    api.setCropMode(true);
    assert.equal(ids.get('cropwrap').style.display,'block');
    api.setCropMode(false);
    assert.equal(ids.get('cropwrap').style.display,'none');
    assert.ok(ids.get('vframe').style.clipPath.startsWith('inset('));
    const ratio=rot%180?before.h/before.w:before.w/before.h;
    assert.ok(Math.abs(ids.get('viewport').clientHeight-ids.get('viewport').clientWidth/ratio)<=0.5);
    assert.deepEqual({...api.cropRect()},before,'Done preserves the export crop');
    api.setCropMode(true);
    assert.equal(ids.get('vframe').style.clipPath,'none');
    assert.equal(ids.get('cropwrap').style.display,'block');
    assert.deepEqual({...api.cropRect()},before);
  }
});

}

module.exports = { boot, assertWithin, near };
