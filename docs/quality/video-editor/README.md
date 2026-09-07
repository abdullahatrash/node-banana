# Focused video editor — local readiness, 2026-09-07

The nine-ticket implementation is ready for local review in one unmerged PR. This is a development validation report, not production launch approval.

## Evidence

- Root suite before review fixes: **661 test files passed**, 9 skipped; **3,983 tests passed**, 18 skipped. Run: `pnpm test:run --maxWorkers=2`.
- After review fixes, 14 targeted editor/API/route regression tests passed, including normalized titles, canonical draft URLs, and conflict-reload undo with different media. Lazy thumbnails are decoded in a worker with one request at a time and a bounded cache.
- Lint: zero errors; 161 existing repository warnings. Targeted editor lint is clean.
- TypeScript passed. A production build with `NEXT_PUBLIC_VIDEO_EDITOR_ENABLED=true` passed using disposable local build configuration. No shared database was used; a successful build is not a live database/storage integration test.
- Browser: Chrome **152.0.7977.76**, Apple **M1 Max**, 10 CPU cores, 32 GiB RAM. Media library: isolated **mediabunny-editor 1.55.7**; existing app media consumers retain their prior version.
- Real production UI and workers, synthetic Workspace service: upload two videos; select MP3 music and 24 kHz WAV voiceover; trim/time; edit multiline mixed Arabic/English text inline and in properties; drag and move by keyboard; style; save/reopen; undo/redo; export all layouts. Production authorization/upload/quota tests are reused separately.
- Unsupported-browser, injected browser quota failure, cancel/retry, and orphan cleanup passed. One live download attempt remained in OPFS; superseded and cancelled attempts were removed. No Workspace media deletion or server render fallback occurs.
- WAV 48/44.1 kHz and CBR/VBR/mono/untagged MP3 import/export passed. Malformed audio preserves the composition. Mute output has negligible music-band energy. The repeated-edit scenario made 100 gain/scrub edits and checked undo/redo and Arabic RTL.
- A three-minute soak completed **194 edit/export cycles** with no page errors. Every sample contained exactly one current export directory; replaced exports were removed. Browser-process RSS started at 1,168,432 KiB, peaked at 1,441,216 KiB, and ended at 1,280,288 KiB. The trace includes memory reclamation; this short run does not establish a long-term memory bound. See [soak results](soak-results.json).
- Separate Standards and Spec reviews were completed, and their save/recovery/thumbnail findings were fixed. See [review results](review.md).

## Measurements and artifact inspection

| Measure | Observed |
| --- | --- |
| Cold/warm fixture opening | 149 / 53 ms |
| 60-second stacked export | 5,836 ms |
| 60-second picture-in-picture export | 5,837 ms |
| 60-second side-by-side export | 6,340 ms |
| 50 ms timer-delay probe | p95 1.3 ms, maximum 16 ms, 377 samples |
| Sampled browser-process RSS sum | peak 1,726,112 KiB; 86 samples |
| Video track | H.264, 1080×1920, 30 fps, 1,800 frames, 60.000 seconds |
| AAC audio/container padding | audio track 60.074667 seconds |

Exports include input preparation. Memory is sampled from Chrome's reported browser/renderer/GPU process IDs with OS `ps` RSS, rather than page JavaScript heap alone. RSS sums can double-count shared pages and are not unique physical memory/PSS or complete device-memory accounting. The responsiveness probe measures event-loop scheduling, not a guaranteed interaction latency SLA.

Independent FFmpeg frame references passed during the Secondary video and afterward for every preset. Decoded tone windows confirm Main/Secondary/Music/Voiceover timing and gain. See the adjacent JSON files for measured results and the [reproducible harness](../../../scripts/video-editor/README.md).

## Deferred timing and rollout decisions

A 5 ms RMS onset diagnostic estimates approximately **43.5 ms** delay for direct/resampled WAV and **68.6 ms** for these MP3 fixtures. WAV normalization adds no observed shift; MP3 adds about 25 ms of source padding. These agree with the earlier deferred AAC/MP3 findings. There is no manual offset-compensation control and no claim of sample-exact timing.

An ordinary laptop target and numeric performance budgets remain **unqualified**. Synthetic M1 Max measurements and brief repeated-edit sessions are not a substitute for ordinary-laptop or multi-hour endurance qualification. Production deployment architecture, browser support qualification, subscription storage allowances/retention, and final crop/audio policy remain separate decisions.

The built-in route is enabled in local development and behind `NEXT_PUBLIC_VIDEO_EDITOR_ENABLED=true` for production builds. Existing Workspace storage quotas apply; no plan numbers, per-editor VMs, cloud renderer fleet, or paid audio generation integration was introduced. Before rollout, verify the real database/object-storage flow and deployment routing in the intended environment. Merge and rollout remain the user's decision.
