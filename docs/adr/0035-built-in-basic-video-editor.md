---
status: accepted
---

# Build a focused video editor inside Tasmeemai

Tasmeemai will build its own basic Video Editor inside the existing application instead of delegating `/editor` to OpenCut through a separately deployed microfrontend. The confirmed scope is trimming, splitting, and arranging clips; social aspect sizes; Arabic and English text; automatic subtitles; music or voiceover; and export. Ease of use and performance take priority over expanding into a full production suite, accepting ownership of a smaller editing implementation instead of adopting OpenCut's broader editor.

This supersedes the architectural direction in the March 27 OpenCut integration design and implementation plan. Existing OpenCut routing remains in the code until replacement is implemented; this decision does not claim that migration or performance validation is complete.

The initial editing experience targets ordinary laptops, with at most 10 clips, a finished duration of 3 minutes, and 1080p export. These are agreed product limits to benchmark, not measured capacity claims. Equally capable phone editing is outside the initial target. Performance is a release requirement, covering opening speed, trimming and scrubbing responsiveness, preview playback, memory use, and an interface that remains usable during export.

The reference laptop and browser, input-media limits, numeric performance budgets, subtitle behavior, preview and export execution, persistence, and migration details remain open for the design interview. Integrating the editor into the application alone is not evidence of faster playback or export. This decision changes the video-editor direction only; other product parity commitments are unaffected.
