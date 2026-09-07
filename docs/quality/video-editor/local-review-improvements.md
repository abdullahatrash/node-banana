# Local review improvements — 2026-09-07

The follow-up on PR #219 adds visible trim handles, split-at-playhead and selected-section deletion, three Arabic typefaces, and a viewport-fitting editor. It also fixes the CI localization failure by moving editor labels into the authored English/Arabic catalogs; the gate is unchanged.

- Splitting and deleting are separate undo steps. Main deletion closes the same timeline interval in dependent video/audio layers; deletion within another track closes its own gap. Retained sections continue to reference the original Workspace asset.
- A section selector and numeric trim fields complement pointer handles and keyboard adjustment, including sections too short to select accurately with a pointer.
- Noto Sans Arabic, Cairo, and Noto Naskh Arabic are local fonts used by preview, inline editing, persistence, and export. Existing drafts keep the original typeface.
- The preview measures the available space, with the timeline kept in the viewport. Panels scroll independently and become overlays on narrow/short screens. Short landscape layouts place preview and timeline beside each other. Fit, panel visibility, and browser fullscreen controls are available.

## Validation

- Full suite: **662 files / 3,990 tests passed**, 18 tests skipped. Subsequent focused checks after review corrections: **17 tests passed**, including a deterministic one-frame cut regression that fails when the old drift-only behavior is restored.
- The final production build with the editor enabled, TypeScript, targeted lint, and `pnpm i18n:check` pass. CI now runs the editor regression tests and builds with the editor flag enabled.
- Real browser workflow: split twice, delete the middle, undo/redo, keyboard and pointer trimming, playback across the cut, Arabic text with all three fonts, save/reopen, and three real MP4 exports. See [browser results](editing-results.json).
- Eight viewport sizes pass: 1440×900, 1280×720, 1024×600, 390×844, 360×640, 844×390, 1024×400, and 1280×400. Preview and timeline do not overlap or require page scrolling. Panels are independently scrollable.
- Independent FFmpeg inspection confirms seven-second H.264 1080×1920 output; source frames before and after the removed interval; all four audio tones before/after the cut; and distinct text rendering for the three typefaces. See [decoded artifact inspection](cut-inspection.json).

## Standards

The follow-up review identified small-cut preview synchronization and short desktop-window sizing problems. Both were corrected and independently rechecked. No unresolved actionable finding remained.

## Spec

The follow-up review additionally identified normalization of deleted audio source gaps. Audio preparation now processes retained sections separately, bounded by their selected duration, with matching timeline/source offsets. All three findings were corrected and independently rechecked.

These checks use the real editor and workers with the existing synthetic local Workspace harness. They do not replace real authenticated storage deployment checks or ordinary-laptop and multi-hour performance qualification. The previously deferred AAC/MP3 timing limitations remain unchanged. The PR remains a draft and is not merged.
