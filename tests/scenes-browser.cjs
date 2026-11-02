'use strict';
// Dev-only real decoder checks. Requires Playwright and a locally installed Chrome.
// Start `python3 -m http.server 8876 --bind 127.0.0.1` in the repository first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FRAME_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenes/manifest.json'))).fixtures;
const base = process.env.FRAME_PREVIEW_URL || 'http://127.0.0.1:8876';
const output = process.env.FRAME_QA_OUTPUT || '/tmp/frame-scene-qa';
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Expose existing functions only inside the test browser, as the unit harness does.
const instrumented = html.replace(/\}\)\(\);\s*<\/script>/, `window.__sceneQA={state,sceneNav,sceneBounds,requestFrame,goToFrame,selectScene,setFrameUI};\n})();\n</script>`);
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FRAME_CHROME ? { executablePath: process.env.FRAME_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1050 }, acceptDownloads: true });
  // The native macOS share sheet needs a human; exercise the real encoder,
  // verifier and download fallback in this unattended browser check.
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
  const errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) network.push(r.url()); });
  await page.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: instrumented }));
  const results = [];
  async function open(name, scan = true) {
    await page.goto(base + '/');
    await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes', name));
    await page.waitForFunction(() => window.__sceneQA.sceneNav.items.length > 0);
    assert.deepEqual(await page.evaluate(() => {
      const nav = window.__sceneQA.sceneNav;
      return { enabled: nav.enabled, scan: nav.scan, samples: nav.samples.length, timer: nav.timer };
    }), { enabled: false, scan: null, samples: 0, timer: null }, 'opening a video never opts into Sections or starts analysis');
    assert.equal(await page.locator('#bsections').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('#bsections').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#bsections').textContent(), 'Sections');
    assert.equal(await page.locator('#readout #bsections').count(), 1);
    assert.equal(await page.locator('#scenes').isVisible(), false);
    assert.equal(await page.locator('#scenebody').isVisible(), false);
    assert.equal(await page.locator('#videoinfo').isVisible(), false);
    assert.equal(await page.locator('#mFrame').isVisible(), false);
    assert.equal(await page.locator('#bvideoinfo').getAttribute('aria-expanded'), 'false');
    assert.match(await page.locator('#tc').textContent(), /^\d{2}:\d{2}\.\d{3}$/);
    if (scan) {
      await page.locator('#bsections').click();
      assert.equal(await page.locator('#bsections').getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('#bsections').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#bsections').textContent(), 'Sections');
      assert.equal(await page.locator('#scenes').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => [window.__sceneQA.sceneNav.scan, window.__sceneQA.sceneNav.timer, window.__sceneQA.sceneNav.samples.length]), [null, null, 0], 'Sections is navigation only until Find scenes');
      if (await page.evaluate(() => window.__sceneQA.sceneNav.items.length === 1)) {
        assert.equal(await page.locator('.scenecard').count(), 0, 'single-range sources do not show a redundant card');
        assert.equal(await page.locator('#scenetitle').count(), 0);
        assert.equal(await page.locator('#scenefocus').isVisible(), false);
        assert.equal(await page.locator('#bscanscenes').isVisible(), true, 'Find scenes remains available before analysis');
      }
      await page.locator('#bscanscenes').click();
    }
  }
  // Opening and enabling navigation must never secretly borrow the decoder.
  await open('02-long-continuous.mp4', false);
  await page.locator('#bvideoinfo').click();
  assert.equal(await page.locator('#videoinfo').isVisible(), true);
  assert.equal(await page.locator('#videoinfo').getAttribute('role'), 'region');
  assert.equal(await page.locator('#videoinfo').getAttribute('aria-label'), 'Video information');
  assert.equal(await page.locator('#mFrame').isVisible(), true);
  await page.locator('#videoinfo').click();assert.equal(await page.locator('#videoinfo').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#videoinfo').isVisible(), false);
  await page.locator('#bvideoinfo').click();await page.locator('#tc').click();
  assert.equal(await page.locator('#videoinfo').isVisible(), false, 'outside click dismisses metadata');
  await page.locator('#bvideoinfo').click();await page.keyboard.press('Tab');
  assert.equal(await page.locator('#videoinfo').isVisible(), false, 'keyboard focus leaving Info dismisses metadata');
  await page.locator('#bvideoinfo').click();
  await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes/03-flashes-and-pan.mp4'));
  await page.waitForFunction(() => window.__sceneQA.sceneNav.duration === 18 && window.__sceneQA.sceneNav.items.length > 0);
  assert.equal(await page.locator('#videoinfo').isVisible(), false, 'new source closes metadata');
  assert.equal(await page.locator('#bvideoinfo').getAttribute('aria-expanded'), 'false');
  await open('02-long-continuous.mp4', false);
  // Supply a long source-relative timestamp only in this test browser to audit
  // the compact readout without needing a multi-hour media file.
  const readoutState = await page.evaluate(() => {
    const q = window.__sceneQA, previous = { frame: q.state.frame, total: q.state.total, fps: q.state.fps,
      frameRateText: document.querySelector('#mFps').textContent, frameTotalText: document.querySelector('#mTotal').textContent };
    q.state.fps = 30;q.state.total = 15000000;q.setFrameUI((123 * 3600 + 45 * 60 + 56) * 30 + 23);
    document.querySelector('#mFps').textContent = '30 fps';document.querySelector('#mTotal').textContent = String(q.state.total);
    return previous;
  });
  assert.equal(await page.locator('#tc').textContent(), '123:45:56.767');
  const readoutGeometry = [];
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page overflow at ' + width);
    assert.equal(await page.locator('#readout').evaluate(el => el.scrollWidth > el.clientWidth), false, 'long-hour readout fits at ' + width);
    const controls = await page.evaluate(() => ['tc', 'bsections', 'bvideoinfo'].map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      const overlap = Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      assert.equal(overlap, false, a.id + ' and ' + b.id + ' do not overlap at ' + width);
    }
    readoutGeometry.push({ width, controls });
    await page.locator('#bvideoinfo').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'expanded Info fits at ' + width);
    await page.screenshot({ path: path.join(output, 'readout-' + width + '.png'), fullPage: true });
    await page.keyboard.press('Escape');
  }
  await page.evaluate(previous => {
    const q = window.__sceneQA;Object.assign(q.state, { frame: previous.frame, total: previous.total, fps: previous.fps });q.setFrameUI(previous.frame);
    document.querySelector('#mFps').textContent = previous.frameRateText;document.querySelector('#mTotal').textContent = previous.frameTotalText;
  }, readoutState);
  await page.setViewportSize({ width: 1024, height: 1050 });
  if (process.env.FRAME_QA_READOUT_ONLY === '1') {
    assert.deepEqual(errors, []);assert.deepEqual(network, []);
    fs.writeFileSync(path.join(output, 'readout-results.json'), JSON.stringify({ info: 'passed', keyboardDismissal: 'passed', readoutGeometry, errors, externalRequests: network }, null, 2) + '\n');
    console.log(JSON.stringify({ info: 'passed', keyboardDismissal: 'passed', readoutGeometry }));
    await browser.close();return;
  }
  await page.waitForTimeout(650);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.sceneNav.scan, window.__sceneQA.sceneNav.samples.length]), [null, 0]);
  await page.locator('#bsections').click();
  await page.locator('.scenecard').nth(2).click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  const offFrame = await page.evaluate(() => window.__sceneQA.state.frame);
  await page.locator('#bsections').click();
  assert.equal(await page.locator('#scenebody').isVisible(), false);
  assert.equal(await page.locator('#scenes').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.state.frame, window.__sceneQA.sceneNav.active, window.__sceneQA.sceneNav.samples.length]), [offFrame, -1, 0]);
  for (const fixture of fixtures) {
    const start = Date.now();
    await open(fixture.file);
    await page.waitForFunction(() => window.__sceneQA.sceneNav.done, {}, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const q = window.__sceneQA;
      return { cuts: q.sceneNav.cuts, sections: q.sceneNav.items.length, fps: q.state.fps,
        thumbnails: document.querySelectorAll('.scenecard img').length,
        status: document.querySelector('#scenestatus').textContent };
    });
    if (['01-hard-cuts.mp4', '06-portrait-variable-rate.mp4', '08-4k-cuts.mp4'].includes(fixture.file)) {
      assert.equal(result.cuts.length, fixture.cutsSeconds.length, fixture.file + ': cut count');
      result.cuts.forEach((t, i) => assert.ok(Math.abs(t - fixture.cutsSeconds[i]) <= 0.15, fixture.file + ': boundary within 150 ms'));
      assert.equal(result.thumbnails, result.sections, fixture.file + ': every scene has a visual preview');
    }
    if (['02-long-continuous.mp4', '03-flashes-and-pan.mp4', '07-subsecond.mp4'].includes(fixture.file)) assert.deepEqual(result.cuts, [], fixture.file + ': no false cuts');
    if (result.sections > 1) {
      assert.equal(await page.locator('.scenecard').count(), result.sections);
      assert.equal(await page.locator('#scenefocus').isVisible(), true);
      if (fixture.file === '02-long-continuous.mp4') assert.equal(result.sections, 6, 'long uncut footage keeps useful time sections');
      await page.locator('.scenecard').last().click();
      await page.waitForFunction(() => !window.__sceneQA.state.seeking);
    } else {
      assert.equal(await page.locator('.scenecard').count(), 0, fixture.file + ': no redundant whole-video card');
      assert.equal(await page.locator('#scenetitle').count(), 0);
      assert.equal(await page.locator('#bscanscenes').isVisible(), false, 'completed single-range scans have no Scan complete button');
      assert.equal(await page.locator('#scenefocus').isVisible(), false);
      assert.equal(result.status, 'No scene changes found.');
      await page.locator('#bsections').click();await page.locator('#bsections').click();
      assert.equal(await page.locator('#sceneoptions').isVisible(), false, 'mode toggle preserves compact state');
      assert.equal(await page.locator('#scenefocus').isVisible(), false);
      assert.equal(await page.locator('.scenecard').count(), 0);
      if (fixture.file === '07-subsecond.mp4') {
        await page.setViewportSize({ width: 390, height: 1000 });
        await page.screenshot({ path: path.join(output, 'no-cuts-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1024, height: 1050 });
      }
    }
    await page.locator('#scrub').focus();await page.keyboard.press('End');
    await page.waitForFunction(() => !window.__sceneQA.state.seeking);
    const endpoint = await page.evaluate(() => ({ frame: window.__sceneQA.state.frame, total: window.__sceneQA.state.total, time: document.querySelector('video').currentTime, bounds: window.__sceneQA.sceneBounds() }));
    assert.equal(endpoint.frame, endpoint.total - 1, fixture.file + ': final source frame reachable');
    assert.equal(endpoint.frame, endpoint.bounds.end);
    if (fixture.file === '08-4k-cuts.mp4') {
      const downloadPromise = page.waitForEvent('download');await page.locator('#bsave').click();
      const download = await downloadPromise, dest = path.join(output, '4k-export.png');await download.saveAs(dest);
      const bytes = fs.readFileSync(dest);assert.equal(bytes.readUInt32BE(16), 3840);assert.equal(bytes.readUInt32BE(20), 2160);
      result.exportDimensions = [3840, 2160];
    }
    result.file = fixture.file;result.elapsedMs = Date.now() - start;results.push(result);
    console.log(JSON.stringify(result));
  }
  // Verify the actual decoder pictures on each side of a cut, then exercise
  // draft cancellation and a shared boundary edit through the visible controls.
  await open('01-hard-cuts.mp4');
  await page.waitForFunction(() => window.__sceneQA.sceneNav.done, {}, { timeout: 60000 });
  await page.locator('.scenecard').nth(1).click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  await page.evaluate(() => window.__sceneQA.goToFrame(150));
  const initialReviewRanges = await page.evaluate(() => window.__sceneQA.sceneNav.items);
  await page.locator('#breviewstart').click();
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready);
  const pair = await page.evaluate(() => {
    const a = document.querySelector('#boundarybefore'), b = document.querySelector('#boundaryafter');
    const before = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const after = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let delta = 0;const sums = [[0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < before.length; i += 4) for (let c = 0; c < 3; c++) {
      sums[0][c] += before[i + c];sums[1][c] += after[i + c];delta += Math.abs(before[i + c] - after[i + c]);
    }
    return { labels: [a.getAttribute('aria-label'), b.getAttribute('aria-label')],
      means: sums.map(sum => sum.map(v => v / (before.length / 4))),
      difference: delta / (before.length / 4 * 3),
      boundary: window.__sceneQA.sceneNav.review.frame, selection: window.__sceneQA.state.frame };
  });
  assert.equal(pair.boundary, 120, 'review identifies the 4-second cut frame');
  assert.equal(pair.selection, 150, 'review keeps the user-selected source moment');
  assert.match(pair.labels[0], /source frame 119/);assert.match(pair.labels[1], /source frame 120/);
  assert.ok(pair.difference > 15, 'before/after must contain the distinct decoded shots, not identical/stale pixels');
  assert.ok(pair.means[0][2] > pair.means[0][0] + 10, 'Before contains the blue first shot');
  assert.ok(pair.means[1][0] > pair.means[1][2] + 10, 'After contains the burgundy second shot');
  // Opening the review must place keyboard focus inside it automatically.
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready && window.__sceneQA.sceneNav.review.frame === 121);
  assert.equal(await page.evaluate(() => window.__sceneQA.state.frame), 150);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready && window.__sceneQA.sceneNav.review.frame === 120);
  await page.screenshot({ path: path.join(output, 'boundary-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator('#boundaryreview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'boundary-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'boundary review fits mobile width');
  await page.setViewportSize({ width: 1024, height: 1050 });
  await page.locator('#bboundaryforward10').click();
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready && window.__sceneQA.sceneNav.review.frame === 130);
  await page.locator('#bboundarycancel').click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  assert.deepEqual(await page.evaluate(() => window.__sceneQA.sceneNav.items), initialReviewRanges);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.state.frame, window.__sceneQA.sceneNav.review]), [150, null]);
  assert.ok(Math.abs(await page.locator('video').evaluate(v => v.currentTime) - 150.5 / 30) < 0.002, 'Cancel restores the actual decoded source moment');
  await page.locator('#breviewstart').click();
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready);
  await page.locator('#bboundaryforward10').click();
  await page.waitForFunction(() => window.__sceneQA.sceneNav.review?.ready && window.__sceneQA.sceneNav.review.frame === 130);
  await page.locator('#bboundaryapply').click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  const editedRanges = await page.evaluate(() => window.__sceneQA.sceneNav.items);
  assert.equal(editedRanges[0].start, 0);assert.equal(editedRanges.at(-1).end, 16);
  assert.equal(editedRanges[0].end, 130 / 30);assert.equal(editedRanges[1].start, 130 / 30);
  assert.equal(await page.locator('#bscanscenes').isDisabled(), true);
  await page.locator('#bsections').click();await page.locator('#bsections').click();
  assert.deepEqual(await page.evaluate(() => window.__sceneQA.sceneNav.items), editedRanges, 'mode toggles preserve applied boundaries');
  assert.equal(await page.evaluate(() => window.__sceneQA.sceneNav.scan), null);
  console.log(JSON.stringify({ boundaryReview: 'passed', beforeAfter: pair, appliedFrame: 130 }));
  // Interaction must interrupt the actual decoder scan; wait to catch late callbacks.
  await open('02-long-continuous.mp4');
  await page.waitForFunction(() => !!window.__sceneQA.sceneNav.scan);
  await page.locator('.scenecard').nth(2).click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  const before = await page.evaluate(() => window.__sceneQA.state.frame);
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.state.frame, window.__sceneQA.sceneNav.scan]), [before, null]);
  // Resuming then replacing the file must leave no old sections or samples.
  await page.locator('#bscanscenes').click();
  await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes/07-subsecond.mp4'));
  await page.waitForFunction(() => window.__sceneQA.sceneNav.items.length > 0 && window.__sceneQA.sceneNav.duration < 1);
  assert.equal(await page.locator('#bsections').getAttribute('aria-checked'), 'false', 'new files start with Sections off');
  assert.equal(await page.locator('#scenebody').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.sceneNav.scan, window.__sceneQA.sceneNav.samples.length]), [null, 0]);
  await page.locator('#bsections').click();
  assert.equal(await page.locator('#bscanscenes').isVisible(), true, 'replacement restores Find scenes');
  assert.equal(await page.locator('#bscanscenes').isEnabled(), true);
  await page.locator('#bscanscenes').click();
  await page.waitForFunction(() => window.__sceneQA.sceneNav.done && window.__sceneQA.sceneNav.duration < 1);
  assert.equal(await page.locator('.scenecard').count(), 0);
  assert.equal(await page.locator('#sceneoptions').isVisible(), false);
  // Uninstrumented page: startup, real video and responsive screenshots.
  await page.unroute(base + '/');await page.goto(base + '/');
  await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes/01-hard-cuts.mp4'));
  await page.locator('#bsections').waitFor({ state: 'visible' });
  await page.locator('#bsections').click();
  await page.locator('#bscanscenes').click();
  await page.waitForFunction(() => document.querySelector('#bscanscenes').textContent === 'Scan complete', {}, { timeout: 60000 });
  await page.locator('.scenecard').nth(1).click();await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no mobile page overflow');
  assert.deepEqual(errors, []);assert.deepEqual(network, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, externalRequests: network, sectionsOptIn: 'passed', boundaryReview: { status: 'passed', beforeAfter: pair, appliedFrame: 130 }, cancellation: 'passed', replacement: 'passed', mobileOverflow: false }, null, 2) + '\n');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
