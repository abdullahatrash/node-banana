## What to build

A creator switches a two-video composition between stacked, picture-in-picture, and side-by-side layouts and gets the same arrangement after reopening and exporting.

## Acceptance criteria

- [ ] Provide the three compact collage choices above the portrait preview, with a clear selected state.
- [ ] Picture-in-picture and side-by-side remain inside a 9:16 outer canvas; no landscape-output control is introduced.
- [ ] Layout changes preserve media selection, timing, and trims and update the preview without resetting playback unnecessarily.
- [ ] Persist the selected layout and use the same composition meaning for export; keep end-of-secondary behavior consistent across layouts.
- [ ] Extend the existing end-to-end scenario for each preset and inspect exported frames during and after the Secondary Video.

## Blocked by

- https://github.com/abdullahatrash/node-banana/issues/207
