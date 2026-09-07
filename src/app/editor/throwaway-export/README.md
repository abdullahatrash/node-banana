# Throwaway reaction-video export experiment

Question: can a two-video, 9:16 reaction composition with Arabic text, source audio, Music, and Voiceover export in the browser without making the interface unresponsive?

This is a local performance experiment, not the production editor or a UI design proposal. It lives beside `/editor` for context but introduces no Next.js page or API route. It does not change the existing OpenCut routing. Capture branch: `feature/throwaway-reaction-export`.

## Run

Requires Node, installed project dependencies, FFmpeg on PATH, and a browser with WebCodecs, worker OffscreenCanvas/fonts, and OPFS support. Measured with Chrome 152 and Mediabunny 1.31.0.

```sh
pnpm prototype:reaction-export
```

Open <http://127.0.0.1:3047> and select **Load local test clips**, then **Measure MP4 export**. The first start generates synthetic fixtures in the OS temporary directory using FFmpeg; subsequent starts reuse them. FFmpeg generates test inputs only; browser export does not call it. To use dependencies from an existing checkout, set `PROTOTYPE_DEPENDENCY_ROOT` to that checkout's `node_modules` directory. Optional `PROTOTYPE_MEDIA_DIR` and `PROTOTYPE_PORT` override the fixture directory and loopback port.

The local server serves only an explicit allowlist of prototype files, the existing Arabic font, the installed media library, and four synthetic media files. There are no upload endpoints, provider calls, credentials, or Workspace writes. Selecting a personal file keeps it in the browser. Generated MP4s use a temporary browser-storage file, removed before the next export, on cancellation, or best-effort when leaving the page. An abrupt browser termination can leave temporary data; this is not a production cleanup policy. Draft persistence is deliberately absent.

## Measure

The UI records elapsed export time, frame count, file size, animation-frame gaps, main-thread long tasks, click-handler-to-next-frame latency, and available JS heap metrics. The worker decodes ordered source frames with two pooled canvases per input, caches the Arabic text raster, mixes audio in 1,600-frame blocks, awaits encoder backpressure, and streams MP4 output to OPFS in 1 MiB chunks. It never first trims and then re-encodes the clips a second time.

For automated measurements with Playwright and installed Google Chrome:

```sh
node src/app/editor/throwaway-export/benchmark.mjs
```

If Playwright is provided outside the project, set `PROTOTYPE_AUTOMATION_ROOT` to its containing `node_modules` directory. The harness launches an isolated headed Chrome session, exercises all three layouts at 60 seconds, clicks the interface during export, saves the MP4s and screenshots, and samples the sum of browser-session process RSS. `PROTOTYPE_CASES=stack:5` runs a smoke measurement; `PROTOTYPE_CHECK_CANCEL=1` checks cancellation before exporting. Optional `PROTOTYPE_RESULTS_DIR` selects the output directory. `PROTOTYPE_HEADLESS=1` changes the environment and must not be compared as equivalent to headed, accelerated results.

Synthetic input: 60-second 1080×1920 main video, 15-second 720×1280 reaction, 60-second music tone, and 10-second voiceover tone. Main/reaction/music/voice frequencies are 220/440/660/880 Hz. All use 48 kHz audio. Reaction starts at 5 seconds, voiceover at 2 seconds, and music at zero. These are diagnostic tones, not evidence of speech intelligibility or a perceptual audio-mixing review.

## Results and verdict

See [RESULTS.md](./RESULTS.md) and [measurements.json](./measurements.json).

Browser export is **feasible on the measured M1 Max** and worth further qualification. It is **not approved as the production export path**. No ordinary-laptop, Safari, Firefox, mobile, real-user-footage, battery, or thermal qualification was performed. Native/browser compatibility and the unresolved audio-duration gap can still change the architecture decision.

The experiment fixes center crop, 30 fps, 6 Mbps H.264, 128 kbps AAC, reaction panel disappearance followed by full-frame main video, non-looping audio, and no automatic ducking. These are prototype assumptions, not accepted product decisions. It intentionally omits source trimming UI, arbitrary sample-rate conversion, general audio recording, captions/transcription, full RTL UI localization, autosave, workspace storage integration, generation controls, and social publishing.
