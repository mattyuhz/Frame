'use strict';

// Exercise the shipped navigation/detector bytes. Pixel fixtures below are
// deliberate signals, while the MP4 fixtures cover the real decode path.
const assert = require('node:assert/strict');
const test = require('node:test');
const { boot, near } = require('./crop.test.cjs');

const exposure = `
  window.__sceneTest = {
    sceneNav, buildSceneRanges, sceneBounds, clampSceneFrame, selectScene,
    prepareScenes, resetScenes, setSections, cancelSceneScan, startSceneScan,
    sceneSignature, sceneDifference, detectSceneCuts, framesPerPx,
    scrubAbsolute, step, requestFrame, setFrameUI, tickScenePlayback,
    paintSceneCards, paintSceneFocus, toggleMark, paintMarks, nameFor,
    boundaryLimits, openBoundaryReview, adjustBoundary, applyBoundary, closeBoundaryReview,
    setSeek(fn){ runSeek=fn; },
    setSaving(value){ saving=value; }
  };
`;

function setup(duration = 120, fps = 30, enabled = true) {
  const f = boot({ exposure });
  f.scene = f.window.__sceneTest;
  f.video.duration = duration;
  Object.assign(f.api.state, { fps, total: Math.max(1, Math.round(duration * fps)), frame: 0, url: 'blob:scene-source', base: 'source' });
  f.scene.sceneNav.duration = duration;
  f.scene.sceneNav.enabled = enabled;
  f.scene.sceneNav.items = f.scene.buildSceneRanges(duration, []);
  f.scene.paintSceneCards();
  f.seeks = [];
  f.scene.setSeek(n => { f.seeks.push(n); f.video.currentTime = (n + 0.5) / fps; return Promise.resolve('seeked'); });
  for (const id of ['boundarybefore', 'boundaryafter']) {
    const canvas = f.ids.get(id); canvas.width = 320; canvas.height = 180;
  }
  return f;
}

const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function pixels(fn) {
  const data = new Uint8Array(32 * 18 * 4);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
    const rgb = fn(x, y), i = (y * 32 + x) * 4;
    data.set([rgb[0], rgb[1], rgb[2], 255], i);
  }
  return data;
}
function solid(r, g, b) { return pixels(() => [r, g, b]); }
function signal(f, frames, interval = 0.5) {
  return frames.map((frame, i) => ({ time: i * interval, sig: f.scene.sceneSignature(frame) }));
}
function providePixels(f, getPixels) {
  const create = f.document.createElement;
  f.document.createElement = tag => {
    const element = create(tag);
    if (tag === 'canvas') {
      element.getContext().getImageData = () => ({ data: getPixels() });
      element.toDataURL = () => 'data:image/jpeg;base64,fixture';
    }
    return element;
  };
}
async function finishScan(f) {
  f.scene.startSceneScan();
  for (let i = 0; i < 500 && !f.scene.sceneNav.done; i++) {
    await flush();
    const timer = f.scene.sceneNav.timer;
    if (timer !== null) {
      const callback = f.timers.get(timer);
      assert.equal(typeof callback, 'function');
      f.timers.delete(timer); callback();
    }
  }
  await flush();
  assert.equal(f.scene.sceneNav.done, true, 'scene scan finishes within its bounded sample budget');
}

test('time sections cover the whole source once and keep a long video overview bounded', () => {
  const f = setup();
  for (const duration of [1 / 30, 0.25, 30, 30.01, 120, 1200, 18000]) {
    const ranges = f.scene.buildSceneRanges(duration, []);
    assert.ok(ranges.length > 0 && ranges.length <= 120);
    assert.equal(ranges[0].start, 0);
    near(ranges.at(-1).end, duration, 'last section reaches source end');
    ranges.forEach((r, i) => {
      assert.ok(r.end > r.start);
      assert.equal(r.kind, 'Section', 'time chunks are not presented as detected scenes');
      if (i) near(r.start, ranges[i - 1].end, 'adjacent sections meet');
    });
  }
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(f.scene.buildSceneRanges(duration, []).length, 0);
});

test('scene suggestions sanitize cuts and keep long stretches usable as sections', () => {
  const f = setup();
  const ranges = f.scene.buildSceneRanges(100, [99.99, 20, 20, -3, 0, NaN, 10, Infinity]);
  assert.deepEqual(plain(ranges.slice(0, 2)), [
    { start: 0, end: 10, kind: 'Scene' }, { start: 10, end: 20, kind: 'Scene' }
  ]);
  assert.ok(ranges.slice(2).every(r => r.kind === 'Section' && r.end - r.start <= 30));
  assert.equal(ranges.at(-1).end, 100);
});

test('focused scrubbing expands its range with absolute timestamps and accessible endpoints', async () => {
  const f = setup(1200);
  const fullScale = f.scene.framesPerPx();
  f.scene.selectScene(2);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 1800, end: 2699 });
  assert.equal(f.api.state.frame, 1800);
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemin'), '1800');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemax'), '2699');
  assert.ok(f.scene.framesPerPx() < fullScale / 39);
  assert.equal(f.ids.get('scenelist').children[2].getAttribute('aria-pressed'), 'true');
  const rect = f.ids.get('scrub').getBoundingClientRect();
  f.scene.scrubAbsolute(rect.left - 50); assert.equal(f.api.state.frame, 1800);
  f.scene.scrubAbsolute(rect.right + 50); assert.equal(f.api.state.frame, 2699);
  f.scene.scrubAbsolute(rect.left + rect.width / 2); assert.equal(f.api.state.frame, 2250);
  assert.equal(f.ids.get('tc').textContent, '00:01:15:00', 'timecode remains source absolute');
  assert.equal(f.scene.sceneNav.active, 2);
  f.scene.selectScene(-1);
  assert.equal(f.api.state.frame, 2250, 'Whole video preserves the selected moment');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemin'), '0');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemax'), '35999');
  await flush();
});

test('step, wheel, Home/End and fine pointer scrubbing cannot escape the focused section', () => {
  const f = setup(); f.scene.selectScene(1);
  f.scene.step(-10); assert.equal(f.api.state.frame, 900);
  f.scene.setFrameUI(1798); f.scene.step(10); assert.equal(f.api.state.frame, 1799);
  const scrub = f.ids.get('scrub');
  f.dispatch(scrub, 'keydown', { key: 'Home' }); assert.equal(f.api.state.frame, 900);
  f.dispatch(scrub, 'wheel', { deltaX: 0, deltaY: -1 }); assert.equal(f.api.state.frame, 900);
  f.dispatch(scrub, 'keydown', { key: 'End' }); assert.equal(f.api.state.frame, 1799);
  const r = scrub.getBoundingClientRect();
  f.pointer('pointerdown', 81, r.left + r.width / 2, r.top + 10, scrub);
  const anchor = f.api.state.frame;
  f.pointer('pointermove', 81, r.left + r.width / 2, r.top - 200, scrub);
  assert.equal(f.api.state.frame, anchor, 'entering finer tier must re-anchor without a jump');
  f.pointer('pointermove', 81, r.left + r.width / 2 + 100, r.top - 200, scrub);
  near(f.api.state.frame, Math.round(anchor + 100 * 899 / r.width * 0.04), 'fine tier uses selected range');
  f.pointer('pointermove', 81, r.left - 100000, r.top - 200, scrub);
  assert.equal(f.api.state.frame, 900);
  f.pointer('pointerup', 81, r.left, r.top - 200, scrub);
});

test('tiny sections have finite coordinates and nonnegative frame bounds', () => {
  const f = setup(1 / 30); f.scene.selectScene(0);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: 0 });
  assert.equal(f.scene.framesPerPx(), 0);
  f.scene.scrubAbsolute(100000); f.scene.step(10);
  assert.equal(f.api.state.frame, 0);
  assert.equal(f.ids.get('playhead').style.left, '0%');
});

test('fractional frame rates preserve the cut frame despite floating-point round trips', () => {
  for (const [fps, cutFrame] of [[23.976, 25], [29.97, 125], [59.94, 125], [29.67, 15]]) {
    const f = setup(20, fps), cut = cutFrame / fps;
    assert.ok(cut * fps > cutFrame, 'fixture must exercise upward floating-point error');
    f.scene.sceneNav.items = f.scene.buildSceneRanges(20, [cut]);
    f.scene.selectScene(0);
    assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: cutFrame - 1 });
    f.scene.selectScene(1);
    assert.deepEqual(plain(f.scene.sceneBounds()), { start: cutFrame, end: f.api.state.total - 1 });
    assert.equal(f.api.state.frame, cutFrame);
  }
});

test('marks outside a scene return to the original source and export keeps the original timestamp', async () => {
  const f = setup();
  f.scene.selectScene(2); f.scene.setFrameUI(1901); f.scene.toggleMark();
  assert.deepEqual([...f.api.state.marks], [1901]);
  f.scene.selectScene(0);
  f.ids.get('chips').children[0].click();
  assert.equal(f.api.state.frame, 1901);
  assert.equal(f.scene.sceneNav.active, -1, 'a source mark outside focus remains reachable');
  const downloads = [];
  f.api.stubExport({
    currentBlob: () => Promise.resolve(new Blob(['frame'], { type: 'image/png' })),
    verifyImage: () => Promise.resolve({ w: 1920, h: 1080 }),
    downloadBlob: (blob, name) => downloads.push(name)
  });
  await f.api.saveCurrent();
  assert.deepEqual(downloads, ['source_00-01-03-11.png']);
});

test('focused playback stops at the section boundary without stepping into the next section', () => {
  const f = setup(); f.scene.selectScene(1);
  f.video.paused = false; f.video.currentTime = 60.1;
  f.scene.tickScenePlayback();
  assert.equal(f.video.paused, true);
  assert.equal(f.api.state.frame, 1799);
  assert.equal(f.scene.sceneNav.active, 1);
});

test('playback seeks back to the section end even when the UI already shows the final frame', () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1799);
  const before = f.seeks.length;
  f.video.paused = false; f.video.currentTime = 60.1;
  f.scene.tickScenePlayback();
  assert.equal(f.video.paused, true);
  assert.equal(f.api.state.frame, 1799);
  assert.equal(f.seeks.length, before + 1, 'the decoder must seek even though the displayed frame is unchanged');
  assert.equal(f.seeks.at(-1), 1799);
  near(f.video.currentTime, 1799.5 / 30, 'decoded picture is inside the selected section');
});

test('detector identifies sustained cuts but rejects a one-sample flash and its return', () => {
  const f = setup(), a = solid(20, 40, 90), b = solid(230, 140, 20), flash = solid(255, 255, 255);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, b, b, b]))], [1.25]);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, flash, a, a, a]))], []);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, a]))], []);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, b]))], [], 'unconfirmed final change stays a suggestion-free section');
});

test('a flash during a moving shot does not create a cut when the picture returns farther along the pan', () => {
  const f = setup();
  const pan = offset => pixels(x => (x + offset) % 32 < 16 ? [0, 0, 0] : [255, 255, 255]);
  const before = pan(0), after = pan(8), later = pan(9), flash = solid(255, 255, 255);
  const motion = f.scene.sceneDifference(f.scene.sceneSignature(before), f.scene.sceneSignature(after));
  assert.ok(motion > 0.12 && motion < 0.25, 'the returning picture moves enough to defeat exact-return flash checks');
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [before, before, flash, after, later, later]))], []);
});

test('detector tolerates continuous movement and gradual changes in a textured shot', () => {
  const f = setup();
  const frames = Array.from({ length: 20 }, (_, n) => pixels((x, y) => {
    const v = ((x + n) % 32) * 7;
    return [v, y * 13, 80 + n];
  }));
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, frames))], []);
  const fade = Array.from({ length: 25 }, (_, n) => pixels((x, y) => {
    const v = Math.round(((x * 7 + y * 5) % 256) * (1 - n / 30));
    return [v, v, v];
  }));
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, fade))], []);
});

test('the spatial comparison can distinguish changed pictures with the same color histogram', () => {
  const f = setup();
  const a = pixels(x => x < 16 ? [0, 0, 0] : [255, 255, 255]);
  const b = pixels(x => x < 16 ? [255, 255, 255] : [0, 0, 0]);
  const sigA = f.scene.sceneSignature(a), sigB = f.scene.sceneSignature(b);
  assert.deepEqual([...sigA.hist], [...sigB.hist]);
  assert.ok(f.scene.sceneDifference(sigA, sigB) >= 0.3);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, b, b, b]))], [1.25]);
});

test('Sections starts off and preparing a video does not opt in or queue analysis', () => {
  const fresh = boot({ exposure });
  assert.equal(fresh.window.__sceneTest.sceneNav.enabled, false);
  const f = setup(180, 30, false);
  f.scene.prepareScenes();
  assert.equal(f.scene.sceneNav.items.length, 6);
  assert.equal(f.scene.sceneNav.enabled, false);
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.ids.get('scenebody').hidden, true);
  assert.equal(f.ids.get('bsections').getAttribute('aria-checked'), 'false');
  f.scene.startSceneScan();
  assert.equal(f.scene.sceneNav.scan, null, 'the scan API also rejects use before opt-in');
  assert.equal(f.seeks.length, 0);
});

test('enabling Sections reveals immediately usable ranges but analysis requires Find scenes', async () => {
  const f = setup(180, 30, false);
  providePixels(f, () => solid(40, 80, 120));
  f.scene.prepareScenes();
  f.scene.setSections(true);
  assert.equal(f.scene.sceneNav.enabled, true);
  assert.equal(f.ids.get('bsections').getAttribute('aria-checked'), 'true');
  assert.equal(f.ids.get('scenebody').hidden, false);
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.scene.sceneNav.samples.length, 0);
  f.scene.selectScene(3);
  assert.equal(f.api.state.frame, 2700);
  assert.equal(f.scene.sceneNav.scan, null);
  f.ids.get('bscanscenes').click(); await flush();
  assert.ok(f.scene.sceneNav.scan, 'Find scenes explicitly starts analysis');
  assert.equal(f.scene.sceneNav.samples.length, 1);
  f.scene.cancelSceneScan(false);
});

test('turning Sections off cancels analysis and returns to the whole video at the selected moment', async () => {
  const f = setup(180), first = deferred();
  f.scene.setSections(true); f.scene.selectScene(3); f.scene.setFrameUI(2800);
  f.scene.setSeek(() => first.promise); f.scene.startSceneScan();
  assert.ok(f.scene.sceneNav.scan);
  f.scene.setSections(false);
  assert.equal(f.scene.sceneNav.enabled, false);
  assert.equal(f.scene.sceneNav.active, -1);
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.ids.get('scenebody').hidden, true);
  assert.equal(f.ids.get('bsections').getAttribute('aria-checked'), 'false');
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: 5399 });
  assert.equal(f.api.state.frame, 2800);
  first.resolve('seeked'); await flush();
  assert.equal(f.scene.sceneNav.samples.length, 0, 'late scanner completion cannot repopulate disabled mode');
  assert.equal(f.api.state.frame, 2800);
});

test('short uncut clips show Find scenes before scanning and only a brief result after scanning', async () => {
  for (const duration of [0.4, 3.1, 18]) {
    const f = setup(duration);
    providePixels(f, () => solid(40, 80, 120));
    f.scene.prepareScenes();
    assert.equal(f.scene.sceneNav.items.length, 1, 'the internal range still covers the source');
    assert.equal(f.ids.get('scenelist').children.length, 0, 'a single whole-video range has no redundant card');
    assert.equal(f.ids.get('scenelist').hidden, true);
    assert.equal(f.ids.get('scenefocus').hidden, true);
    assert.equal(f.ids.get('scenetitle').hidden, true);
    assert.equal(f.ids.get('sceneoptions').hidden, false);
    assert.equal(f.ids.get('bscanscenes').disabled, false);
    assert.equal(f.ids.get('bscanscenes').textContent, 'Find scenes');
    assert.equal(f.ids.get('scenestatus').textContent, '');
    await finishScan(f);
    assert.equal(f.scene.sceneNav.items.length, 1);
    assert.equal(f.ids.get('scenelist').children.length, 0);
    assert.equal(f.ids.get('scenefocus').hidden, true);
    assert.equal(f.ids.get('sceneoptions').hidden, true, 'no disabled Scan complete action occupies the panel');
    assert.equal(f.ids.get('scenetitle').hidden, true);
    assert.equal(f.ids.get('scenestatus').textContent, 'No scene changes found.');
    f.scene.setSections(false); f.scene.setSections(true);
    assert.equal(f.ids.get('sceneoptions').hidden, true, 'mode toggles retain the completed compact state');
    assert.equal(f.ids.get('scenefocus').hidden, true);
    assert.equal(f.ids.get('scenelist').children.length, 0);
    assert.equal(f.scene.sceneNav.scan, null);
    f.dispatch(f.ids.get('scrub'), 'keydown', { key: 'End' });
    assert.equal(f.api.state.frame, f.api.state.total - 1, 'the ordinary scrubber still reaches the source end');
  }
});

test('long uncut videos retain useful multiple sections after analysis', async () => {
  const f = setup(180);
  providePixels(f, () => solid(40, 80, 120));
  f.scene.prepareScenes();
  assert.equal(f.ids.get('scenelist').children.length, 6);
  assert.equal(f.ids.get('scenelist').hidden, false);
  assert.equal(f.ids.get('scenefocus').hidden, false);
  assert.equal(f.ids.get('scenetitle').hidden, false);
  await finishScan(f);
  assert.equal(f.scene.sceneNav.items.length, 6);
  assert.equal(f.ids.get('scenelist').children.length, 6);
  assert.equal(f.ids.get('scenelist').hidden, false);
  assert.equal(f.ids.get('scenefocus').hidden, false);
  assert.equal(f.ids.get('scenestatus').textContent, 'No scene changes found · 6 time sections.');
  f.scene.selectScene(5);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 4500, end: 5399 });
});

test('a replacement source restores Find scenes after a compact no-cut result', async () => {
  const f = setup(0.4);
  providePixels(f, () => solid(40, 80, 120));
  f.scene.prepareScenes(); await finishScan(f);
  assert.equal(f.ids.get('sceneoptions').hidden, true);
  f.scene.resetScenes(); f.api.state.url = 'blob:next-video';
  f.video.duration = 18; f.api.state.total = 540; f.api.state.frame = 0;
  f.scene.prepareScenes();
  assert.equal(f.scene.sceneNav.enabled, false);
  f.scene.setSections(true);
  assert.equal(f.scene.sceneNav.done, false);
  assert.equal(f.ids.get('sceneoptions').hidden, false);
  assert.equal(f.ids.get('bscanscenes').disabled, false);
  assert.equal(f.ids.get('bscanscenes').textContent, 'Find scenes');
  assert.equal(f.ids.get('scenestatus').textContent, '');
  assert.equal(f.ids.get('scenelist').children.length, 0);
  assert.equal(f.scene.sceneNav.scan, null);
});

test('boundary review shows the adjacent decoded frames without changing the selected moment or ranges', async () => {
  const f = setup();
  f.scene.selectScene(0);
  assert.equal(f.ids.get('breviewstart').hidden, true);
  assert.equal(await f.scene.openBoundaryReview(), false, 'the first section has no preceding boundary');
  f.scene.selectScene(1); f.scene.setFrameUI(1000);
  const original = plain(f.scene.sceneNav.items), drawn = [];
  for (const id of ['boundarybefore', 'boundaryafter']) {
    const ctx = f.ids.get(id).getContext(), draw = ctx.drawImage;
    ctx.drawImage = (...args) => { drawn.push({ id, time: f.video.currentTime, source: args[0] }); draw(...args); };
  }
  assert.equal(f.ids.get('breviewstart').hidden, false);
  assert.equal(await f.scene.openBoundaryReview(), true);
  assert.equal(f.scene.sceneNav.review.ready, true);
  assert.equal(f.ids.get('bboundaryapply').disabled, false);
  assert.deepEqual(drawn.map(d => d.id), ['boundarybefore', 'boundaryafter']);
  near(drawn[0].time, 899.5 / 30, 'before canvas captures preceding frame');
  near(drawn[1].time, 900.5 / 30, 'after canvas captures first frame');
  assert.ok(drawn.every(d => d.source === f.video));
  assert.equal(f.api.state.frame, 1000);
  assert.deepEqual(plain(f.scene.sceneNav.items), original);
  assert.match(f.ids.get('boundarybefore').getAttribute('aria-label'), /source frame 899/);
  assert.match(f.ids.get('boundaryafter').getAttribute('aria-label'), /source frame 900/);
});

test('boundary adjustments clamp to neighboring ranges and Cancel leaves all footage and the source moment unchanged', async () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1000);
  const original = plain(f.scene.sceneNav.items);
  assert.deepEqual(plain(f.scene.boundaryLimits(1)), { min: 1, max: 1799 });
  assert.equal(f.scene.boundaryLimits(0), null);
  await f.scene.openBoundaryReview();
  await f.scene.adjustBoundary(-10000);
  assert.equal(f.scene.sceneNav.review.frame, 1);
  assert.equal(f.ids.get('bboundaryback').disabled, true);
  await f.scene.adjustBoundary(10000);
  assert.equal(f.scene.sceneNav.review.frame, 1799);
  assert.equal(f.ids.get('bboundaryforward').disabled, true);
  assert.deepEqual(plain(f.scene.sceneNav.items), original, 'adjusting the preview is not an edit until Apply');
  assert.equal(f.scene.closeBoundaryReview(true), true); await flush();
  assert.equal(f.scene.sceneNav.review, null);
  assert.equal(f.ids.get('boundaryreview').hidden, true);
  assert.deepEqual(plain(f.scene.sceneNav.items), original);
  assert.equal(f.api.state.frame, 1000);
  near(f.video.currentTime, 1000.5 / 30, 'Cancel restores the selected picture');
});

test('applying a boundary shares one exact timestamp across neighbors at fractional frame rates', async () => {
  for (const fps of [30, 29.97, 23.976]) {
    const f = setup(20, fps), originalCut = 125;
    f.scene.sceneNav.items = f.scene.buildSceneRanges(20, [originalCut / fps]);
    f.scene.selectScene(1); await f.scene.openBoundaryReview();
    await f.scene.adjustBoundary(1);
    assert.equal(f.scene.applyBoundary(), true);
    const items = f.scene.sceneNav.items;
    assert.equal(items[0].start, 0); assert.equal(items[1].end, 20);
    assert.equal(items[0].end, items[1].start, 'one shared value prevents gaps and overlap');
    near(items[1].start, 126 / fps, 'manual boundary keeps source frame precision');
    assert.equal(f.api.state.frame, 126);
    f.scene.selectScene(0); assert.equal(f.scene.sceneBounds().end, 125);
    f.scene.selectScene(1); assert.equal(f.scene.sceneBounds().start, 126);
    assert.ok(items.every(item => item.end > item.start));
    assert.equal(f.scene.sceneNav.edited, true);
    assert.equal(f.ids.get('bscanscenes').disabled, true);
    f.scene.startSceneScan(); assert.equal(f.scene.sceneNav.scan, null, 'scanning cannot overwrite applied boundaries');
    f.scene.setSections(false); f.scene.setSections(true);
    assert.equal(f.scene.sceneNav.items[1].start, 126 / fps, 'same-file mode toggles retain manual edits');
    assert.equal(f.scene.sceneNav.scan, null);
  }
});

test('boundary Apply stays disabled while decoding and failed previews cannot be applied', async () => {
  const f = setup(), seek = deferred(); f.scene.selectScene(1);
  f.scene.setSeek(() => seek.promise);
  const pending = f.scene.openBoundaryReview();
  assert.equal(f.scene.sceneNav.review.busy, true);
  assert.equal(f.ids.get('bboundaryapply').disabled, true);
  assert.equal(f.scene.applyBoundary(), false);
  assert.equal(await f.scene.adjustBoundary(10), false, 'adjustments cannot race a preview seek');
  seek.resolve('timeout');
  assert.equal(await pending, false);
  assert.equal(f.scene.sceneNav.review.ready, false);
  assert.equal(f.ids.get('bboundaryapply').disabled, true);
  assert.equal(f.scene.applyBoundary(), false);
  assert.match(f.ids.get('boundarystatus').textContent, /Could not decode/);
});

test('turning Sections off restores the selected picture after a completed boundary preview', async () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1000);
  await f.scene.openBoundaryReview();
  near(f.video.currentTime, 900.5 / 30, 'review temporarily borrows the decoder');
  f.scene.setSections(false); await flush();
  assert.equal(f.scene.sceneNav.review, null);
  assert.equal(f.api.state.frame, 1000);
  near(f.video.currentTime, 1000.5 / 30, 'Off restores the selected source picture');
});

test('late boundary callbacks cannot draw or apply after mode exit or source replacement', async () => {
  for (const replace of [false, true]) {
    const f = setup(), seek = deferred(); f.scene.selectScene(1); f.scene.setFrameUI(1000);
    const original = plain(f.scene.sceneNav.items);
    f.scene.setSeek(() => seek.promise);
    const pending = f.scene.openBoundaryReview();
    if (replace) { f.scene.resetScenes(); f.api.state.url = 'blob:new-source'; }
    else f.scene.setSections(false);
    seek.resolve('seeked'); assert.equal(await pending, false); await flush();
    assert.equal(f.scene.sceneNav.review, null);
    assert.equal(f.scene.applyBoundary(), false);
    assert.equal(f.ids.get('boundarybefore').getContext().calls.filter(c => c.name === 'drawImage').length, 0);
    assert.equal(f.ids.get('boundaryafter').getContext().calls.filter(c => c.name === 'drawImage').length, 0);
    if (!replace) assert.deepEqual(plain(f.scene.sceneNav.items), original);
    else assert.equal(f.scene.sceneNav.items.length, 0);
  }
});

test('saving from boundary review captures the original selection after its restore seek finishes', async () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1000);
  await f.scene.openBoundaryReview();
  const presented = [], captured = [], downloads = [];
  f.video.requestVideoFrameCallback = callback => { presented.push(callback); };
  f.scene.setSeek(f.api.runSeek);
  f.api.stubExport({
    currentBlob: () => { captured.push(f.video.currentTime); return Promise.resolve(new Blob(['pixels'], { type: 'image/png' })); },
    verifyImage: () => Promise.resolve({ w: 1920, h: 1080 }),
    downloadBlob: (blob, name) => downloads.push(name)
  });
  const saving = f.api.saveCurrent();
  await flush(); assert.equal(captured.length, 0, 'review pixels cannot be exported before the selected frame returns');
  for (const callback of presented) callback();
  await saving;
  assert.equal(f.scene.sceneNav.review, null);
  assert.equal(captured.length, 1);
  near(captured[0], 1000.5 / 30, 'export captures the restored selection');
  assert.deepEqual(downloads, ['source_00-00-33-10.png']);
});

test('boundary keyboard controls adjust their draft and Escape restores the prior selection', async () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1000);
  await f.scene.openBoundaryReview();
  f.dispatch(f.ids.get('bboundaryforward'), 'keydown', { key: 'ArrowRight', shiftKey: true });
  await flush(); assert.equal(f.scene.sceneNav.review.frame, 910);
  f.dispatch(f.ids.get('bboundaryback'), 'keydown', { key: 'ArrowLeft', shiftKey: false });
  await flush(); assert.equal(f.scene.sceneNav.review.frame, 909);
  f.dispatch(f.ids.get('bboundarycancel'), 'keydown', { key: 'Escape' }); await flush();
  assert.equal(f.scene.sceneNav.review, null);
  assert.equal(f.api.state.frame, 1000);
  near(f.video.currentTime, 1000.5 / 30, 'Escape restores source position');
});

test('interrupted analysis cannot collect stale pixels or restore over a newer user seek', async () => {
  const f = setup(90), first = deferred(), calls = [];
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setFrameUI(1000);
  f.scene.setSeek(n => { calls.push(n); return calls.length === 1 ? first.promise : Promise.resolve('seeked'); });
  f.scene.startSceneScan();
  assert.ok(f.scene.sceneNav.scan);
  assert.equal(f.api.state.frame, 1000, 'analysis keeps the user selection while borrowing the decoder');
  f.scene.requestFrame(1500);
  assert.equal(f.scene.sceneNav.scan, null);
  first.resolve('seeked'); await flush();
  assert.equal(f.api.state.frame, 1500);
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.scene.sceneNav.thumbs.length, 0);
  assert.deepEqual(calls, [0, 1500]);
  assert.equal(f.scene.sceneNav.timer, null);
});

test('file replacement invalidates an in-flight scan and resets its partial results', async () => {
  const f = setup(), first = deferred();
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setSeek(() => first.promise);
  f.scene.startSceneScan();
  f.scene.resetScenes(); f.api.state.url = 'blob:replacement'; f.scene.setFrameUI(0);
  first.resolve('seeked'); await flush();
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.scene.sceneNav.items.length, 0);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.ids.get('scenes').hidden, true);
  assert.equal(f.api.state.frame, 0);
});

test('analysis pause restores the selected frame and resumes from the next unprocessed sample', async () => {
  const f = setup(90);
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setFrameUI(1300); f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.samples.length, 1);
  assert.equal(f.scene.sceneNav.next, 1);
  const queued = f.scene.sceneNav.timer;
  f.scene.cancelSceneScan(true); await flush();
  assert.equal(f.timers.has(queued), false);
  assert.equal(f.seeks.at(-1), 1300);
  assert.equal(f.api.state.frame, 1300);
  f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.samples.length, 2);
  near(f.scene.sceneNav.samples[0].time, 0.5 / 30, 'first sample records the actual frame-center seek');
  near(f.scene.sceneNav.samples[1].time, 15.5 / 30, 'resumed sample records the actual frame-center seek');
  assert.equal(f.seeks.at(-1), 15);
  f.scene.cancelSceneScan(false);
});

test('a completed scan suggests cuts, keeps thumbnails, and returns to the selected source frame', async () => {
  const f = setup(4);
  providePixels(f, () => f.video.currentTime < 2 ? solid(20, 40, 90) : solid(230, 140, 20));
  f.scene.setFrameUI(42); f.scene.startSceneScan();
  for (let i = 0; i < 24 && !f.scene.sceneNav.done; i++) {
    await flush();
    const timer = f.scene.sceneNav.timer;
    if (timer !== null) {
      const callback = f.timers.get(timer);
      assert.equal(typeof callback, 'function');
      f.timers.delete(timer); callback();
    }
  }
  await flush();
  assert.equal(f.scene.sceneNav.done, true);
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.samples.length, 8);
  assert.equal(f.scene.sceneNav.cuts.length, 1);
  near(f.scene.sceneNav.cuts[0], 2, 'refinement uses the cut frame boundary, not its center');
  assert.equal(f.scene.sceneNav.items.length, 2);
  assert.ok(f.scene.sceneNav.items.every(item => item.kind === 'Scene'));
  assert.ok(f.scene.sceneNav.thumbs.length > 0);
  assert.equal(f.api.state.frame, 42);
  assert.equal(f.seeks.at(-1), 42);
  assert.equal(f.ids.get('bscanscenes').disabled, true);
  assert.equal(f.ids.get('scenestatus').textContent, 'Suggested scenes · review a start to check it.');
  f.scene.selectScene(0);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: 59 });
  f.scene.selectScene(1);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 60, end: 119 });
  assert.equal(f.api.state.frame, 60, 'choosing the next scene lands on its first frame');
});

test('real seek tokens keep a cancelled scan from completing or clearing a newer edit seek', async () => {
  const f = setup(90), presented = [];
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setSeek(f.api.runSeek);
  f.video.requestVideoFrameCallback = callback => { presented.push(callback); };
  f.scene.setFrameUI(1000); f.scene.startSceneScan();
  assert.equal(f.api.state.seeking, true);
  f.scene.requestFrame(1500);
  assert.equal(presented.length, 2);
  presented[0](); await flush();
  assert.equal(f.api.state.seeking, true, 'stale scan completion cannot clear the edit seek');
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.api.state.frame, 1500);
  presented[1](); await flush();
  assert.equal(f.api.state.seeking, false);
  assert.equal(f.scene.sceneNav.scan, null);
  near(f.video.currentTime, 1500.5 / 30, 'decoder stays at the requested source frame');
});

test('a hidden tab or a failed seek stops analysis without presenting a completed scan', async () => {
  const f = setup();
  f.document.hidden = true; f.scene.startSceneScan();
  assert.equal(f.scene.sceneNav.scan, null);
  f.document.hidden = false;
  f.scene.setSeek(() => Promise.resolve('timeout'));
  f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.done, false);
  assert.equal(f.scene.sceneNav.items.length, 4);
  assert.match(f.ids.get('scenestatus').textContent, /could not finish/);
});
