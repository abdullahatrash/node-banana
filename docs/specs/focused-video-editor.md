## Problem Statement

Creators have generated an AI influencer clip and want to combine it with their own phone screen recording or camera footage to make a short vertical video. They need a fast, understandable way to arrange those two videos, add readable Arabic text, and mix music and narration. A general-purpose production editor introduces unnecessary complexity, while server rendering and unrestricted media storage create operating-cost uncertainty.

The current product still delegates its editor entry point to OpenCut. A separate local prototype demonstrates the narrower workflow and browser export, but it is a performance experiment rather than an integrated, persistent product experience.

## Solution

Build Tasmeemai's own focused Video Editor inside the existing application. It produces only 9:16 short-form Content Pieces, with a maximum finished duration of 60 seconds and 1080p output. Its initial target is ordinary laptops.

The creator selects a main video and a Secondary Video, chooses a simple collage preset, adjusts clip timing, edits Arabic text directly on the portrait preview, adds optional Music and Voiceover Layers, and exports. A Secondary Video commonly contains an AI influencer reaction lasting 5–10 seconds, with a 15-second maximum, but the interface must call the track **Secondary video / الفيديو الثانوي**. The main video is not limited to 15 seconds.

Use the approved desktop visual direction: central portrait preview, compact media panel on the left, contextual properties on the right, collage presets above the preview, and four simple timeline rows below. Keep the interface responsive and free of prototype diagnostics. Connect it to existing Workspace media and Content Piece persistence rather than introducing a separate editing product.

## User Stories

1. As a creator, I want to open the Video Editor inside Tasmeemai, so that I can finish a video without moving to another product.
2. As an Arabic-speaking creator, I want an Arabic-first interface with correct RTL behavior, so that editing feels natural.
3. As a creator using the existing English locale, I want readable English controls and appropriate direction, so that the editor fits the rest of the application.
4. As a creator, I want a fixed portrait canvas, so that I do not need to choose an aspect ratio for short-form content.
5. As a creator, I want to upload phone footage or a screen recording as my main video, so that I can use content I have already recorded.
6. As a creator, I want to select an existing Workspace video, so that I can reuse media without uploading it again unnecessarily.
7. As a creator, I want to select my generated AI influencer clip as the Secondary Video, so that I can combine it with my footage.
8. As a creator, I want the second media card, timeline row, timing controls, and source-audio controls to say Secondary video rather than Reaction, so that the role is understandable beyond the initial reaction use case.
9. As a creator, I want recognizable thumbnails and durations for both videos, so that I can tell which clip I am editing.
10. As a creator, I want basic clip trimming, so that the composition uses the intended portion of each source.
11. As a creator, I want clear limits of 60 seconds for the finished video and 15 seconds for the Secondary Video, so that I can fit my content within the supported workflow.
12. As a creator, I want an actionable validation message when media cannot be used, so that I can correct the input before wasting time exporting.
13. As a creator, I want to stack the two videos above one another, so that both are visible in a portrait composition.
14. As a creator, I want a picture-in-picture preset, so that the Secondary Video can appear over the main footage.
15. As a creator, I want side-by-side panels inside the portrait canvas, so that I have another simple collage option without creating landscape output.
16. As a creator, I want to preview a layout change immediately, so that I can choose the arrangement visually.
17. As a creator, I want to choose when the Secondary Video starts, so that it appears at the right moment in the main footage.
18. As a creator, I want the Secondary Video to play once and stop appearing when its selected portion ends while the main footage continues, so that I do not have to repeat or manually hide the clip.
19. As a creator, I want to play, pause, and scrub a simple timeline with a visible playhead and time readout, so that I can check my composition.
20. As a creator, I want clear rows for Main Video, Secondary Video, Music, and Voiceover, so that timing remains understandable.
21. As a creator, I want to add Arabic text to the video, so that I can communicate a message without generating subtitles.
22. As a creator, I want to edit text directly on the video preview, so that I can see my changes in context.
23. As a creator, I want to drag text to a new position within the video, so that it does not cover an important subject.
24. As a keyboard user, I want to focus, edit, and reposition the text overlay, so that basic editing does not depend exclusively on dragging.
25. As a creator, I want to type and paste multiple lines of Arabic text, so that my overlay is not restricted to a single line.
26. As a creator, I want the preview text and its properties input to stay synchronized, so that either editing surface shows the same content.
27. As a creator, I want left, center, and right alignment, so that the overlay fits my composition.
28. As a creator, I want thin, light, regular, and bold text weights and a size control, so that I can establish emphasis and readability.
29. As a creator, I want to choose text color, background color, and background opacity, so that Arabic remains readable over changing footage.
30. As a creator, I want Arabic letters, line breaks, wrapping, styling, and placement to remain correct in the exported video, so that the result matches what I edited.
31. As a creator, I want an independent Music Layer using an uploaded or existing Workspace audio file, so that I can add background music.
32. As a creator, I want an independent Voiceover Layer using an uploaded or existing Workspace audio file, so that I can add spoken narration.
33. As a creator, I want separate volume and mute controls for music, voiceover, and embedded video audio, so that I can balance the composition.
34. As a creator, I want to position the added audio layers in time, so that music and narration accompany the intended part of the video.
35. As a creator, I want supported MP3 and WAV files to export without converting them myself, so that audio preparation does not interrupt my workflow.
36. As a creator, I want any future music or voiceover generation entry point to live with the relevant audio layer, so that the editor can support generation later without reorganizing the workflow.
37. As a creator, I want my composition edits to autosave within my Workspace and reopen with the same media and settings, so that I can continue later.
38. As a creator, I want an honest saving or save-error indicator, so that I know whether my latest edits are durable.
39. As a creator, I want existing Workspace media permissions and storage limits to apply in the editor, so that media use remains consistent with the rest of Tasmeemai.
40. As a creator, I want a clear quota or unavailable-media error that preserves my editing work, so that I can recover without recreating the composition.
41. As a creator, I want undo and redo for composition edits, so that I can experiment without losing a useful arrangement.
42. As a creator, I want one clear export action with progress and a usable finished file, so that completing a video is straightforward.
43. As a creator, I want to cancel an export and try again, so that an unwanted or failed attempt does not trap the editor.
44. As a creator, I want responsive controls during playback and export, so that processing does not make the application feel frozen.
45. As a creator, I want export errors to identify the affected media or unsupported capability, so that I can take a useful next step.
46. As a creator, I want export to preserve my chosen timing automatically, so that I am not expected to compensate manually for an encoder defect; the currently measured offsets are an explicitly deferred limitation.
47. As a product operator, I want editing and media processing to have bounded resource use, so that this focused feature does not imply unbounded infrastructure cost.

## Implementation Decisions

- **Product ownership and routing:** replace the OpenCut delegation with a built-in editor in the existing application. Retain the existing authentication, onboarding, locale, and Workspace-access boundaries. The local prototype is not a production route and must not be presented as the completed migration.
- **Bounded composition:** one main video and one Secondary Video, three collage presets, a fixed 9:16 canvas, at most 60 seconds finished duration, and at most 15 seconds of Secondary Video. Initial input support targets media up to 1080p. Do not confuse source aspect ratio with output aspect ratio: recorded footage is framed inside the fixed portrait composition.
- **Timing behavior:** basic trimming and a creator-selected Secondary Video start; the selected Secondary Video segment appears once, then ends while the main video continues. Music and Voiceover have independent timing and gain. Exact looping, ducking, and advanced audio-mixing policies were not agreed and must not be silently introduced.
- **Terminology:** Main Video and Secondary Video identify roles. Use “Secondary video” and “الفيديو الثانوي” consistently in all user-facing controls. Reaction Video remains useful domain vocabulary for the initial use case, not the second track's display name.
- **Approved UI direction:** large central portrait preview; media cards and audio entry points on the left; contextual properties on the right; compact collage choices above the preview; play/pause and time readout below it; four timeline rows beneath the stage. Include a clear export action, honest save state, and undo/redo. The generated reference establishes visual direction rather than pixel-exact geometry or a complete interaction specification. Its old Reaction label is superseded by the Secondary Video naming decision.
- **Arabic overlay interaction:** directly selectable, editable, and movable on the preview, with a synchronized multiline properties input. Enter inserts a line break; Ctrl/Cmd+Enter finishes inline editing. Preserve the prototype's accessible keyboard movement and bounded positioning behavior. Support whole-overlay size, alignment, thin/light/regular/bold weight, foreground color, background color, and opacity, including a transparent background. Automatic wrapping must not discard explicit line breaks. Do not expand this into a general rich-text document editor.
- **Shared composition boundary:** keep one serializable description of selected media, trims and start times, layout, text content and appearance, overlay position, and audio-layer timing/gain. Preview, save/reopen, and export consume the same composition meaning. Centralize validation here rather than duplicating rules in unrelated widgets and export code. Exact schema and storage mappings remain an implementation design task, not a second competing content model.
- **Workspace integration:** represent the editable work within existing Workspace-owned Content Piece and Content Piece Draft semantics. Reuse existing media references, upload/delivery services, authorization, and configured quota enforcement. Autosave must not imply that an incomplete upload or failed persistence operation is durable. Preserve existing revision and conflict rules rather than silently overwriting concurrent changes. Exact new API or database contracts have not been agreed; extend existing boundaries only where the composition requires it.
- **Storage policy boundary:** subscription-specific byte allowances, charging/accounting rules, retention, and deletion policy remain separate product decisions. Do not invent plan numbers or an unlimited allowance. Wire the editor to existing configured enforcement and make any production dependency on missing policy explicit.
- **Audio sources and future generation:** Music and Voiceover are separate from embedded audio in both videos. Each accepts uploaded or existing Workspace audio. Reserve a clear place for future generation with no active provider calls. Audio references remain provider-neutral; Suno and ElevenLabs were examples, not selected integrations. Microphone recording is deferred.
- **Export boundary:** one composition export operation provides progress, cancellation, success with a usable artifact, or an actionable error. The browser prototype is the measured candidate implementation. Final production browser-versus-server execution is still undecided; keep the UI and composition contract independent of that deployment choice. Implement and qualify the agreed workflow without provisioning a VM per editor, introducing a render fleet, or adding an automatic paid fallback as an assumed requirement.
- **Browser execution guidance from the prototype:** media work runs in a worker; decode incrementally, respect encoder backpressure, cache text rasterization, mix bounded audio blocks, and stream output to temporary browser storage. Normalize only the needed portion of incompatible audio, capped by composition duration. Compatible audio skips normalization. Remove intermediate files after success, cancellation, and handled failures; abnormal-termination recovery remains necessary before broad production use. Do not buffer an entire export in application memory merely for convenience.
- **MP3 compatibility:** the prototype pins Mediabunny 1.55.7 through an isolated alias because its upstream metadata-header recognition fixes the reproduced import rejection. Other application media consumers retain their existing locked dependency. Preserve the verified fix and codec regression coverage; no header mutation, full-file native-decoding fallback, server conversion, or extra MP3-specific normalization pass was introduced.
- **Measured settings versus product decisions:** 1080p and portrait output are agreed. The prototype's 30 fps, 6 Mbps H.264, 128 kbps AAC, center cropping, automatic return to full-frame main footage, no looping, and no ducking are documented starting assumptions, not newly ratified product policies. Resolve any change that materially alters the agreed user behavior explicitly.
- **Known timing limitation:** the user accepted deferring the measured 44 ms AAC offset. Tested MP3 inputs additionally show roughly 23–26 ms of source padding, producing about 67–70 ms total marker delay. Preserve these findings and the diagnostic; do not claim sample-exact alignment or apply an unverified constant trim. Users must not be asked to repair the pipeline with manual compensation controls. The newly measured MP3 padding is recorded follow-up work, not evidence that the user separately approved a larger universal tolerance.
- **Performance priority:** measure startup, interactive edits, playback/scrubbing, export responsiveness, cancellation, and total memory on representative ordinary laptops. The M1 Max measurements establish feasibility only. No numeric production performance SLA or qualifying reference laptop/browser has been accepted. Keep benchmark diagnostics out of the product interface.

## Testing Decisions

- **Confirmed with the user:** one primary end-to-end boundary exercises adding two videos and audio, editing collage and Arabic text, saving/reopening, exporting, and inspecting the actual MP4. Reuse existing Workspace-access tests and prototype audio/performance checks. Prefer this high-level workflow over new test seams for each widget or internal helper.
- **What makes a good test:** assert observable behavior and artifact correctness, not component structure, internal store shape, private media-library calls, or implementation-mirroring snapshots. Mock external storage/provider boundaries only when appropriate; do not mock away the media decoding and encoding that a codec regression is intended to test.
- **Editor workflow coverage:** select main and Secondary Video sources, trim within limits, exercise all three layouts, position the Secondary Video, scrub before/during/after it, and confirm the main video continues. Assert the actual second-track label in Arabic and English. Cover invalid duration, missing/unavailable media, and unsupported files through visible errors.
- **Text behavior and export:** enter and paste multiline Arabic directly on the canvas and through the properties input; verify synchronization, keyboard editing, movement bounds, alignment, weights, size, colors, and transparency. Save/reopen and extract output frames to confirm connected Arabic, explicit line breaks, wrapping, styling, and position. Extend the existing locale/RTL component-test pattern for accessible labels and direction where the browser workflow alone would obscure a failure.
- **Audio behavior and export:** use independent identifiable source tones and windowed markers for main, Secondary Video, Music, and Voiceover. Verify gain/mute behavior and interior-window presence in decoded exports. Retain WAV sample-rate cases and the CBR, VBR, mono, untagged MP3, and malformed-file cases from the regression harness. Verify WAV resampling does not add a timing shift relative to direct AAC. Report MP3 padding and AAC offset separately from import success; the deferred timing work must not be disguised as a passing sample-exact assertion.
- **Persistence and ownership:** drive save/reopen through the same public editor workflow. Reuse existing Workspace asset route, ownership, upload-validation, quota, and Content Piece Draft policy coverage for denied access, stale references, invalid sources, and failed saves. Confirm that save failures do not display “saved” or discard the visible composition. Do not create an editor-specific bypass of shared authorization or limits.
- **Output checks:** inspect actual media dimensions, codec metadata, video frame count/duration, and decoded audio. Use the existing video composition integration-test approach as prior art for synthetic fixtures, FFmpeg/FFprobe inspection, cleanup, and cancellation. Frame inspection must distinguish video duration from AAC/container padding. The historical 60.074667-second container result must not be reported as exactly 60 seconds of media solely because video frames span 60 seconds.
- **Cancellation and recovery:** cancel during audio preparation and rendering, confirm temporary-file cleanup, and immediately complete a new export. Verify an error from one input does not strand the editor. Include abnormal interruption and reopen behavior when production persistence and temporary-storage recovery are implemented.
- **Performance qualification:** extend the existing headed-browser benchmark. Measure total export including audio preparation, interaction latency, frame gaps, long tasks, cancellation, and browser-session/native memory rather than page JS heap alone. Include 60-second compositions, all layouts, representative footage and codecs, repeated sessions, and an ordinary-laptop run. Record hardware, browser, dependency version, and warm/cold conditions; do not convert one development-machine observation into a release guarantee.
- **Prior art:** existing Arabic/English editor direction tests, Workspace asset access and media-evidence tests, Content Piece Draft policy tests, real video composition integration tests, and the prototype's browser benchmark and audio marker diagnostic. These form reusable supporting checks around the single primary workflow boundary.

## Out of Scope

- Delegating the feature to OpenCut, introducing an editor microfrontend, or building a general professional editing suite.
- Landscape or square video output, more than two video inputs, finished videos over 60 seconds, or Secondary Video segments over 15 seconds.
- Full mobile editing parity, arbitrary effects/keyframes/transitions, unrestricted multitrack editing, or advanced color grading.
- Automatic subtitles, transcription, per-word rich-text formatting, and a broad text-animation system.
- Live camera/screen capture or microphone recording inside the editor; the initial workflow imports recorded media.
- Active AI music or voiceover generation, provider selection, API integration, or associated purchases.
- Automatic audio ducking, looping, and other advanced mixing features that were not agreed.
- Fixing AAC encoder timing or MP3 source padding in this implementation scope; retain the diagnostics and follow-up work.
- New subscription storage allowances, retention/accounting policy, render-service provisioning, per-user VMs, and a final production export-deployment decision.
- Social publishing, changes to unrelated generation workflows, or a broad application-wide media-library upgrade.
- Treating the local test harness or generated reference image as finished production UI.

## Further Notes

- Product scope, UI direction, Secondary Video naming, and the high-level testing approach were explicitly agreed. This spec synthesizes those decisions without reopening the product interview.
- Production export execution, subscription storage policy, representative performance hardware/budgets, and the remaining crop/reframing/audio-policy details must remain visible decisions. They must not be silently filled in as new user commitments. The ready-for-agent label authorizes implementation of the specified workflow; it is not approval to purchase infrastructure or launch unqualified behavior.
- The approved visual reference has been retained with the editor work, with the naming correction documented separately. It was not regenerated. Its source commit is `17ab1b7f` on the local feature branch; the written layout requirements above are self-contained. Include the approved reference when publishing the implementation PR; this issue does not imply that an unpublished local image is already available through a public GitHub URL.
- The work is on `feature/throwaway-reaction-export`, based on `develop`. Implementation PRs must target `develop`; existing local prototype commits and the UI reference have not been presented as merged production work.
- Current application routing and placeholder editor screens still reflect the earlier OpenCut arrangement. The own-editor decision supersedes that design and requires a deliberate migration while preserving existing access boundaries.
- Historical M1 Max / Chrome 152 measurements: three original 60-second layouts took about 5.1–5.2 seconds; a WAV normalization run took about 5.4 seconds. After the prototype-only MP3 fix, 60-second MP3 compositions took 5.6–5.9 seconds, including roughly 0.3 seconds of MP3 music preparation; a same-version stacked WAV comparison took about 5.6 seconds. Controls stayed responsive in the sampled runs. These are synthetic, machine-specific observations, not ordinary-laptop qualification or an estimate of total operating cost.
- Browser export avoids server rendering in the measured path, but does not remove Workspace storage, transfer, application hosting, support, or future generation costs. Do not describe the feature as having zero operating cost.
# Local-review additions — 2026-09-07

The user requested these additions while reviewing PR #219:

- Visible draggable trim edges, splitting at the playhead, and deletion of selected sections. Sections remain ranges of the existing per-track source rather than additional uploaded media. Splitting is nondestructive; undo/redo and save/reopen retain edits. Deleting a Main section closes that time interval across all tracks to preserve synchronization. Deleting another track's section closes the gap within that track. The final Main section is retained; select another source to replace it.
- At least three Arabic-capable typefaces: Noto Sans Arabic, Cairo, and Noto Naskh Arabic. Preview, inline editing, persisted state, and exported text use the selected font. Existing drafts default to Noto Sans Arabic.
- A viewport-height editor with a continuously accessible timeline, a preview fitted to the remaining space, independently scrolling side panels, narrow-screen panel toggles, and fullscreen where supported. The local acceptance matrix includes desktop, laptop, portrait phone, and short landscape viewports.
