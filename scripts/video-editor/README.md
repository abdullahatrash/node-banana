# Video editor local acceptance

This harness builds the **production React editor and real media workers**. The loopback service substitutes synthetic Workspace metadata, object storage, and revision persistence; it is not proof of a live authenticated database/S3 deployment. Production ownership, quota, registration, and optimistic-revision behavior are exercised by the existing app route/persistence tests. No production auth bypass or paid provider call is added.

Requirements: repository `pnpm install`, Node, Chrome, FFmpeg/FFprobe. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path (or install it in a separate test runtime). The Python inspection scripts need NumPy. `esbuild` is available through this repository's hoisted tool dependencies.

```sh
node scripts/video-editor/fixtures.mjs
node scripts/video-editor/serve.mjs
# Separate terminal; browser uses localhost:3048.
node scripts/video-editor/check.mjs
EDITOR_TEST_DURATION=60 EDITOR_TEST_OUTPUT=/tmp/editor-60 node scripts/video-editor/check.mjs
EDITOR_TEST_OUTPUT=/tmp/editor-variants node scripts/video-editor/variants.mjs
python3 scripts/video-editor/verify-output.py /tmp/editor-60/stacked.mp4
python3 scripts/video-editor/verify-frames.py /tmp/editor-60 "$EDITOR_FIXTURES"
python3 scripts/video-editor/inspect-variants.py /tmp/editor-variants
EDITOR_SOAK_SECONDS=180 node scripts/video-editor/soak.mjs
```

The fixture generator prints its default directory; supply that path as `EDITOR_FIXTURES` when inspecting frames. Set `EDITOR_TEST_OUTPUT` to preserve output MP4s, screenshots, and measurement JSON. Test service data lives under the OS temporary directory. The server binds only to loopback. Uploaded bytes are local test fixtures and are inspected with FFprobe by the fixture service; production uses its existing server inspection API.

`check.mjs` uploads two video files, edits timing and Arabic text through both surfaces, moves text, selects music and voiceover, saves/reopens, exercises undo/redo, injects browser capability/storage failure, cancels, seeds an orphan, exports all three layouts, and checks cleanup. The 60-second mode exercises a 15-second Secondary video. `variants.mjs` uploads WAV and MP3 variants, checks malformed-file recovery, mute, repeated edits, and Arabic RTL. Inspections decode actual MP4s; timing estimates remain diagnostic rather than a sample-exact promise.

Frame comparisons use BT.709, matching browser handling of the synthetic HD inputs and the output's explicit BT.709 metadata. They exclude the movable text area from the independent FFmpeg geometry reference. Text shaping/placement is additionally checked visually in exported frames and by the browser save/reopen workflow.

`editing-check.mjs` checks split/delete, pointer and keyboard trims, undo/redo, cut playback, three font exports, and eight viewport sizes. `cut-boundary-check.mjs` checks a one-frame cut during real playback. Run `python3 scripts/video-editor/verify-cuts.py "$EDITOR_TEST_OUTPUT" "$EDITOR_FIXTURES"` to independently inspect exported frames, duration, audio tones, and distinct font rendering. The deterministic `Preview.test.tsx` additionally isolates small-cut seeking from the normal 100 ms playback drift tolerance.
