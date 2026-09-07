# Browser export observations — September 7, 2026

## Environment

Apple M1 Max, 10 logical CPUs, 32 GiB RAM; headed Google Chrome 152, with video encode/decode and GPU acceleration reported enabled; Mediabunny 1.31.0. This is a capable development laptop, not the ordinary-laptop release baseline. No CPU throttling was presented as equivalent to another physical device.

Input files total 109,270,035 bytes, loaded from the loopback server into browser File objects before export. The approximately 0.20-second fixture-load time does not represent an internet upload, workspace download, or cold application startup. Preview was paused during export; the harness clicked the UI while the worker ran.

## Full 60-second exports

| Layout | Export time | Output size | Main frame gap p95 | Click-to-next-frame p95 | Long tasks |
|---|---:|---:|---:|---:|---:|
| Stacked, after cancellation check | 5.174 s | 45.93 MB | 17.5 ms | 15.2 ms | 0 |
| Overlay | 5.078 s | 45.95 MB | 17.2 ms | 15.0 ms | 0 |
| Side by side | 5.183 s | 45.99 MB | 17.3 ms | 15.1 ms | 0 |

Each full run includes 1,800 video frames and four mixed audio sources. Each sampled six click interactions; these small samples are not sufficient to establish a production latency percentile. The largest observed main-frame gap in these runs was 17.7 ms. The separate five-second warm-up run had a 300.2 ms frame gap, despite no recorded long task; startup/display scheduling therefore needs separate investigation before claiming consistently smooth startup.

The sum of browser-session process RSS peaked at approximately 1.28–1.36 GiB in the full runs. This includes browser baseline, source files, decoder/encoder state, GPU processes, and shared pages counted by RSS. It is not editor-only private memory. Sampling every roughly 0.75 seconds can miss shorter peaks. Main-page JS heap was only around 3 MB and must not be used as a substitute for total memory; worker heap measurement was unavailable. Some later baselines already include previous playback/download allocations, so per-run subtraction does not prove memory release or a leak. Long-session memory stability is unqualified.

Cancellation completed in 68 ms in one observed run, leaving no temporary output in that browser context. A new full export then succeeded. This is one observation, not a cancellation SLA.

## Output inspection

- FFprobe confirms H.264 1080×1920 at 30 fps, 1,800 video frames, and stereo 48 kHz AAC for all layouts.
- Frame extraction and visual inspection confirmed connected Arabic text, both videos in the overlay and stacked composition, and full-frame main footage after the reaction ends. This checks one Arabic sentence, not typography or bidi qualification.
- Frequency analysis at 1, 3, 8, 15, and 25 seconds confirms the main/music tones persist, voiceover is present in its expected interior windows, and reaction audio is present during its expected interior windows. No digital clipping was observed for these fixture gains. This does not prove sample-exact onset alignment or speech quality.
- **Unresolved correctness gap:** video duration is exactly 60.000 seconds, but AAC and container duration are 60.074667 seconds (2,816 AAC packets). The installed library exposes no public encoder priming/padding or MP4 edit-list control. The subsequent five-second marker diagnostic below identifies a leading delay as well. Do not hide the gap by shortening the input or relabeling the output duration. The user subsequently accepted the measured 44 ms delay for now and deferred its correction; the timing defect remains documented, without being a current release blocker.

## Decision supported by this evidence

Continue evaluating browser export before funding a render-worker service. The measured path consumed no server rendering or AI-provider work. These observations do not establish zero operating cost: Workspace storage, transfers, application hosting, support, and future generation remain separate costs.

Production adoption remains open until we qualify representative lower-spec laptops and browser versions with real footage, handle common input formats reliably, verify sustained memory behavior and interactive preview/scrubbing. AAC timing correction is deferred by user decision. Common WAV sample rates now pass the checks below. No production performance threshold or export architecture was accepted by this experiment.

## Subsequent overlay interaction check

The preview now supports direct text editing and movement, sharing text rasterization and normalized placement with export. An isolated Chrome check edited the Arabic sentence in place, dragged it upward and right, moved it with an arrow key, and verified that dragging beyond the canvas clamps the overlay inside the frame. A five-second MP4 retained the edited sentence and chosen position, confirmed by frame extraction and visual inspection. No page errors occurred. The full 60-second performance numbers above predate this interaction change and are not a new benchmark of it.

A subsequent formatting check entered two Arabic lines directly on the preview, confirmed Enter preserves the line break and Ctrl+Enter finishes editing, and exercised left/center/right alignment, true thin versus bold font weights, text/background colors, and transparent background. Canvas pixel inspection confirmed different short-line positions for each alignment and visibly different weight coverage. A five-second export retained the two-line bold yellow text, opaque blue background, center alignment, and moved placement, confirmed by frame extraction and visual inspection. No page errors occurred; these functional checks do not replace full-length performance qualification.

## Subsequent audio preparation and timing checks

The worker now prepares incompatible input rates locally using Mediabunny 1.31.0's public Conversion API. A full 60-second stacked composition with 44.1 kHz stereo WAV music and 24 kHz mono WAV voiceover exported in 5.395 seconds, including about 279 ms of audio preparation. The run retained all 1,800 video frames and four audio sources, with 17.7 ms p95 frame gaps, 14.7 ms p95 click-to-next-frame latency across six interactions, and no recorded main-thread long tasks. Browser-session RSS peaked at 1.51 GB (1.40 GiB), with the same shared-memory and sampling caveats as the earlier measurements. This single run is not evidence of a statistically significant performance change.

The 60-second music intermediate used 23,040,044 bytes; the ten-second voiceover used 3,840,052 bytes. Preparation is capped by the portion needed for the composition; the recorded `trimLimitSeconds` is an upper limit, not the source's actual duration. No intermediate WAVs remained after export. Cancellation during preparation completed in 60 ms and during rendering in 67 ms in separate runs, leaving no temporary files; each was followed by a successful full export. These are observations, not latency guarantees. An abrupt tab/browser termination still needs a production recovery policy.

FFprobe confirms the new full export still has exactly 60 seconds of video and 60.074667 seconds of AAC/container duration. Frequency analysis at 1, 3, 8, 15, and 25 seconds confirms the expected interior-window presence of all four diagnostic tones, including the converted inputs. No mixer clipping was recorded. This does not establish perceptual speech quality or real-footage compatibility.

The portable `audio-diagnosis.mjs` removes the mixer and video pipeline as necessary causes of the timing defect: five seconds of directly encoded PCM, mixed 48 kHz WAV, and mixed/resampled 44.1 kHz WAV all place the windowed 997 Hz marker **2,112 samples (44 ms) late** in FFmpeg-decoded output. Each decodes to 243,712 frames rather than the requested 240,000, leaving another 1,600 frames (33.333 ms) after compensating for the observed delay. Correlation exceeds 0.9997 in all three checks. This localizes the defect to the tested AAC encoding/muxing/playback path; it does not establish a portable compensation constant or identify which component must change. The five-second result should not be treated as a measured leading/trailing split for every export duration or browser.

A generated 44.1 kHz MP3 plays in the browser preview but fails import in the worker. Its first two MPEG frame headers use channel modes 0 and 1 at the same sample rate; the installed detector rejects differing modes. The failure also occurs before any conversion in a direct library input probe. It remains an input-compatibility gap, not a sample-rate-conversion failure. The diagnostic preserves a reproducible MP3 case; no dependency patch, upgrade, full-file native decoding fallback, or source-file mutation was introduced.

Raw follow-up evidence is in [audio-measurements.json](./audio-measurements.json). Related upstream AAC reports remain separate evidence, not proof of a fix: [issue 444](https://github.com/Vanilagy/mediabunny/issues/444) and [issue 447](https://github.com/Vanilagy/mediabunny/issues/447). Browser export remains a prototype pending these correctness and compatibility checks.
