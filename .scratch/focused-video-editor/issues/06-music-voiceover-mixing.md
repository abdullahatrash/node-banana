# 06: Add Music and Voiceover with independent controls

**What to build:** A creator adds uploaded or existing Workspace music and narration, positions them in time, balances all four audio sources, then saves and exports the mix.

**Blocked by:** 02: Upload and recover Workspace media; 03: Compose and time a Secondary Video.

**Status:** ready-for-agent

- [ ] Provide distinct Music and Voiceover sections and timeline rows, independently timed from each other and from Main and Secondary Video source audio.
- [ ] Each source has understandable volume/mute controls; persist timing and gain with the composition and retain them after reopening.
- [ ] Accept the tested MP3 and WAV variants using the verified upstream compatibility fix. Normalize only the needed portion of incompatible audio in the worker; compatible inputs skip preparation.
- [ ] Expose preparation/progress and actionable input errors without requiring users to convert files themselves or calling server audio processing.
- [ ] Reserve a provider-neutral future-generation affordance in each audio section, clearly unavailable; no Suno/ElevenLabs integration, generation calls, microphone capture, automatic ducking, or looping.
- [ ] Extend the browser workflow through upload/selection, timing and gain changes, save/reopen, and actual export. Inspect independent source tones, mute behavior, WAV rates, MP3 variants, malformed-file rejection, and temporary-file cleanup.
- [ ] Keep AAC delay and MP3 padding visible in diagnostic results. Do not introduce a manual offset-compensation workflow or claim exact timing has been fixed.
