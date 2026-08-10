# Frame — video frame extractor (+ Compose, the stories composer)

A pair of single-file web apps. **Frame** scrubs video frame-by-frame and exports full-resolution stills with metadata. **Compose** lays out photos and videos in 9:16 grids and exports Instagram-story-ready files. Built for one person (M) working with 4K phone footage (Blackmagic Cam, iPhone 17 Pro Max), shared with at most a friend. Runs on iPhone Safari from GitHub Pages, installable to the Home Screen, fully offline after first load.

**The core problem Frame solves:** "I have a video with 400 frames — how do I choose the best one as a still, across tens or hundreds of videos, fast?" Every feature exists to serve gather → inspect → choose. Anything that doesn't serve that pipeline is bloat and has historically been removed.

**The core problem Compose solves:** "Composing a multi-image/video story grid (2-up, 3-up, 2×2) at the exact resolution and bitrate Instagram wants is needlessly hard, and naive uploads get crushed." It produces the ideal input file for IG's re-encode: exactly 1080×1920, clean SDR, H.264 at high bitrate.

## Files

- `index.html` (~105 KB) — Frame: markup, CSS, and one IIFE of dependency-free ES5-ish JS. No build step, no bundler, nothing external.
- `compose.html` — Compose: same discipline (single file, one IIFE, zero network, same CSP and design tokens). Linked from Frame's header and back.
- `sw.js` (~1.5 KB) — offline shell for both pages. Cache-first with background refresh; same-origin GET only. Bump the `CACHE` version on breaking changes.
- Deployed on GitHub Pages (mattyuhz.github.io). All files must ship together.

## Non-negotiable constraints (the user set these; do not relax them)

1. **Zero network capability in the page.** CSP meta enforces `default-src 'none'; connect-src 'none'` etc. The only `fetch` in the project lives in `sw.js` behind a same-origin guard. The acceptance test is literal: **everything must work in Airplane Mode.** No CDN, no webfonts, no analytics, no external scripts — ever. Open-source is fine as *reference or dev tooling*, never as shipped dependency.
2. **Video never leaves the device.** Read via `URL.createObjectURL`, drawn to canvas, exported locally. Any future online feature must be opt-in with explicit egress, but none exist today.
3. **Simplicity over capability.** The user has explicitly asked twice to cut features. When in doubt, propose removal, not addition. Ask before adding controls.
4. **Never lie about quality.** Exports are re-decoded and their true pixel size verified against the source before claiming success (see `verifyImage`). Never ship a confident message the code didn't check.

## Security audit ritual (run after every change)

```bash
grep -c 'https\?://' index.html                    # must be 0
grep -nE 'fetch\(|XMLHttpRequest|WebSocket|new Worker|@import' index.html   # none
grep -nE '\beval\(|new Function|innerHTML|document\.write' index.html       # none
grep -c "connect-src 'none'" index.html            # must be 1
```

## Testing ritual (these caught real bugs; keep them)

1. **Syntax:** extract the `<script>` body to a temp file, `node --check`.
2. **Runtime:** boot the page in jsdom with `runScripts:'dangerously'` and error listeners; assert zero init errors and that key element IDs exist. *Syntax passing is not enough — jsdom twice caught whole modules missing after a patch script over-cut between text markers.*
3. **Logic:** regex-extract shipped functions from index.html (pattern `  function NAME\([\s\S]*?\n  }`) and `eval` them with stubbed `scan`/`state` against synthetic signals. Test the shipped bytes, not a re-typed copy.
4. **ID cross-reference:** every `$('id')` must match an `id="..."` in markup.
5. When a harness gives a surprising result, **suspect the harness first** — one test "failure" was a broken synthetic pan (content drifted off-canvas producing identical blank frames), not the algorithm.

## Architecture map (all inside the IIFE in index.html, in rough order)

- **Env detection** — restricted-frame / opaque-origin detection (`env.restricted`); shows a banner because Safari blocks video in sandboxed frames (this burned us in the claude.ai preview; error code 4 = environment, not the file).
- **MOV/MP4 metadata parser** — walks moov boxes (udta ©-atoms, keys/ilst, iTunes-style ilst, `loci` 16.16 fixed-point, ISO 6709 strings, mvhd epoch fallback). Reads only headers + moov, never the whole file.
- **EXIF writer** — builds a little-endian TIFF (IFD0 + Exif + GPS), injects as JPEG APP1 (after any JFIF APP0) or PNG `eXIf` chunk with hand-rolled CRC32. Verified round-trip with piexif and Pillow: dates, camera make/model, GPS to 4 decimals.
- **Seek state machine** (`runSeek`/`requestFrame`) — UI-leads-decode: timecode/playhead move instantly, decode catches up; pending requests coalesce. Hardened after a real stuck-scrub bug: supersession token, try/catch around `currentTime` (iOS drops the decoder under memory pressure and the assignment throws), 3 s watchdog reclaiming a stale `seeking` flag, and `recoverVideo()` (two timeout-stalls → reload the same file and return to the frame).
- **Precision scrubber** — one control. Drag along = coarse; slide finger *away* vertically = finer tiers at 44/100/180 px thresholds with factors 1/0.35/0.12/0.04, re-anchoring per tier. Wheel = single-frame step. (Replaced a separate jog strip.)
- **Hold-to-repeat transport** — ±1/±10 buttons accelerate 140→80→45 ms; pointer/click double-fire guarded by timestamp; stops on blur/visibilitychange.
- **Zoom** (main viewer) — pinch/pan on `#vframe`, double-tap toggles fit ↔ actual pixels (dpr-aware). Crop overlay lives inside the same transformed element.
- **Crop** — aspect presets as pills, rule-of-thirds grid, drag/pinch. `cropRect()` clamps so it can never escape the frame (verified across corner cases). **Never upscales.**
- **Orientation** — `Rotate` bakes 90° steps into exported pixels via canvas rotate (not an EXIF flag); `unrotate()` maps drag gestures back to source space; aspect ratios are interpreted in *output* space when rotated. `Fit to picture` detects letterbox/pillarbox bars (rows/cols ≥96% near-black at ≤45/765 luma) and sets the crop to the active picture. Key fact: a video file has ONE frame size for its whole length — mid-clip "orientation changes" are bars appearing, which is why this is a crop problem, not a split problem.
- **Scan** — plays the clip at rate 4 sampling every *presented* frame via `requestVideoFrameCallback`; a 1.5 s watchdog halves the rate if playback advances <0.35 s. Never assumes a sample rate (iOS presents far fewer frames at speed — this caused the "only 5 thumbnails" bug): thumbnails decimate adaptively (72 → thin to ≤24 evenly), and if <8 cells arrive it falls back to seeking 12 evenly spaced frames. Samples store `{t: mediaTime, diff, asp}` so fps changes don't misalign anything. Movement curve + white mark ticks render into the scrubber canvas.
- **Calmest moments** — local minima of ±2-smoothed diffs; candidate gate `med − 0.3·(med − min)` (prominence, so jitter dips can't qualify); uniform clip (`med−min < 0.15·med`) → marks nothing and says so; <8 samples → null → in-sheet message. Validated against pan-with-two-windows, gimbal-two-dips, uniform-noise, starved-data signals.
- **Shape runs** — groups samples by active-picture aspect (8% tolerance), drops runs <3 samples, merges same-shape neighbours so a one-frame glitch can't split a section. Scan header reports "the picture changes shape N times: 9:16 → 16:9 → 9:16"; `Mark each shape` drops one mark per section.
- **Compare / flipbook** — tap a thumbnail → full-native-res viewer; Prev/Next through all marks; **Pin** the champion; tap flips current vs pinned at locked zoom/pan (blink comparison). Max 3 full-res frames in memory (LRU, pinned+current protected) — this cap exists because 8 caused decoder eviction.
- **Save flow** — capture → EXIF inject → re-decode and verify true dimensions → full-screen sheet with share-to-Photos (`navigator.share`, needs https; falls back to download with an explanatory line). Batch save of marks = sequential downloads.
- **Panels** — save sheet / compare / scan are full-screen fixed. **Exactly one may be open**: `showSheet()`/`closeAllSheets()`; backgrounds fully opaque; content max-width 760 px. (Two stacking at 97% opacity produced a ghost-double-Close bug.)
- **Hotkeys** — arrows/Shift-arrows/Space/S/M still work but are dead while any panel is open (S was silently saving behind sheets); Escape closes the top panel. The on-screen shortcut legend was removed by request; the bindings remain.
- **Offline registration** — guarded (`https:` + not restricted + serviceWorker present).

## Compose (compose.html) — architecture and decisions

Decisions made with the user (2026-08):

- **Name:** Compose. Layouts v1: Full, 2 up (stacked), 3 up, 2×2. Cells hold a photo or a video; tap an empty cell to add, tap a filled cell to select (Replace / Remove, drag to pan, pinch to zoom past cover-fit; double-tap resets).
- **iOS hard lesson (first on-device test):** a `<video>` element that is not in the document presents no frames on iOS — the canvas draws black. Every loaded video is parked in `#vault`, a 2 px hidden in-DOM holder (not `display:none`, which can also stall decode). Preview has a global Play/Pause (all cells stay in story-sync); a cell holds still while its window strip is being scrubbed so the chosen start frame is visible.
- **Duration model (user-specified):** story length defaults to the shortest clip and can be overridden *shorter* (never longer — no freezing, no looping; every cell always shows real footage). Each video cell has a window scrubber to choose *which* stretch of a longer clip plays (start-anchored; pull away vertically for finer tiers, like Frame's scrubber). Hard cap 60 s (IG's story limit).
- **Export:** stills via canvas → 1080×1920 PNG/JPEG. Video via `canvas.captureStream(30)` + MediaRecorder, `videoBitsPerSecond` 12 Mbps hint — Safari records H.264 MP4; recording is realtime (a 10 s story takes 10 s). Recorder formats are tried in order (mp4 → webm) and a format that yields an *empty* recording falls through automatically — Chromium test builds claim mp4 support but have no H.264 encoder. Output is verified by re-decoding (dimensions + duration; unknown-length recordings get the seek-past-end duration probe) before any success message, same never-lie rule as Frame. **No audio in v1** — stated visibly in the result sheet.
- **Why canvas output helps IG quality:** iPhone HDR footage → canvas is tone-mapped to SDR, sidestepping Instagram's broken HDR→SDR conversion; exact 1080×1920 avoids IG's rescale pass. User playbook: IG app Settings → Media quality → "Upload at highest quality"; don't stack stickers/text in-app (each triggers a re-encode).
- **v2 candidates (not built):** WebCodecs `VideoEncoder` + hand-rolled MP4 muxer for faster-than-realtime, tightly controlled encodes (full WebCodecs shipped in Safari 26 on iOS); audio from a chosen cell; film grain as a strict A/B experiment — subtle coarse grain doubles as dither against IG's banding, but if it doesn't survive IG's re-encode looking analog, cut it.

## Audit notes (2026-08, not yet built)

- **Exact frame timing without WebCodecs:** the moov parser already walks boxes; extending it to the video trak's `stts` table gives true per-frame timestamps and exact frame counts — fixes the VFR "approximate frame numbers" limitation with no decode changes. Best effort-to-value item on the list.
- **Batch save in one gesture:** `navigator.share({files:[...]})` accepts multiple files on iOS — "Save all marked frames" could become one share sheet instead of a download cascade. Needs an on-device test.
- **Cache eviction hedge:** call `navigator.storage.persist()` at startup (Safari can evict caches after 7 days of non-use in browser-tab mode; Home Screen installs are exempt).
- WebCodecs (decode+encode, incl. audio) is fully available in Safari 26 on iOS — the roadmap's "if constraints relax" items no longer need constraints to relax.

## Design system (measured off the user's Figma frame via exported SVG)

Pure black `#000`; surfaces `rgba(255,255,255,.08)` (pressed `.14`); strokes `rgba(255,255,255,.12)`; dividers 2 px `#D9D9D9 @ 16%`; text `#FFF` / `#E3E3E3` / `#666`. Radii: rows 24 px (56 px tall), medium 16 px, chips full pill (34 px tall, outlined, 9 px gap). Rhythm: 16 px page margin and gaps. Type: system sans stack (SF Pro on Apple), sentence case, no uppercase-tracking labels; hero numerals large/light (weight 300, ~44 px, tabular). **No accent hue anywhere** — emphasis is white + opacity. This is deliberate twice over: it matches the reference *and* keeps colour from contaminating judgement of the image (grading-suite logic). Unknown: the reference's real font family (SVG had outlined text) — user may supply a name; do not load webfonts, tune the stack/tracking instead.

## Deliberately removed — do not re-add without new evidence

- **Sharpness scoring** (variance-of-Laplacian, badges, focus-spot). Removed because: whole-frame scores pick the wrong frame on rack focus (measured: 92 vs 100 for the *wrong* one); a fixed focus spot drifts off moving subjects; a number labeled "sharpest" carries authority it hasn't earned. Replacement philosophy: **objective facts and navigation aids only** (blown-highlight %, movement curve), judgement stays with the human eye at 1:1.
- **Zebras, Wide colour (P3), Diagnostics panel, shortcut legend** — user-requested cuts. Note the cost: without Diagnostics, remote debugging is weaker; load errors now print the browser's message inline. Re-add Diagnostics temporarily if debugging a device-specific failure, then remove again.
- **Jog strip** — superseded by the precision scrubber.
- Declined on principle: auto-detecting "which way is up" (confident guessing), a formal segments model (the contact sheet already shows sections), server-side anything.

## Known limitations (stated, accepted)

- **VFR clips** (Blackmagic ~29.67 fps) have approximate frame *numbers*; the saved pixels are always exactly what's displayed. True fix = WebCodecs (see roadmap).
- **8-bit ceiling** — browser canvas; matches the user's baked-LUT H.264 anyway.
- **ProRes won't open in any browser** — likely the other half of the user's footage; ffmpeg.wasm is the unlock (roadmap).
- **PNG EXIF** (eXIf chunk) may be ignored by Photos; JPEG metadata is rock solid. PNG = archive, JPEG = when date/GPS filing matters.
- Batch save uses downloads, not the Photos share sheet (iOS wants a gesture per share).
- Zebra-class checks would read post-LUT 8-bit values, if ever restored.

## Open items

1. ~~Instagram story export~~ — superseded by Compose, which owns the 1080×1920 output (a proper multi-step downscale from 4K sources lives there; keep PNG in Frame as archive).
2. Reference font family name (ask the user).
3. Figma remote MCP (`https://mcp.figma.com/mcp`) works on their free plan (6 calls/mo); desktop Dev Mode server needs a paid seat and was never reachable.
4. Roadmap, no longer gated on constraints (in order): WebCodecs + demuxer (exact VFR frames, 10× scans, controlled encodes for Compose) → ffmpeg.wasm (ProRes) → WebGPU aligned burst merge (Wronski et al. 2019) → on-device ML (eyes-open, subject tracking) → opt-in per-image Claude critique → native app (PhotoKit + AVAssetImageGenerator tolerance-zero) at archive scale.

## Working style this project expects

Direct, rigorous-mentor tone; the user wants pushback and named trade-offs, not agreement. Own mistakes plainly with root causes. Verify claims by measurement (build a harness, test the shipped bytes) before asserting. Diagnose before patching — three user bug reports in this project each had multiple stacked causes, and the visible symptom was never the whole story. Feedback must be *visible*: a message printed behind a modal is indistinguishable from a bug. All recipes/measurements in grams and metric where relevant.
