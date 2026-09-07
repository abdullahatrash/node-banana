# Proposed Video Editor tickets

Drafts pending user approval of granularity, blocking edges, and public publication. No GitHub issues have been created. The ready-for-agent status is the intended publication label, not a claim that blockers are complete.

Source: the agreed local Video Editor spec. There is no published parent issue.

- [01: Open, save, and export a main video](issues/01-main-video-edit-save-export.md) — blocked by none
- [02: Upload and recover Workspace media](issues/02-upload-workspace-media.md) — blocked by 01
- [03: Compose and time a Secondary Video](issues/03-secondary-video-stack.md) — blocked by 01
- [04: Switch between all three collage layouts](issues/04-collage-presets.md) — blocked by 03
- [05: Edit and style Arabic text on the video](issues/05-arabic-text-overlay.md) — blocked by 01
- [06: Add Music and Voiceover with independent controls](issues/06-music-voiceover-mixing.md) — blocked by 02, 03
- [07: Undo edits and recover interrupted saves](issues/07-undo-save-conflict-recovery.md) — blocked by 04, 05, 06
- [08: Recover cleanly from export cancellation and failure](issues/08-export-cancellation-recovery.md) — blocked by 06
- [09: Verify the approved editor workflow and performance](issues/09-complete-workflow-qualification.md) — blocked by 07, 08

The first ticket includes only the prefactoring needed to preserve a working edit/save/export path. Each subsequent ticket extends that end-to-end boundary. No separate schema-only, API-only, or UI-only tickets.
