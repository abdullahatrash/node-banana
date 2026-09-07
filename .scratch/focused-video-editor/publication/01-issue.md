## What to build

An authenticated creator opens an existing Workspace video in the built-in editor, trims it, previews it on a portrait canvas, saves and reopens the Content Piece, and exports a playable 1080p file.

## Acceptance criteria

- [ ] Reuse the existing authentication, onboarding, locale, and Workspace ownership boundaries; expose the built-in editor through a controlled development entry without silently deciding production rollout.
- [ ] Use the approved desktop layout for the initial main-video controls: central preview, media panel, contextual properties, and a simple timeline with play/pause, scrubbing, time readout, and thumbnails.
- [ ] Support one main video with a fixed 9:16 canvas, basic non-destructive trim, and a maximum 60-second finished duration; validation is consistent in preview, persistence, and export.
- [ ] Prefactor only the reusable prototype composition/export boundary needed for this path before extending it. Keep a serializable composition and one export operation with progress, cancellation, result, and error; avoid a separate horizontal refactor project.
- [ ] Persist media references and trim settings using existing Content Piece Draft/revision semantics. Autosave and explicit save states are honest; reopening restores the selected media and composition.
- [ ] Use the measured browser worker as the development export candidate, preserving bounded decoding/output and the isolated compatible media dependency. Do not provision rendering infrastructure or claim final export architecture is decided.
- [ ] Extend the primary browser workflow test to select a Workspace video, trim, save/reopen, and export; inspect actual portrait dimensions, duration, retained source audio, and playable output. Known AAC timing remains documented rather than manually compensated.

## Blocked by

None (can start immediately).
