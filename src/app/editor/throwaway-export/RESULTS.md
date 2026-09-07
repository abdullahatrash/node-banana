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
- **Unresolved correctness gap:** video duration is exactly 60.000 seconds, but AAC and container duration are 60.074667 seconds (2,816 AAC packets). The installed library exposes no encoder priming/padding or MP4 edit-list control. The excess is consistent with priming plus packet rounding; the split between leading delay and trailing padding has not been established. Do not hide the gap by shortening the input or relabeling the output duration. Exact duration and A/V alignment must be resolved before release.

## Decision supported by this evidence

Continue evaluating browser export before funding a render-worker service. The measured path consumed no server rendering or AI-provider work. These observations do not establish zero operating cost: Workspace storage, transfers, application hosting, support, and future generation remain separate costs.

Production adoption remains open until we qualify representative lower-spec laptops and browser versions with real footage, handle common input audio rates such as 44.1 kHz, verify sustained memory behavior and interactive preview/scrubbing, and resolve AAC duration/alignment. No production performance threshold or export architecture was accepted by this experiment.
