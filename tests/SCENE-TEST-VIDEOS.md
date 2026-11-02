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

Every newly opened file starts with **Sections off** and the full source timeline. Turn **Sections on** to show time-based sections immediately; enabling Sections does not start scene analysis. Choose a section to give it the full scrubber width. Playback stops at the active section's end, and the previous/next buttons move between sections. **Whole video** restores the full timeline while keeping the section list available.

Choose **Find scenes** when you want automatic suggestions. Editing pauses the scan, and **Continue scan** resumes it. Turning **Sections off** stops scanning and returns to the full timeline. Turning it on again retains section results already prepared for this file without automatically resuming analysis. Opening another file resets Sections to off. Suggestions remain approximate; short shots, fades, and similar-color cuts can be missed, so time-based sections remain useful for uninterrupted footage too. Cards and navigation appear only when there are multiple ranges. For a short clip with no detected cuts, the completed panel reduces to **No scene changes found.**; the full timeline stays available. Long clips without cuts retain their useful time sections.

### Review and adjust a boundary

Select the second or any later section, then choose **Review start**. The panel shows **Before · previous section** and **After · selected section** so you can inspect both sides of the proposed start. For the hard-cut fixture, run Find scenes first to get multiple sections; the long continuous fixture already has several time sections when you enable Sections.

Use **−10 / −1 / +1 / +10** to move the boundary at the current estimated frame rate. With the review panel focused, Left/Right arrow keys move one approximate frame, and Shift-Left/Right moves ten. The boundary stays between its neighbors: applying it keeps both adjacent sections contiguous and retains all source footage. Choose **Apply boundary** to keep the adjustment, or **Cancel** / Escape to leave the boundary unchanged. The first section starts at the beginning of the source and has no start boundary to review.

After Apply boundary, the status says **Boundary adjusted** and the scan button becomes **Manual boundaries**. Further scene scanning is disabled for that file so it cannot overwrite your edits. Turning Sections off and on preserves these edits; **reopening the file resets them and allows a fresh scan**. Changes affect navigation ranges only—the video file and its pixels are unchanged. Frame steps remain approximate for variable-rate footage, and before/after review does not guarantee an exact cut or a meaningful scene boundary.

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
| [Subsecond clip](fixtures/scenes/07-subsecond.mp4) | 0.4 s | Only 12 frames. After scanning, show only No scene changes found, with no redundant section card or disabled navigation. Normal scrubbing and frame saving should work. |
| [4K cut](fixtures/scenes/08-4k-cuts.mp4) | 4 s | 3840×2160, cut at **2 s**. Check source-size frame export and responsiveness. This is not a sustained 4K stress test. |

## Cross-video checks

### Verified prototype behavior

Desktop Chrome checks on November 2, 2026 passed for Sections defaulting off, explicit scanning, cancellation, source replacement, and keeping manual boundaries across mode toggles. The boundary review decoded distinct blue/burgundy pictures at the hard-cut fixture's frames 119/120; keyboard adjustment, Cancel restoring the selected source frame, and Apply updating the shared edge also passed. Short uncut clips reduce to a brief result with no card or navigation; long uncut clips retain useful time sections. The full unit regression suite has **138 passing tests**.

All eight synthetic fixtures were exercised. The detector found all expected cuts in the hard-cut, portrait, and 4K fixtures, with no false cuts in the continuous, flash/pan, or tiny fixtures. The long clip produced six time sections. The rapid-edit clip produced three of nine cuts; the similar-color cut at 12 seconds was missed, while the fade-through-black produced two suggestions. The uncropped 4K still exported and re-decoded at 3840×2160. Browser checks found no page errors, external requests, or horizontal overflow at mobile width.

These checks cover the synthetic dataset and desktop Chrome, not real-footage detection accuracy or physical iPhone performance. Boundary review lets you inspect and adjust a suggestion; it cannot guarantee a meaningful scene boundary or exact VFR frame access.

### Manual checks

1. Open a file. Confirm **Sections is off**, the whole-video scrubber is available, and no scene scan starts. Turn Sections on: time sections should appear immediately without moving the viewer through a scan.
2. Select a time section, scrub both ends, and play to its end. Playback should stop there. Move to adjacent sections, then choose **Whole video**; the full timeline should return while the list remains available.
3. Choose **Find scenes**, then scrub or select a section immediately. User navigation must pause analysis without a later jump back to the scan position. Choose **Continue scan** to resume it deliberately.
4. Turn Sections off during a scan. Scanning must stop and the full timeline must return. Turn it on again: existing results for this file should remain, and scanning must not restart by itself.
5. Finish a scan, turn Sections off, then on. Confirm the same file's prepared sections remain available without another scan. Open another file: Sections must reset to off, with no old results or thumbnails carried over.
6. Hide the tab or lock the device during analysis, then return. Navigation must recover without an endless spinner or unwanted scan restart.
7. Mark frames in different sections, return to Whole video, compare them, and save a marked frame. Source timestamps and exported pixels must not change when the timeline focus changes.
8. Reload after the app has been cached, enable Airplane Mode, and open a local fixture. Sections and manual frame editing should work without uploading the video or contacting an external service.

### Boundary-review checks

1. Open **Hard cuts**, enable Sections, and run **Find scenes**. Select the second section and choose **Review start**. Confirm Before shows the previous section's last approximate frame and After shows the selected section's first approximate frame. The expected source cut is at 4 seconds.
2. Move the boundary with −1/+1 and −10/+10, then use Left/Right and Shift-Left/Right with the panel focused. Both previews and the time readout should update; the adjustment must stay within its neighboring sections.
3. Choose **Cancel**, then reopen Review start. The original boundary must be intact. Repeat an adjustment and press Escape to check the same cancellation behavior.
4. Adjust and choose **Apply boundary**. Confirm **Boundary adjusted** and the disabled **Manual boundaries** scan button. The previous section's end and selected section's start must meet, with no missing, duplicated, or empty navigation range. Step through both sides and verify the source pictures remain unchanged.
5. Turn Sections off and on. The edited boundary should remain. Reopen the same file: Sections should default to off, the edit should be reset, and enabling Sections should make a fresh Find scenes pass available.
6. Select the first section: its source start is fixed. On the subsecond clip, the redundant single section and boundary-review controls should be absent. Try adjusting boundaries next to short sections in **Rapid cuts**; neither neighbor should collapse to an empty range.
7. Repeat review on **Portrait variable frame rate**. Check portrait images remain readable and source times are preserved. Judge the actual pictures; approximate frame steps are not proof that every VFR source frame has been visited.
8. While previews are being prepared, switch Sections off, replace the file, or hide the tab. Old previews must not reappear or apply to a new source. Confirm the main scrubber is still usable after cancellation.

## Real-camera checks still needed

Also test one of your own **10–20 minute 4K phone recordings**, ideally a handheld pan with exposure changes, and one **dark / HDR / variable-rate** recording. The synthetic files isolate navigation and detector failures; they do not reproduce iPhone memory pressure, HEVC/HDR decoding, stabilization, or all Safari behaviors. Include a clip with faces or fine detail to judge whether selecting a section improves actual frame picking.

## Reproduce and verify

On macOS with Swift and the Apple SDK installed, from the repository root:

```sh
swift -module-cache-path /tmp/frame-scene-swift-cache tests/generate-scene-fixtures.swift
```

The generator uses AVFoundation to encode deterministic graphics, then independently decodes **every frame** with AVAssetReader. It records dimensions, duration, frame counts, sampled nonblack pixels, file sizes, and distinct presentation-time intervals in [verification.json](fixtures/scenes/verification.json). The complete expected edit structure is in [manifest.json](fixtures/scenes/manifest.json).

Encoded bytes may differ by macOS encoder version. The intended timing and images are reproducible; no bit-identical checksum is promised.
