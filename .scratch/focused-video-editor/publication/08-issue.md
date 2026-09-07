## What to build

A creator can cancel preparation or rendering, handle an unsupported file/browser or interrupted attempt, and successfully export again without accumulating temporary media.

## Acceptance criteria

- [ ] Check required browser capabilities before expensive work; present an actionable unsupported-capability state instead of an infinite spinner or silent paid fallback.
- [ ] Cancel during audio preparation and video rendering, remove attempt-owned temporary files, and immediately complete a new export.
- [ ] Report the affected source on decode/preparation errors and retain the composition so the creator can replace that source and retry.
- [ ] Handle browser-storage exhaustion and stale temporary files from interrupted attempts with a bounded recovery policy that cannot delete another active attempt or Workspace asset.
- [ ] Keep media processing off the interactive thread, preserve backpressure and bounded output storage, and do not use page JS heap as a substitute for total resource measurement.
- [ ] Extend the real export workflow to cancellation, invalid-media recovery, simulated quota/capability failures, interrupted-attempt cleanup, and a successful retry. Preserve the existing timing diagnostics.

## Blocked by

- https://github.com/abdullahatrash/node-banana/issues/211
