# Frame — video frame extractor (+ Compose, the stories composer)

A pair of single-file web apps. **Frame** scrubs video frame-by-frame and exports full-resolution stills with metadata. **Compose** lays out photos and videos in 9:16 grids and exports Instagram-story-ready files. Built for one person (M) working with 4K phone footage (Blackmagic Cam, iPhone 17 Pro Max), shared with at most a friend. Runs on iPhone Safari from GitHub Pages, installable to the Home Screen, fully offline after first load.

**The core problem Frame solves:** "I have a video with 400 frames — how do I choose the best one as a still, across tens or hundreds of videos, fast?" Every feature exists to serve gather → inspect → choose. Anything that doesn't serve that pipeline is bloat and has historically been removed.

**The core problem Compose solves:** "Composing a multi-image/video story grid (2-up, 3-up, 2×2) at the exact resolution and bitrate Instagram wants is needlessly hard, and naive uploads get crushed." It produces the ideal input file for IG's re-encode: exactly 1080×1920, clean SDR, H.264 at high bitrate.

## Files

- `index.html` (~105 KB) — Frame: markup, CSS, and one IIFE of dependency-free ES5-ish JS. No build step, no bundler, nothing external.
- `compose.html` — Compose: same discipline (single file, one IIFE, zero network, same CSP and design tokens). Linked from Frame's header and back.
- `sw.js` (~1.5 KB) — offline shell for both pages. Cache-first with background refresh; same-origin GET only. Bump the `CACHE` version on breaking changes.
- Deployed on GitHub Pages (mattyuhz.github.io). All files must ship together.
- `COLLABORATION.md` / `AGENTS.md` — multi-assistant working rules; see Collaboration below.

## Collaboration (since 2026-08)

Two assistants work in this repo: Claude (primary engineer) and OpenAI's Codex (reviewer / tester / documenter; its instruction file is `AGENTS.md`). The shared rules — roles, branch discipline, one pen per file, handoff format, review protocol, pre-PR verification ritual — live in `COLLABORATION.md`; read it before starting any task. The short version: fetch `origin/main` first and check open branches/PRs for what Codex is doing; work on a `claude/<topic>` branch; never push `main`; behaviour changes get cross-review; only M merges, and a merge to `main` is a production deploy (GitHub Pages publishes it directly).

## Non-negotiable constraints (the user set these; do not relax them)

1. **Zero network capability in the page.** CSP meta enforces `default-src 'none'; connect-src 'none'` etc. The only `fetch` in the project lives in `sw.js` behind a same-origin guard. The acceptance test is literal: **everything must work in Airplane Mode.** No CDN, no webfonts, no analytics, no external scripts — ever. Open-source is fine as *reference or dev tooling*, never as shipped dependency.
2. **Video never leaves the device.** Read via `URL.createObjectURL`, drawn to canvas, exported locally. Any future online feature must be opt-in with explicit egress, but none exist today.
3. **Simplicity over capability.** The user has explicitly asked twice to cut features. When in doubt, propose removal, not addition. Ask before adding controls.
4. **Never lie about quality.** Exports are re-decoded and their true pixel size verified against the source before claiming success (see `verifyImage`). Never ship a confident message the code didn't check.

## Security audit ritual (run after every change)

```bash
for f in index.html compose.html; do
  echo "== $f"
  grep -c 'https\?://' "$f"                                             # 0
  grep -nE 'fetch\(|XMLHttpRequest|WebSocket|new Worker|@import' "$f"   # no output
  grep -nE '\beval\(|new Function|innerHTML|document\.write' "$f"       # no output
  grep -c "connect-src 'none'" "$f"                                     # 1
done
```

(`sw.js` is the only file allowed to contain `fetch`, behind its same-origin guard. The runnable pre-PR version of this ritual, plus syntax and ID checks, lives in `COLLABORATION.md`.)

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
- **iOS hard lesson (two on-device tests):** iOS presents no frames from a video element that is detached *or* effectively invisible — a canvas drawn from one is black. A 2 px hidden "vault" holder was tried and also failed. The architecture that works: **the preview is the real media elements** — `#board` lays the actual `<video>`/`<img>` elements out in the story grid via absolutely-positioned `.cellbox` divs and explicit width/height + translate (`applyCellTransform`, same math as export's `drawInto`); canvas is used only at export, capturing the then-visible elements. Corollaries: resize must update geometry in place (`layoutBoard`) — a rebuild re-parents playing videos and makes every cell hiccup (iOS Safari fires resize on every toolbar collapse); a re-attached paused video needs a seek nudge to present a frame. Preview has a global Play/Pause (all cells stay in story-sync); a cell holds still while its window strip is being scrubbed so the chosen start frame is visible; the grid pauses behind the result sheet so it doesn't compete with the exported video for decoders.
- **Export lockdown:** the recording reads the live cells for its whole realtime duration, so every input (board gestures, window strips, layout pills, Replace/Remove, Play/Pause, duration slider, file input) is gated off while `state.exporting` — a stray tap would corrupt the take in ways dimension/duration verification cannot catch. If the page hides mid-recording (screen lock, app switch), the attempt aborts with an honest message instead of burning the format ladder on wrecked takes. **No early abort on missing recorder chunks** — Safari can hold all bytes until `stop()` even with a timeslice, so silence ≠ dead encoder; dead attempts are caught by verification (the recorder ladder is verify-driven: format × bitrate configs are tried until one re-decodes at 1080×1920 and the right length).
- **The NaN class of bug (found by pixel-level verification, 2026-08):** `clampView` ran on a cell before its media reported an intrinsic size, divided by a zero width, and wrote **NaN** into `view.cx/cy` — permanently, since every later clamp of NaN is NaN. NaN is silent in both places it landed: a CSS `translate(NaNpx)` is dropped (so the *preview looked correct*) and `drawImage` with non-finite arguments draws nothing without throwing (so the *export was black*). Symptom was "one panel rendered, the other black", timing-dependent on which clip's metadata arrived late. Lessons kept in code: `clampView` bails until `ready && w>0 && h>0` and re-seeds non-finite values; `drawInto`/`applyCellTransform` fall back to a centred full-frame draw if any computed value is non-finite; `clampView` also indexes rects by the cell's *own* index (it used `state.selected`, wrong for any non-selected cell).
- **Export verification reads pixels, not just headers.** Dimensions and duration cannot see a black panel — a 3 KB all-black MP4 passed both and printed "ready for a story". Recording now samples per-cell brightness from the export canvas mid-take (`cellLuma`) and again from a decoded frame of the finished file; a panel that went in lit and came out black fails the candidate. Also caught: sources that never started (`xMoved`), reported separately as a decoder shortage. **The test harness must check pixels too** — every earlier green run verified only size and length while the file was entirely black.
- **Playback keeper (third on-device round):** preview looping lives in `tickVideos`, throttled to ~8 Hz (the window canvas redraws at ~15 Hz) — at 60 Hz the bookkeeping alone stole time from the 4K decoders and the whole page felt laggy. Three rules learned the hard way: never touch an element mid-`seeking` (a `play()` issued during a seek is silently dropped, which is how looping died); after wrapping, seek on one pass and `play()` on the next; and run a **stall watchdog** — iOS leaves a stalled element `paused===false` with a frozen clock (loading a second 4K clip is enough to trigger it, which is why "the first video stopped"), so if `currentTime` hasn't moved in 1.4 s, re-seek and re-play.
- **Window strip semantics:** tap jumps the window there, then drag fine-tunes (matching Frame's scrubber — drag-only felt broken). The clip that *sets* the story length has nothing to choose, so its strip is visibly dimmed and says so rather than silently ignoring drags. The drag is tracked on `document` with both pointer *and* touch handlers rather than `setPointerCapture` on the canvas — the fine tiers ask the finger to leave the strip, and capture cannot be trusted to follow it on iOS. Strip and transport are 56 px tall, over the 44 px tap-target minimum.
- **Seamless grid.** Cells tile the frame exactly — no gap, every edge on a whole pixel (`rectsFor` walks integer boundaries) so neighbours meet with no line between them. The 4 px hairline gap was cut on request: panels should read as stitched.
- **Starting a take (measured, 2026-08):** `play()` only *asks* for playback, and `currentTime` starts moving *before* the decoder presents a new picture — gating on the clock still recorded a frozen head. The recorder now starts only after **`requestVideoFrameCallback` reports real presented frames on every clip**, following a warm-up pass (play → wait for frames → seek all back to their window start → play → wait again), and one composed frame is drawn before `rec.start()` so the file can't open blank. Measured on the shipped bytes by sampling the exported file's frames during playback (seeking a short test file lands on whatever frame is decodable and lies): head freeze ~0.2 s → ~2 frames, inter-panel skew 15.3 px → **1.9 px average** (under half a frame).
- **Export draw rate is capped at ~30 fps.** Two 4K sources scaled into 1080×1920 every animation frame is more than the phone can do — attempting 60 is what dragged the *real* rate down to ~10. 30 is the story frame rate anyway.
- **One file per tap.** The file input is deliberately not `multiple`: a cell is chosen first, so multi-select only raised the question of where the extras land.
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
