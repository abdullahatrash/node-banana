# Live timeline interaction — 2026-09-07

The local reviewer expected dragging on the timeline to change the displayed video. Previously the vertical playhead was only an indicator, empty tracks sought only on pointer-down, clip bodies only selected a track, and Main edge edits reset the preview to zero.

The ruler/green grip and Main clip now scrub continuously. Secondary, Music, and Voiceover bodies move their source track (retained sections move together); edges trim and show the edited boundary. Keyboard arrows offer frame steps, Shift offers second steps, and a pointer gesture is one undo step. Playback time stays local to Preview, with an imperative timeline indicator; scrubbing does not change or autosave the composition.

## Browser demonstration

Used the actual editor UI in the Codex browser against the existing synthetic Workspace harness at port 3048. The reviewer's open draft had unsaved edits and was left untouched. A separate saved draft named `Timeline drag demo` uses a 20-second Main and a four-second Secondary:

1. Drag Secondary's right edge from 15 to four seconds: preview advances to 3.9667 seconds (last retained frame).
2. Drag its body from start zero to start eight seconds: timeline block moves; preview follows the pointer to ten seconds.
3. Drag the green grip back to two seconds: only Main is displayed.
4. Drag it to nine seconds: Main source time is nine, Secondary source time is one; both video elements have readyState 4 and the stacked composition is displayed.
5. Undo restores the entire move to start zero; Redo restores start eight. Save/reopen retains the composition.

Media are moving synthetic test patterns, not representative camera-footage performance qualification. This pass changes preview interaction; previous real-MP4 export inspection remains documented in `local-review-improvements.md`.

## Regression coverage

`pnpm test:run src/components/video-editor/Timeline.test.tsx` initially failed both scrub and clip-move assertions. The final six tests use Preview and the real draft hook, including its equality guard. They cover continuous scrubbing/Secondary visibility, moving the clip with preview following, pointer trim boundaries, keyboard scrubbing/release, clamped trim followed by an unrelated edit, and keyboard trim boundaries. The last two caught review findings before the corrections.

`useEditorDraft.test.ts` also verifies one undo across a three-second pause within a drag, then a separate undo for the next drag.

Full repository suite: 665 files / 3,996 tests passed, 18 tests skipped. The final review added two regressions and reran all 16 component tests successfully. TypeScript, targeted editor lint, localization catalog checks, and the production build with the editor flag enabled passed. Standards and Spec reviewers rechecked both corrections and found no remaining actionable issues.
