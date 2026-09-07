---
status: accepted
---

# Build a focused video editor inside Tasmeemai

Tasmeemai will build its own focused Video Editor inside the existing application instead of delegating `/editor` to OpenCut through a separately deployed microfrontend. The concrete use case is combining a generated AI influencer reaction with the creator's phone screen recording or camera footage. Ease of use, performance, and operating cost take priority over expanding into a full production suite, accepting ownership of a smaller editing implementation instead of adopting OpenCut's broader editor.

This supersedes the architectural direction in the March 27 OpenCut integration design and implementation plan. Existing OpenCut routing remains in the code until replacement is implemented; this decision does not claim that migration or performance validation is complete.

The app's video output is exclusively 9:16 short form; 16:9 landscape output is outside the product direction. The editor combines two videos using preset layouts: a reaction overlay, side-by-side panels, and stacked top-and-bottom panels. The creator selects when the reaction starts; it plays once and disappears when it finishes while the main footage continues. Reactions usually last 5–10 seconds and at most 15 seconds; this does not limit the main footage to 15 seconds.

The initial editing experience targets ordinary laptops and 1080p export. Equally capable phone editing is outside the initial target. Performance is a release requirement, covering opening speed, editing responsiveness, preview playback, memory use, and an interface that remains usable during export. No performance or cost measurements have been completed.

Workspace autosave and initial input support up to 1080p were agreed earlier. Final export execution was initially agreed as server-side background work, then reopened when operating-cost concerns prompted a first-principles review of the use case; browser versus server export remains under reconsideration. The earlier ten-clip, three-minute general-editor scope and broad feature list (including automatic subtitles and additional audio) must be reconciled with this narrower two-video workflow rather than silently carried into implementation.

Audio behavior, crop and framing controls, panel behavior after the reaction ends, main-footage limits, retained optional features, reference laptop and browser, numeric performance budgets, export execution, storage accounting, and migration details remain open for the design interview. The application-wide 9:16 decision requires a later audit of existing video formats; this documentation change does not claim their implementation has been updated. Other product parity commitments are unaffected.
