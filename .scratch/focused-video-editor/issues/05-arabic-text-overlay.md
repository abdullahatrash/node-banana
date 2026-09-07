# 05: Edit and style Arabic text on the video

**What to build:** A creator writes, moves, and formats Arabic text directly on the portrait preview, then reopens and exports the same overlay.

**Blocked by:** 01: Open, save, and export a main video.

**Status:** ready-for-agent

- [ ] Support direct selection, drag movement bounded to the canvas, keyboard repositioning, and a synchronized properties textarea.
- [ ] Preserve typed and pasted newlines; Enter inserts a line break and Ctrl/Cmd+Enter finishes inline editing.
- [ ] Support left/center/right alignment, thin/light/regular/bold weights, font size, text color, background color, and opacity including transparency, applied to the whole overlay.
- [ ] Preserve connected Arabic shaping, mixed-direction text, explicit line breaks, wrapping, and placement through one shared layout meaning for preview and export.
- [ ] Save/reopen restores overlay content, style, and position. Use the approved contextual properties panel and existing Arabic/English locale behavior.
- [ ] Extend the main-video workflow to edit through both surfaces, move with pointer and keyboard, save/reopen, and inspect actual exported frames. No automatic subtitles or per-word rich-text system.
