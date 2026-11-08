# Marked-frame workflow explorations

This is an isolated prototype for comparing four real-video workflows. Pick
**Board + keeper**, **Marks drawer**, **Filmstrip**, or **Review pass** from the Workflow preview
menu. Switching workflows keeps the current video's marks and save selection.
Opening a different video starts a new collection. Marks are held in this tab;
they are not saved across reloads.

The four workflows share the same source frames, crop, rotation, and verified
export path. Marks identify moments in the source video; they do not hold
independent crop settings. Nothing uploads the video or contacts an outside
service. The workflow picker exists for this prototype.

## Phone workflow: Board + keeper

This is the default, also available directly at `#board`. It brings the visual
browsing idea from the V2 Contact Board and the explicit keeper from Candidate
Duel into the real-video preview. The V2 prototype files remain unchanged.

1. Mark interesting moments while scrubbing, then open **Marked frames**.
2. Tap a thumbnail to inspect it. Use the separate checkmark to select files for
   saving. The board already contains only marks; no marked-only filter is needed.
3. **Pin as keeper** identifies your current favorite independently of the save
   selection. Open another candidate and compare it with the keeper, or select
   exactly two frames on the board and compare those. Entering a two-frame
   comparison keeps an existing pin; A is a candidate until you choose A or B.
4. **A · Keeper** and **B · Candidate** switch the large image at the same zoom
   and pan. Pinch to inspect details. The pair's timestamps identify each side.
5. **Keep A** or **Promote B** advances through the remaining marked candidates.
   **Next** skips a decision. None of these deletes marks or changes your export
   selection. The pass stops at its end; it does not rank frames or loop forever.
6. **Undo** reverses the latest decision, including the keeper and candidate
   position. Return to the board whenever you want.
7. **Save keeper** exports the pinned frame even when B is currently displayed.
   **Save · N** on the board keeps the existing multiple-image workflow.

Check these on a phone: 0/1/2/many marks, a portrait video, zoomed comparisons,
promotion while A is displayed, Undo on the final comparison, removing a keeper
and undoing it, rapid A/B taps, cancelling the save menu, and returning to the
same scrub position. Marks and keeper state in this experimental preview are
session-only; reload clears them.

## Try each workflow

1. Open [Hard cuts](fixtures/scenes/01-hard-cuts.mp4) from the
   [test-video gallery](scene-preview.html), then mark several moments before
   and after its cuts. Marked state should be visible on the Mark button.
2. **Marks drawer:** open the collection, inspect a thumbnail, select one or
   several images, and use Compare 2 for exactly two selected frames.
3. **Filmstrip:** tap a thumbnail to revisit its source moment, then open the
   collection for selection, comparison, and saving.
4. **Review pass:** use Keep / Skip to build a save selection. Skipping does not
   delete a mark. Compare similar candidates and preserve unrelated keepers.
5. Switch between all four workflows. Marks and selected frames should remain.
6. Save one frame and several selected frames. Review should remain open, and
   the original browsing frame and section should return when you finish review.
   On browsers that support sharing image files, use the system share menu;
   other browsers download the verified images. Large native-share selections
   are prepared in batches and offer **Save next batch**. Cancelling the share
   menu must not report success or discard your marks.

## Edge cases

- No marks: no empty collection panel. One mark: inspection and save work,
  while comparison is unavailable.
- Remove the current, first, or final mark, then Undo. Check the mark and its
  prior selection return. A skipped frame remains available in the collection.
- Add more than 20 marks. Every mark must remain reachable; the old comparison
  ceiling must not silently omit later candidates.
- Use [Long continuous](fixtures/scenes/02-long-continuous.mp4), enable Sections,
  choose a section, then open and close review. Resume at the same source frame
  and section. Marks remain global to the whole video.
- Use [Portrait variable rate](fixtures/scenes/06-portrait-variable-rate.mp4)
  to check portrait layout and approximate frame timing. Use
  [4K cuts](fixtures/scenes/08-4k-cuts.mp4) to check native-resolution export.
- Rotate and crop before reviewing. The preview, thumbnails, and saved pixels
  should agree. Changing the global crop refreshes previously cached previews.
- Start loading a preview, then close review or replace the video. Stale images
  must not appear in the new source. Try quick selection changes and repeated
  save taps while a capture is in progress.
- Test narrow portrait screens, landscape, keyboard navigation, and the iPhone
  share menu. After an initial HTTPS visit, check the cached app in Airplane Mode.

The fixtures are synthetic and do not establish behavior for every phone codec
or recording. Physical iPhone checks with long HEVC/HDR footage remain part of
the staging evaluation.

## Verified staging checks

On November 8, 2026, the mobile integration passed 179 unit tests plus the new
mobile workflow, existing marks, and original scene browser suites. Fresh mobile
browser contexts at 320×568, 390×844, and 430×932 verified layout and touch-target
sizes. Tests checked independent pin/selection state, provisional two-frame
comparisons, decisions and Undo, finite progression, rendered A/B zoom and pan,
source replacement, and decoder visibility during thumbnail regeneration.
A real 900×1600 PNG contained the pinned burgundy shot while the blue challenger
was displayed, and review returned to its original source frame and section.
There were no page errors or external requests. Physical iPhone native sharing
and long HEVC/HDR footage still require on-device evaluation.

On November 2, 2026, 164 unit tests passed. Desktop Chrome decoded real files
through all three workflows, 24-mark collections, selection and Undo, paired
comparison, frame/section restoration, source replacement, and keyboard focus.
At 320 px and 390 px, the tested controls fit without overlap. Rotated previews
and two selected exports matched the 900×1600 crop, with distinct source-shot
pixels. The original eight-fixture scene suite also passed, including a
3840×2160 export. Physical iPhone sharing and long HEVC/HDR footage remain
on-device staging checks.

## Development

The shared workflow module is `prototypes/marked-frames.js`. Run
`python3 prototypes/build-marked-preview.py` after editing it; the published app
contains that code inline and loads no external script. Unit checks are
`node --test tests/*.test.cjs`; real-decoder checks are `tests/marks-browser.cjs`
and `tests/mobile-marks-browser.cjs`, using the same Playwright/Chrome environment
variables as `scenes-browser.cjs`. The mobile harness defaults to localhost:8877;
set `FRAME_PREVIEW_URL` to override it.

## Mobile refinement checks

Repeated Mark taps retain the existing mark and show “Already marked”. Remove
is explicit under More, with Undo. Zoom expands to a slider and Reset; pinch
and pan remain available on the image. Reveal overlays A on the left and B on
the right with a draggable divider (also keyboard adjustable). Both sides use
the same crop, rotation, zoom and pan; no automatic image alignment is applied.
Comparison holds a captured source image while seeking instead of dimming it.
Full-resolution source snapshots are bounded to the active comparison and held
frame; reveal is a viewing aid and does not become the exported image.

Reveal uses one keyboard-accessible slider handle directly on the visible image.
Its line is clipped to the picture bounds, including after zoom, pan and rotation.
There is no secondary bottom slider. Neither A/B button is selected in Reveal;
choosing A or B returns to single-image comparison. Toggling Reveal must preserve
the viewer geometry and surrounding controls.

## Full mobile UI audit

The November 8 audit covers upload, marking, the board, selection/filtering,
inspection, pin/unpin, Undo, zoom, Reveal/A-B, export, source replacement, the
three earlier workflow variants, and section/boundary navigation.

Additional fixes: selection retains thumbnail DOM nodes; keeper badges overlay
cards; placeholders reserve the final image aspect; inspector feedback and
action slots retain their size; transient seeks preserve disabled boundary
arrow appearance; filmstrip redraws preserve scroll; mode changes close stale
popovers; the zoom value follows gestures; concise labels avoid footer wrapping.
Sections and main viewer height changes ease over 180ms unless reduced motion
is requested. Landscape comparison puts controls beside a usable image area.

Browser checks include 320×568, 390×844, 430×932 and 844×390, animation-frame
measurements during delayed decoding, selection DOM identity, pin/zoom geometry,
keyboard and pointer Reveal operation, reduced-motion behavior, and real
900×1600 keeper exports. The earlier workflow suite and eight-fixture scene suite
also run, including a 3840×2160 export. Physical iPhone share-sheet behavior and
codec-specific performance still need on-device testing.
