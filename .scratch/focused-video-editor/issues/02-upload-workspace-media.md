# 02: Upload and recover Workspace media

**What to build:** A creator uploads recorded video or audio through the editor, sees usable media when registration finishes, and recovers from upload, quota, or access errors without losing their composition.

**Blocked by:** 01: Open, save, and export a main video.

**Status:** ready-for-agent

- [ ] Reuse Workspace upload, media inspection, registration, delivery, and configured quota enforcement for supported video and audio; do not create an editor-specific upload bypass.
- [ ] An uploaded main video can be selected, previewed, saved/reopened, and exported through the working editor flow.
- [ ] Show upload and processing status. Do not mark unavailable media as ready or an unfinished upload as durably saved.
- [ ] Reject unsupported, incorrectly labelled, or over-limit media with actionable errors while retaining the existing composition; allow retry or replacement.
- [ ] Honor Workspace ownership, denied access, and existing quota responses. Subscription allowance numbers, storage charging, and retention remain separate decisions.
- [ ] Extend the browser workflow with successful upload and recovery; reuse existing asset-route tests for permission, invalid media, and quota failures. Audio registration is verifiable through Workspace media even before its editor layers land.
