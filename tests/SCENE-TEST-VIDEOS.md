# Scene navigation test videos

These are **original synthetic H.264 MP4s**, with no audio or external media. All fixtures and their generator are dedicated to the public domain under CC0-1.0. They are intentionally compact and have known boundaries; they are not evidence of accuracy on natural footage.

Open Frame, choose one of the files below, and follow its checks. The files can also be copied to the iPhone Files app and opened with Frame there.

## Hosted phone preview

Open [Frame scenes](https://mattyuhz.github.io/Frame/previews/scenes/) in Safari on your phone. The [hosted video library](https://mattyuhz.github.io/Frame/previews/scenes/tests/scene-preview.html) has the same eight downloads. Save a clip to Files, then choose it in Frame. Your chosen video remains on your device.

## Run the prototype locally

The prototype lives on Git branch `codex/scene-navigation-example`. From that branch's repository root, start a local server:

```sh
python3 -m http.server 8876 --bind 127.0.0.1
```

Open [Frame](http://127.0.0.1:8876/) and the [test video library](http://127.0.0.1:8876/tests/scene-preview.html). The library has previews and download links: download a clip, then choose it in Frame. Frame reads the chosen local file; it does not upload it. This loopback address is accessible only on the computer running the server, not on your iPhone.

Choose a section to give it the full scrubber width. **Whole video** returns to the full source timeline. Playback stops at the active section's end; the previous/next section buttons move between sections. Editing pauses the scene scan, and **Continue scan** resumes it. Scene suggestions remain approximate; time-based sections also cover long uninterrupted shots.

### Browser QA

With that server running, execute the dev-only browser checks from the repository root:

```sh
node tests/scenes-browser.cjs
```

The runner requires Playwright and a Chromium installation with H.264 decoding. If they are not in their default locations, set `FRAME_PLAYWRIGHT_PATH` to the installed Playwright package directory and `FRAME_CHROME` to the Chrome executable before running:

```sh
FRAME_PLAYWRIGHT_PATH=/path/to/playwright \
FRAME_CHROME=/path/to/chrome \
node tests/scenes-browser.cjs
```

`FRAME_PREVIEW_URL` optionally changes the server URL, and `FRAME_QA_OUTPUT` chooses the directory for screenshots, the exported 4K still, and the JSON results. The default output directory is `/tmp/frame-scene-qa`. The runner checks the shipped page with real video decoding, cut suggestions, section endpoints, scan interruption, source replacement, export dimensions, and mobile layout. It forces the download fallback because the native share sheet needs human interaction; encoding and export verification still run normally. Chrome results do not establish iPhone Safari behavior; run the manual checks below on the target device too.

## Video library

| Video | Duration | What to check |
| --- | --- | --- |
| [Hard cuts](fixtures/scenes/01-hard-cuts.mp4) | 16 s | Four shots; cuts at **4, 8, 12 s**. Select each section, scrub both endpoints, step ±1/±10, then return to Whole video. |
| [Long continuous shot](fixtures/scenes/02-long-continuous.mp4) | 3 min | No cuts. Sections should make navigation precise anyway; reach the last frame and verify no gaps in coverage. This is 320×180 to keep the download small. |
| [Flashes and pan](fixtures/scenes/03-flashes-and-pan.mp4) | 18 s | No cuts. A white flash at **5 s** and black flash at **11 s** should not be mistaken for lasting scene changes. |
| [Fades, black, similar colors](fixtures/scenes/04-fades-black-similar-colors.mp4) | 18 s | Fade out **4–5 s**, black **5–6 s**, fade in **6–7 s**, then a same-palette cut at **12 s**. Coarse detection may miss these; navigation must remain useful. |
| [Rapid cuts](fixtures/scenes/05-rapid-cuts.mp4) | 6 s | Nine cuts, including a **0.1 s** shot. Exercise missed-cut handling, tightly spaced boundaries, and first/last frame access. Exact edit times are in the manifest. |
| [Portrait variable frame rate](fixtures/scenes/06-portrait-variable-rate.mp4) | 12 s | 360×640, with **15 → 30 → 60 fps** intervals and cuts at **4, 8 s**. Verify portrait thumbnails and source-relative timestamps. Frame's frame numbers remain approximate for VFR. |
| [Subsecond clip](fixtures/scenes/07-subsecond.mp4) | 0.4 s | Only 12 frames. No empty sections, broken slider ranges, or endless scanning; frame saving should work. |
| [4K cut](fixtures/scenes/08-4k-cuts.mp4) | 4 s | 3840×2160, cut at **2 s**. Check source-size frame export and responsiveness. This is not a sustained 4K stress test. |

## Cross-video checks

### Observed prototype behavior

Desktop Chrome verification on November 2, 2026 found all expected cuts in the hard-cut, portrait, and 4K fixtures, and no false cuts in the continuous, flash/pan, or tiny fixtures. The long continuous clip produced six usable sections. The rapid-edit clip produced three of its nine cuts; the similar-color cut at 12 seconds was missed, while the fade-through-black produced two suggestions. These are known sampling/detector limits, not a claim of complete scene understanding. The 4K still exported and re-decoded at 3840×2160. Scan interruption, file replacement, and source endpoint checks passed. The unit regression suite has 120 passing tests.

### Manual checks

1. Start analysis, then scrub or select a section immediately. User navigation must take priority without jumping back to a scan position.
2. Replace the source while analysis is active. Results and thumbnails from the old file must not appear in the new file.
3. Hide the tab or lock the device during analysis, then return. Navigation must recover without an endless spinner.
4. Mark frames in different sections, return to Whole video, compare them, and save a marked frame. Source timestamps and exported pixels must not change when the timeline focus changes.
5. Select a section and play to its end. Playback should stop at that section's end. Move to adjacent sections, then use **Whole video** to restore the full timeline.
6. Reload after the app has been cached, enable Airplane Mode, and open a local fixture. No video upload or external service should be required.

## Real-camera checks still needed

Also test one of your own **10–20 minute 4K phone recordings**, ideally a handheld pan with exposure changes, and one **dark / HDR / variable-rate** recording. The synthetic files isolate navigation and detector failures; they do not reproduce iPhone memory pressure, HEVC/HDR decoding, stabilization, or all Safari behaviors. Include a clip with faces or fine detail to judge whether selecting a section improves actual frame picking.

## Reproduce and verify

On macOS with Swift and the Apple SDK installed, from the repository root:

```sh
swift -module-cache-path /tmp/frame-scene-swift-cache tests/generate-scene-fixtures.swift
```

The generator uses AVFoundation to encode deterministic graphics, then independently decodes **every frame** with AVAssetReader. It records dimensions, duration, frame counts, sampled nonblack pixels, file sizes, and distinct presentation-time intervals in [verification.json](fixtures/scenes/verification.json). The complete expected edit structure is in [manifest.json](fixtures/scenes/manifest.json).

Encoded bytes may differ by macOS encoder version. The intended timing and images are reproducible; no bit-identical checksum is promised.
