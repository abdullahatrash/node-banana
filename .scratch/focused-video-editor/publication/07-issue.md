## What to build

A creator can undo and redo the completed composition controls and recover from failed or conflicting saves while preserving usable editing work.

## Acceptance criteria

- [ ] Provide the approved undo/redo controls for trims, starts, collage, text, and audio settings; restored states produce the corresponding preview and export.
- [ ] Group continuous drags, slider movements, and text edits sensibly rather than requiring one undo per rendered frame or keystroke.
- [ ] Coordinate undo/redo with autosave through the existing draft/revision contract; never silently overwrite a concurrent revision.
- [ ] Show saving, saved, and failure states accurately. Failed saves preserve local edits and permit recovery; missing media remains an actionable state.
- [ ] Extend the full browser workflow to edit, undo/redo, save/reopen, and export a restored state. Exercise failed saves and stale revisions through existing persistence boundaries.
- [ ] Do not add a new content ownership model, subscription policy, or an editor-specific authorization exception.

## Blocked by

- https://github.com/abdullahatrash/node-banana/issues/208
- https://github.com/abdullahatrash/node-banana/issues/209
- https://github.com/abdullahatrash/node-banana/issues/211
