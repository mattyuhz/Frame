# Marked-frame workflow explorations

This is an isolated prototype for comparing three real-video workflows. Pick
**Marks drawer**, **Filmstrip**, or **Review pass** from the Workflow preview
menu. Switching workflows keeps the current video's marks and save selection.
Opening a different video starts a new collection. Marks are held in this tab;
they are not saved across reloads.

The three workflows share the same source frames, crop, rotation, and verified
export path. Marks identify moments in the source video; they do not hold
independent crop settings. Nothing uploads the video or contacts an outside
service. The workflow picker exists for this prototype.

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
5. Switch between all three workflows. Marks and selected keepers should remain.
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
using the same Playwright/Chrome environment variables as `scenes-browser.cjs`.
