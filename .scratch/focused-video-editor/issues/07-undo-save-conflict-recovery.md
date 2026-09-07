# 07: Undo edits and recover interrupted saves

**What to build:** A creator can undo and redo the completed composition controls and recover from failed or conflicting saves while preserving usable editing work.

**Blocked by:** 04: Switch between all three collage layouts; 05: Edit and style Arabic text on the video; 06: Add Music and Voiceover with independent controls.

**Status:** ready-for-agent

- [ ] Provide the approved undo/redo controls for trims, starts, collage, text, and audio settings; restored states produce the corresponding preview and export.
- [ ] Group continuous drags, slider movements, and text edits sensibly rather than requiring one undo per rendered frame or keystroke.
- [ ] Coordinate undo/redo with autosave through the existing draft/revision contract; never silently overwrite a concurrent revision.
- [ ] Show saving, saved, and failure states accurately. Failed saves preserve local edits and permit recovery; missing media remains an actionable state.
- [ ] Extend the full browser workflow to edit, undo/redo, save/reopen, and export a restored state. Exercise failed saves and stale revisions through existing persistence boundaries.
- [ ] Do not add a new content ownership model, subscription policy, or an editor-specific authorization exception.
