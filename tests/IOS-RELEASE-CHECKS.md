# iOS cleanup and releases

The production pages are `index.html` (Frame) and `compose.html` (Compose). The copies under `previews/` are experiments and are not promoted by this cleanup.

## Prepare a website release

After changing either page, the worker, or its update client:

```sh
python3 tools/prepare-release.py
python3 tools/prepare-release.py --check
node --test tests/*.test.cjs
```

Commit and publish the two generated HTML pages and `sw.js` together. GitHub Pages currently publishes `main` from the repository root. A feature branch does not update the live app. The release script uses Python's standard library only; it inlines the shared update client and stamps a content-derived release ID plus exact SHA-256 hashes. Editing the pages without re-running it makes the new worker reject installation and preserve the old version.

The worker caches only the two production pages, canonicalizes the directory entry to `index.html`, and does not cache previews, source media, or arbitrary same-origin requests. It verifies both pages before publishing a cache, awaits writes, and preserves unrelated caches. The exact legacy `frame-v15` cache is removed only when upgrading `/Frame/`.

The page checks at startup, foreground return, network recovery, and once per minute while visible. A waiting worker probes every app page before briefly locking safe clients and activating. Any page with media, pending file selection, export, share, modal, meaningful undo history, editable focus, or a text selection vetoes a reload. Unresponsive old/suspended pages also veto it. There is no forced refresh of active editing sessions.

Replacing running JavaScript requires a reload; this happens automatically only at a safe point. Offline/suspended apps cannot receive immediate deployments. The first migration from the legacy worker may need a natural close/navigation because the old page has no readiness handler. No routine cache clearing or reinstall is part of the new lifecycle.

## Device acceptance

Test the actual Home Screen installs, recording their launch URLs and iOS versions. Start with the reported iOS 26.6.1 behavior, then repeat on 27.2 if upgraded.

1. Rapidly tap buttons/readouts and drag across labels: no incidental text selection or page double-tap zoom. Deliberately select/copy error or metadata text.
2. Pinch the page outside gesture surfaces; pinch the image inside the viewer/crop. The explicit zoom button still works; image double taps no longer toggle zoom.
3. Use VoiceOver to add/select a Compose cell and adjust its clip-window slider. Verify modal focus and focus return.
4. Rotate with ratio/crop/export surfaces open. Check both lateral safe areas, home-indicator clearance, and 44px hit regions.
5. Save one frame, nine marked frames, and a Compose image. Cancel the share sheet; retry after slow encoding; verify dimensions and metadata. Web success means Shared, not a confirmed Photos write.
6. Install version A, deploy B, reopen/resume idle: verify one automatic reload to B. Repeat with a video open, an export in progress, and a second app page suspended: no edits should disappear.
7. Close the active session, allow the update, then reopen in Airplane Mode. Verify both editors work from the installed shell.
8. Keep a preview and production page open in the same browser storage partition. Upgrading production must not delete the preview cache.

The regression suite checks geometry, export safeguards, gesture semantics, release integrity, and update coordination with controlled substitutes. `tests/pwa-browser.cjs` adds real browser lifecycle coverage when Playwright and Chrome are available. Desktop tests do not establish physical-iPhone behavior.
