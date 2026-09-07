# 09: Verify the approved editor workflow and performance

**What to build:** A creator completes the approved Arabic-first editing flow from media selection through save/reopen and export, with measured responsiveness and explicit remaining rollout limits.

**Blocked by:** 07: Undo edits and recover interrupted saves; 08: Recover cleanly from export cancellation and failure.

**Status:** ready-for-agent

- [ ] Exercise the integrated approved layout with four clearly named timeline rows, central portrait preview, collage presets, contextual properties, save state, undo/redo, and one export action. Correct integration gaps in that user journey.
- [ ] Verify Arabic/RTL and existing English/LTR behavior, keyboard reachability, and readable controls. Keep test diagnostics and implementation details out of the product flow.
- [ ] Run the user-confirmed end-to-end boundary: upload/select both videos and audio, edit layout and multiline Arabic text, change audio/timing, save/reopen, export, and inspect the real artifact.
- [ ] Measure cold/warm opening, editing and scrubbing, all three 60-second layouts, export including preparation, cancellation, long sessions, and total browser/native memory using representative media.
- [ ] Record exact hardware, browser, dependency version, and results. Qualify an ordinary laptop when an agreed target is available; otherwise explicitly report that gate as incomplete rather than treating the M1 Max or CPU throttling as equivalent.
- [ ] Deliver an evidence-backed readiness report and fix regressions found in this integrated flow. Numeric production budgets, deployment architecture, subscription limits, and unresolved framing/audio policies remain explicit decisions; this ticket does not authorize launch or infrastructure purchase.
- [ ] Retain the deferred AAC/MP3 timing findings and prevent user-facing instructions that ask creators to compensate for pipeline offsets manually.
