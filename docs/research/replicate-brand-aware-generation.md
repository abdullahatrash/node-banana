# Replicate routing for brand-aware image, video, and remix generation

Date: 2026-09-03

## Research question

Which current Replicate models should Tasmeemai use for cost-conscious 9:16 image creation, image remixing, text/image-to-video, and rights-aware video remixing; and what must change in the repository so every paid generation is bound to its Workspace, accepted Brand Profile revision, language, provenance, exact model execution, and quote?

## Evidence and cost boundary

- Model capabilities, schemas, pricing, availability, and data-handling claims below come only from Replicate's official documentation, official model pages, and their first-party examples.
- Integration findings come from the repository at this commit and the accepted ADRs.
- No prediction endpoint was called. No Replicate credit was consumed. The configured API key was neither printed nor read into this report.
- Prices are public list prices observed on 2026-09-03. They are not a durable quote. Tasmeemai must snapshot the price rule and compute an immutable maximum debit at admission.
- Replicate calls an "official model" always-on, actively maintained, stable-API, and predictably priced. Official HTTP calls use the stable `owner/model` identifier without a caller-supplied version. The returned prediction still carries its execution metadata. [Replicate official-model contract](https://replicate.com/docs/topics/models/official-models), [prediction object](https://replicate.com/docs/topics/predictions)

## Executive recommendation

Adopt a small curated routing policy, not an unrestricted model marketplace:

1. Use the newer `prunaai/p-image` for default text-to-image layout previews: one 9:16 image costs $0.005, the page claims sub-second output, and its source model is Apache-2.0. Retain `black-forest-labs/flux-schnell` as a qualified $0.003 fallback, not an automatic substitution.
2. Use `prunaai/p-image-edit` for inexpensive reference-guided image variations: one output costs $0.01 and supports multiple images plus 9:16.
3. Use `google/nano-banana-2` when multilingual text and many Brand references matter: it accepts up to 14 images, supports 9:16, produces 1K/2K/4K output, and costs $0.067/$0.101/$0.151 respectively. Its Lite sibling is a lower-cost 1K candidate, but it should not replace the qualified Brand lane until the Arabic and identity tests prove parity.
4. Use `black-forest-labs/flux-2-pro` as the higher-fidelity brand-reference image route, especially when up to eight product/person/style images must be composed.
5. Use `prunaai/p-video` for the default video iteration loop. A five-second 720p 9:16 draft costs $0.025; promoting the accepted prompt/seed/reference to a normal 720p render costs $0.10.
6. Use `google/veo-3.1-lite` as the economical accepted-concept renderer when native audio is required: 720p costs $0.05/s and supports 9:16 text/first-frame/last-frame generation.
7. Use `prunaai/p-video-animate` for licensed motion transfer from a 9:16 source video to a brand-owned subject image. Five seconds at 720p costs $0.15.
8. Use `bytedance/seedance-2.0` only when multimodal Brand/trend references justify its cost. It supports up to nine images, three videos, and three audio references, with editing/extension and native audio.
9. Use `kwaivgi/kling-v3-omni-video` only as a premium multi-shot or reference-video lane after an exact quote.
10. Use `wan-video/wan-2.7-videoedit` only for an approved, focused edit of a rights-cleared clip. A five-second output costs $0.50, so it is not an exploratory route.
11. Keep `bytedance/seedance-2.5`, `alibaba/wan-3`, and `black-forest-labs/flux-3` in canary/watchlist policy. Seedance 2.5 is a new 30-second flagship whose numeric bands were not retrievable; Wan 3 has conflicting promotional/current price evidence; FLUX 3 is explicitly early access. None belongs in a default or fallback lane until its contract and quote are stable.

This policy copies the valuable Fastlane outcome—turn inspiration into on-brand vertical content—without copying protected expression or treating a trending video's availability as remix permission. Trending discovery produces a rights-aware **Inspiration Item** and then a transformation-focused **Remix Brief**. The generation request may include source video bytes only when the rights snapshot explicitly permits that use. Repository authority: [ADR 0016](../adr/0016-rights-aware-inspiration-sources.md).

## Curated image routes

| Lane | Official identifier | Exact useful inputs and output | 9:16 | Public cost and latency evidence | Availability and caveats |
| --- | --- | --- | --- | --- | --- |
| Layout preview | `prunaai/p-image` | `prompt`; preset or custom `aspect_ratio`; custom width/height 256–1440; optional prompt upsampling, seed, and LoRA inputs. Returns one image URI. | Explicit preset or custom | $5/1,000 outputs ($0.005 each); the page claims sub-second output. | Official; source license is Apache-2.0 and commercial projects are expressly allowed in the readme. Keep the safety checker enabled and never accept a caller-supplied Hugging Face token. [Schema and pricing](https://replicate.com/prunaai/p-image/api/schema), [readme and license](https://replicate.com/prunaai/p-image/readme) |
| Qualified preview fallback | `black-forest-labs/flux-schnell` | `prompt`; `aspect_ratio`; `num_outputs` 1–4; `num_inference_steps` 1–4; `seed`; `go_fast`; approximate megapixels; output format/quality. Returns one or more image URIs. | Explicit preset | $3/1,000 outputs ($0.003 each). Designed for low-latency generation. | Official and commercial-use marked. It may be cheaper, but fallback still requires authorization because model behavior changes. Keep the safety checker enabled and emit one preview. [Model and schema](https://replicate.com/black-forest-labs/flux-schnell) |
| Cheap image remix | `prunaai/p-image-edit` | `images[]` with the primary image first; `prompt`; `aspect_ratio`; `turbo`; `seed`; `disable_safety_checker`. Returns one image URI. | Explicit preset or `match_input_image` | $0.01/image; the page describes sub-second generation. | Official; data-privacy and zero-training marked. Commercial clearance is not stated in the retrievable badge set, so Legal/Product must capture the effective model license before enabling customer publication. Always set `disable_safety_checker: false`. [Schema and pricing](https://replicate.com/prunaai/p-image-edit/api/schema), [aspect presets](https://replicate.com/prunaai/p-image-edit) |
| Multilingual/reference final | `google/nano-banana-2` | `prompt`; up to 14 `image_input[]`; `aspect_ratio`; 1K/2K/4K `resolution`; `output_format`. Returns one image URI. | Explicit preset or `match_input_image` | $0.067 at 1K, $0.101 at 2K, and $0.151 at 4K per output. | Official. Replicate documents improved multilingual text rendering and up to 14 references. Default to 1K until the approved concept needs more. Capture the effective commercial terms before customer publication. [Schema and pricing](https://replicate.com/google/nano-banana-2/api), [multilingual/reference behavior](https://replicate.com/google/nano-banana-2/readme) |
| Brand-reference final | `black-forest-labs/flux-2-pro` | `prompt`; up to 8 `input_images[]`; `resolution` 0.5–4 MP; preset/custom/matched `aspect_ratio`; `width`/`height` for custom; `seed`; output format/quality; safety tolerance. Returns one image URI. | Explicit preset; custom 9:16 also possible | $0.015 base plus $0.015 per combined input/output MP; Replicate reports about 6s text-only and 9s with an input image. A 1 MP output with one 1 MP reference is about $0.045 by that published formula. | Official, commercial-use marked, zero-training marked. Cap at 1 MP until a selected concept needs more. [Schema](https://replicate.com/black-forest-labs/flux-2-pro/api/schema), [official pricing/latency explanation](https://replicate.com/blog/run-flux-2-on-replicate) |
| Targeted single-image edit fallback | `black-forest-labs/flux-kontext-pro` | `input_image`; natural-language `prompt`; `aspect_ratio`; output format; seed; safety tolerance; optional prompt upsampling. Returns one image URI. | Explicit preset or `match_input_image` | $0.04/image. | Official, commercial-use and zero-training marked. Use only when the cheap multi-image editor fails a focused edit; it accepts one reference image. [Schema and pricing](https://replicate.com/black-forest-labs/flux-kontext-pro/api/schema) |

Why not expose every discovered image model? A generated campaign must remain reproducible and quotable. New models enter a canary policy only after schema, pricing, license, safety, Arabic-text, brand-adherence, and 9:16 checks. Dynamic discovery remains an operator tool.

## Curated video and remix routes

| Lane | Official identifier | Exact useful inputs and output | 9:16 behavior | Public cost and latency evidence | Availability and caveats |
| --- | --- | --- | --- | --- | --- |
| Draft and standard T2V/I2V | `prunaai/p-video` | `prompt`; optional first `image`, `last_frame_image`, or conditioning `audio`; current schema duration 1–20s; 720p/1080p; `fps`; `draft`; `aspect_ratio`; `save_audio`; prompt upsampling; seed. Returns one video URI. | Explicit 9:16 for text-to-video; input image controls framing for I2V | Draft: $0.005/s at 720p, $0.01/s at 1080p. Standard: $0.02/s at 720p, $0.04/s at 1080p. Replicate reports about 10s generation for a five-second 720p standard clip and 4× faster draft iteration. | Official, warm, commercial-use, data-privacy, and zero-training marked. The readme still says maximum 10s while the schema says 20s; enforce 10s until metadata qualification resolves it. The schema's `disable_safety_filter` default is reported as `true`; always send `false`. Prefer 5s, 720p, 24fps, audio off while composing. [Schema](https://replicate.com/prunaai/p-video/api/schema), [pricing, aspect ratios, limitations](https://replicate.com/prunaai/p-video) |
| Economical accepted-concept final | `google/veo-3.1-lite` | Required `prompt`; optional first image and last-frame interpolation; `aspect_ratio`; 720p/1080p; duration exactly 4/6/8s; synchronized native audio. Returns one video URI. | Explicit 9:16 or 16:9 | $0.05/s at 720p and $0.08/s at 1080p. | Official. 1080p requires 8s; it has no arbitrary reference-image set or video extension. Use after P-Video proves the concept, when native audio quality is required. [Schema and pricing](https://replicate.com/google/veo-3.1-lite/api), [capabilities](https://replicate.com/google/veo-3.1-lite/readme) |
| Motion-reference remix | `prunaai/p-video-animate` | Required source `video` and subject `image`; optional `instruction_prompt`; 720p/1080p; `target_fps`; `save_audio`; `ignore_audio`; `turbo`; seed. Returns one video URI. | Preserves the source aspect ratio; source must already be 9:16 | $0.03/s at 720p and $0.06/s at 1080p. Replicate reports about 5.24s generation per second of output. | Official and warm. Use only with owned/licensed motion and audio; source audio is included by default. Keep `disable_safety_checker: false`; default to `save_audio: false` unless audio rights and brand language are approved. [Schema](https://replicate.com/prunaai/p-video-animate/api/schema), [pricing and behavior](https://replicate.com/prunaai/p-video-animate) |
| Multimodal Brand/trend transfer | `bytedance/seedance-2.0` | Optional first `image` plus last frame, or up to 9 `reference_images`, 3 `reference_videos` totaling 15s, and 3 `reference_audios` totaling 15s; prompt; 5–15s or intelligent duration; 480p/720p/1080p/4K; aspect ratio; native audio; seed. Returns one video URI. | Explicit 9:16 is 496×864 at 480p or 720×1280 at 720p; `adaptive` is also available | Without video input: $0.08/$0.18/$0.45/$1.00 per second at 480p/720p/1080p/4K. With video input: $0.10/$0.22/$0.55/$1.25 per second. | Official and warm. Five seconds at 480p starts at $0.40, so validate schema without a prediction and require a separate premium confirmation. [Schema](https://replicate.com/bytedance/seedance-2.0/api/schema), [reference/edit behavior and vertical sizes](https://replicate.com/bytedance/seedance-2.0/readme) |
| Premium multi-shot/reference video | `kwaivgi/kling-v3-omni-video` | Text or start/end images; up to 7 references (4 with video); 3–10s reference video in style/camera/edit modes; 3–15s output; up to 6 shots; 720p/1080p/4K; native audio subject to reference-video constraints. Returns one video URI. | Explicit 9:16; start image controls I2V framing | Standard $0.168/s without audio or $0.224/s with audio; pro $0.224/$0.28; 4K $0.42/s. | Official and warm, but too expensive for exploration. Require an exact quote and premium intent; reference video and native-audio combinations are constrained. [Schema and pricing](https://replicate.com/kwaivgi/kling-v3-omni-video/api), [capabilities](https://replicate.com/kwaivgi/kling-v3-omni-video/readme) |
| Focused video instruction edit | `wan-video/wan-2.7-videoedit` | Required 2–10s `video`; focused `prompt`; optional `reference_image`; `resolution`; explicit/`auto` aspect ratio; optional truncated duration; `audio_setting`; seed. Returns one video URI. | Explicit aspect ratio or `auto` to preserve input | $0.10/s. | Official, warm, data-privacy and zero-training marked. Best evidence supports one focused change per pass; complex spatial and detailed facial edits are limitations. The page does not expose a commercial badge in the retrievable source, so capture license evidence before publication. [Schema, pricing, and limitations](https://replicate.com/wan-video/wan-2.7-videoedit) |
| Canary: new 30s multimodal | `bytedance/seedance-2.5` | Optional first/last images, up to 30 reference images, 10 reference videos, and 10 reference audios; prompt; duration -1 or up to 30s; resolution; aspect ratio; audio; watermark; seed. Returns one video URI. | Explicit 9:16 for generation; first/last-frame, edit, and extension require `adaptive` | Priced per output second, but numeric bands were not present in the retrievable official page. No production quote may be inferred. | Official, warm, and new. Keep canary-only until price, schema, license, Arabic, and outcome tests pass. [Schema](https://replicate.com/bytedance/seedance-2.5/api/schema), [capabilities](https://replicate.com/bytedance/seedance-2.5) |
| Canary: economical long form | `alibaba/wan-3` | Text or first image; explicit/adaptive aspect; 480p/720p/1080p; 2–30s; negative prompt; prompt expansion; seed. Returns one video URI. | Explicit 9:16 | The current page has conflicting evidence: live billing metadata showed $0.025/$0.05/$0.10 per second while the readme says $0.05/$0.10/$0.20 and still mentions a 50%-off promotion ending August 30. | Never quote the promotional band. Budget against the higher readme band until Replicate exposes an unambiguous current price snapshot. [Schema and live model page](https://replicate.com/alibaba/wan-3/api), [readme pricing](https://replicate.com/alibaba/wan-3/readme) |
| Canary: early-access multimodal | `black-forest-labs/flux-3` | `prompt`; up to 10 storyboard `images`; optional `start_video` for extension; aspect ratio; 720p output; duration auto/5/10/15/20; native audio; draft; seed; safety tolerance. Returns one video URI. | Explicit 9:16; draft is T2V-only | Numeric public price was not present in the retrieved page. | Official but explicitly **early-access preview**. Do not place in a default or automatic fallback path. One observed version page was `3047b701b1050b47ccea249bf647208439e17e6b4aa399618a57335cac0169a7`; resolve at quote time rather than hardcode it. [Model page](https://replicate.com/black-forest-labs/flux-3), [versioned schema example](https://replicate.com/black-forest-labs/flux-3/versions/3047b701b1050b47ccea249bf647208439e17e6b4aa399618a57335cac0169a7/api) |

Do not use generative reframing merely to convert landscape media to 9:16. Crop/pad/recompose in the deterministic video editor first; it costs no inference credit and preserves content exactly. `luma/reframe-video` is an optional last resort at $0.06/s for 720p when semantic reframing is explicitly requested. Its readme says up to 30 seconds while the current schema description says 10 seconds, so enforce 10 seconds until a no-cost metadata probe resolves the conflict. [Replicate model page](https://replicate.com/luma/reframe-video), [schema](https://replicate.com/luma/reframe-video/api/schema)

## Brand-aware generation contract

Every user-visible generation, including a preview, must persist one immutable **Generation Intent Revision** before provider admission. The provider payload is derived from this record; clients do not send raw provider parameters directly to a paid endpoint.

Minimum pinned fields:

```text
GenerationIntentRevision
  id, revision, idempotencyKey
  workspaceId
  requestedByPrincipalId, authorizationEvidenceRef
  contentPieceRevisionId | standaloneBriefRevisionId
  acceptedBrandProfile: { id, revision, schemaVersion, contentHash }
  contentLanguage, arabicVariety
  inspiration: {
    inspirationItemId, capturedRevision, sourceUrlHash,
    rightsSnapshotId, permittedRemixBehavior,
    remixBriefId, remixBriefRevision, transformationRequirements
  } | null
  inputs: [{ artifactId, artifactRevision, role, contentHash, rightsSnapshotId }]
  operation: text_to_image | image_edit | text_to_video |
             image_to_video | video_edit | motion_transfer | video_extend
  outputContract: { aspectRatio, duration, resolution, fps, audioPolicy }
  modelPolicyRevisionId
  selectedExecution: {
    provider, officialModelIdentifier, resolvedVersionId,
    schemaDigest, normalizedInputsDigest, safetyPolicyRevisionId
  }
  fallbackAuthorizationId | null
  executionMode: byok | managed
  priceSnapshotId, quoteId, reservationId, quoteExpiresAt
```

`arabicVariety` must be a separate key, not folded into `contentLanguage`. Suggested initial values are `msa`, `gulf`, `saudi`, `emirati`, `egyptian`, `levantine`, `maghrebi`, and `unspecified`, with the accepted Brand Profile holding the Workspace default and a brief allowed to override it explicitly. Model qualification must test Arabic prompt comprehension, Arabic glyph shaping in images, dialect-appropriate spoken audio, and mixed Arabic/Latin bidi text separately; declaring a model "Arabic capable" from one prompt is insufficient.

Brand conditioning is deterministic prompt assembly, not a vague instruction to "know the Workspace." The prompt compiler reads only the pinned accepted Brand Profile revision and produces a provider-neutral **Creative Brief Snapshot** containing identity, audience, positioning, voice, prohibited claims/topics, visual assets, content language, Arabic variety, channel, and transformation constraints. The model never reads the live mutable Workspace row during execution. An old Run therefore stays attributable after the Brand Profile changes.

For a trend-inspired 9:16 clip:

1. Select the Inspiration Item and validate its current rights snapshot.
2. Create a Remix Brief that extracts permissible topic, hook, pacing, shot grammar, and performance insight without copying protected frames, audio, text, or identity.
3. Bind the accepted Brand Profile and Content Language/Arabic Variety.
4. Generate 9:16 still candidates cheaply.
5. Animate the accepted still with a 5s 720p draft.
6. Promote the same brief, selected seed/reference, and provider parameters to final quality; do not quietly regenerate a different idea.
7. Run similarity, prohibited-claim/topic, visual-brand, caption-safe-area, audio-rights, and Arabic review before the result becomes a publishable Content Piece Revision.

If the rights snapshot permits source-video transformation, a video editing or motion-transfer operation may receive the source as an input Artifact. Otherwise the source is evidence for the Remix Brief only and must not be sent to Replicate.

## Cost-conscious routing and fallback policy

### Default ceilings

| Phase | Default | Hard request ceiling before a fresh confirmation |
| --- | --- | --- |
| Image exploration | 1 output, 1 MP or lower | $0.05 |
| Image final | 1 output, 1–2 MP | $0.10 |
| Video exploration | 5s, 720p, 24fps, draft, audio off | $0.03 |
| Video final | 5s, 720p, normal quality | $0.15 |
| Motion transfer | 5s, 720p, audio off | $0.20 |
| Instruction video edit | 3–5s, one focused change | $0.50 |
| Premium multimodal video | No default | Exact quote plus explicit promotion |

The UI should show both provider list cost and the immutable Tasmeemai/BYOK quote before acceptance. In BYOK mode the quote is still required as a cost guard, even if no Tasmeemai credits are debited.

### Fallback rules

- No fallback is implicit. This includes provider-owned switches such as `allow_fallback_model`; send `false` when a schema exposes it.
- A fallback authorization is an ordered list of exact qualified executions with a total maximum debit no higher than the accepted quote.
- Compatibility must cover operation, output dimensions, duration, audio behavior, number/type of references, Brand constraints, Content Language, Arabic Variety, region/data policy, safety policy, and commercial license.
- A preview model can never substitute for a final model; a text-to-video model cannot replace a video edit; a silent model cannot replace native audio.
- If no pre-authorized compatible execution exists, the durable Run enters `waiting_for_user` with the reason and revised quote. It never silently uses the next available model.

This is already the repository's accepted rule in [ADR 0032](../adr/0032-model-fallback-requires-explicit-bounded-authorization.md) and fixed-quote rule in [ADR 0022](../adr/0022-managed-execution-uses-fixed-credit-quotes.md).

## Minimal future paid smoke matrix

This research did not run it. After the integration exists, execute this smallest contract matrix once against dedicated synthetic/owned fixtures with a **$0.40 account-side hard stop** and a **$0.347 planned maximum**. Abort remaining rows before submission if their maximum could take cumulative cost above $0.40, or if any prior response lacks expected billing/version evidence.

| Row | Model and input | What it proves | Maximum at public list price |
| --- | --- | --- | ---: |
| 1 | `p-image`, one mixed Arabic/English 9:16 T2I | route, output count, first Arabic glyph smoke, aspect ratio | $0.005 |
| 2 | `nano-banana-2`, one 1K Arabic+Latin brand edit with three owned references | reference order, multilingual text, identity/product consistency | $0.067 |
| 3 | `p-video`, 3s 720p 9:16 T2V draft | cheapest video admission and durable completion | $0.015 |
| 4 | `p-video`, promote the accepted brief to 3s 720p 9:16 standard | draft-to-final promotion and cost settlement | $0.060 |
| 5 | `wan-2.7-videoedit`, 2s owned 9:16 clip with one focused change | video input, rights pin, explicit aspect, provider result ingestion | $0.200 |

Planned list-price total: approximately **$0.347**. The hard ceiling leaves only $0.053 for pricing drift and explicitly does **not** authorize a retry. `p-image-edit`, `flux-2-pro`, `veo-3.1-lite`, `p-video-animate`, Seedance, Kling, Wan 3, and FLUX 3 first receive schema/normalization fixture tests without predictions. Add a paid row only through a separately approved, exactly quoted canary; for example, one five-second Seedance 2.0 480p generation alone costs at least $0.40 at the observed non-video-input list rate.

## Repository gap analysis and exact integration seams

### Current behavior worth retaining

- Workspace-scoped BYOK key resolution already exists for Replicate in [`src/app/api/generate/route.ts`](../../src/app/api/generate/route.ts) and [`src/lib/byok/resolveInferenceKey.ts`](../../src/lib/byok/resolveInferenceKey.ts).
- Model metadata and OpenAPI schemas are fetched from Replicate, and provider inputs are type-coerced in [`src/app/api/models/[modelId]/route.ts`](../../src/app/api/models/%5BmodelId%5D/route.ts), [`src/app/api/generate/schemaUtils.ts`](../../src/app/api/generate/schemaUtils.ts), and [`src/app/api/generate/providers/replicate.ts`](../../src/app/api/generate/providers/replicate.ts).
- Replicate output URLs are allowlisted through `validateMediaUrl`, and the provider adapter handles URI or URI-array outputs.
- The durable runtime already has Run, Artifact, Usage, Budget, Quota, and provider-effect foundations under [`src/lib/agent-runtime`](../../src/lib/agent-runtime).
- Accepted Brand Profile rows already carry Workspace, revision, schema version, active/superseded state, source/run lineage, and acceptance evidence in [`src/lib/onboarding/repository.ts`](../../src/lib/onboarding/repository.ts) and [`src/lib/db/schema.ts`](../../src/lib/db/schema.ts).

### Blocking gaps

1. [`src/app/api/generate/route.ts`](../../src/app/api/generate/route.ts) reads `x-workspace-id` directly and allows it to be absent; it does not resolve and authorize an authenticated Workspace membership before paid execution.
2. The request accepts client-selected provider/model and arbitrary `parameters`/`dynamicInputs`. No curated Model Policy validates the requested operation, reference count, price, safety switch, license, language, or quality tier.
3. Workspace ID is used only for asset/key lookup. The route never loads or pins the accepted Brand Profile, language/Arabic Variety, Content Piece/brief revision, or Inspiration/Remix provenance.
4. [`generateWithReplicate`](../../src/app/api/generate/providers/replicate.ts) resolves `latest_version.id` inside execution. A version can therefore change after a UI preview or quote; no immutable admission record binds it.
5. The Replicate catalog mapper in [`src/app/api/models/route.ts`](../../src/app/api/models/route.ts) discards version, schema digest, price, license, official/warm status, and compatibility evidence. Its keyword heuristic returns only one of text-to-video or image-to-video for multi-capability models and has no video-edit, motion-transfer, or video-extend capability.
6. [`ModelCapability`](../../src/lib/providers/types.ts) lacks `video-to-video`, `video-edit`, `video-extend`, `motion-transfer`, reference-image/video/audio cardinality, and native-audio semantics. `ModelInput` can represent only image or text, so video/audio references are not first-class.
7. A generated clip is polled in the HTTP request for up to ten minutes even though the route declares a five-minute platform maximum. The timeout response does not cancel the Replicate prediction, so paid work may continue while the client sees failure.
8. The adapter handles only `succeeded`, `failed`, and `canceled`; Replicate also documents `aborted`. It does not set a provider `Cancel-After` deadline.
9. The adapter fetches the entire output before deciding whether a video is over 20 MB. This still buffers every video in server memory and leaves a temporary Replicate URL for large results.
10. Replicate deletes API prediction inputs, outputs, logs, and files after one hour by default. The current synchronous response is not durable ingestion and can leave a Content Piece pointing at expired provider media. [Replicate retention](https://replicate.com/docs/topics/predictions/data-retention/)
11. There is no immutable Managed Execution Quote/reservation, no BYOK cost guard, no attempt/selected-version audit, no provider prediction ID on the returned result, and no safe outcome-unknown reconciliation.

### Implementation sequence

1. **Deepen the generation contract.** Add a `src/lib/generation/` module owning `GenerationIntentRevision`, `CreativeBriefSnapshot`, operation capabilities, Model Policy revisions, fallback authorization, normalized provider input, and result lineage. Extend Artifact roles for image, video, audio, first/last frame, brand reference, motion source, and inspiration evidence.
2. **Add a curated Replicate registry.** Keep live discovery for operators, but production lanes resolve from a versioned registry containing exact official identifier, qualification state, schema digest, price rule, license evidence, safety overrides, supported operations, aspect/resolution/duration/reference constraints, content-language/Arabic-variety evidence, and canary/default status.
3. **Move admission below the route.** A transport-agnostic application command resolves authenticated Workspace membership, the accepted Brand Profile revision, requested Content Piece/brief, Inspiration rights, artifacts, execution mode, quote, reservation, and exact Replicate version before creating a durable Run. The UI, REST, agent tools, and future MCP all call this command.
4. **Build a durable Replicate provider adapter.** Put it beside the runtime provider boundary rather than expanding the legacy page route. Submit asynchronously with an idempotent provider-effect key, `Cancel-After`, and a signed `completed` webhook; persist prediction ID/model/version immediately; reconcile duplicated/missed webhooks by polling. Map `starting`, `processing`, `succeeded`, `failed`, `canceled`, and `aborted` honestly.
5. **Ingest outputs immediately.** On success, stream the provider URI to Workspace storage, validate MIME/size/duration/dimensions, hash the bytes, create an Artifact and lineage edge, then settle the reservation. Replicate says API files expire after one hour, so provider URLs are evidence, not the durable asset. [Webhooks and one-hour persistence deadline](https://replicate.com/docs/topics/webhooks), [output files](https://replicate.com/docs/topics/predictions/output-files)
6. **Keep the legacy route as a compatibility adapter.** Translate supported existing Simple Studio payloads into the new command and return a deprecation-safe response. Reject unsupported raw parameters rather than bypassing policy.
7. **Expose cost and provenance.** Run inspection must show Workspace, Brand revision, language/Arabic Variety, source/remix rights, provider/model/version, input/output hashes, quote/reservation/settlement, every attempted fallback, prediction ID/status, and next action.
8. **Qualify before defaulting.** Run schema fixtures first, then the <$0.40 paid matrix. Promote one lane at a time only after the Arabic/English, 9:16, safety, license, cost, webhook, cancel, timeout, output-ingest, and reconciliation cases pass.

## Provider lifecycle requirements

Replicate documents `starting`, `processing`, `succeeded`, `failed`, `canceled`, and `aborted`; a normal prediction times out after 30 minutes, while `Cancel-After` can impose an application deadline. An aborted-before-start prediction is not billed; a canceled-after-start prediction can be billed for work already performed. [Prediction lifecycle](https://replicate.com/docs/topics/predictions/lifecycle)

Therefore:

- a client disconnect never means provider cancellation;
- an application wait timeout never means prediction failure;
- cancellation is a durable intent followed by a provider cancel attempt and reconciliation;
- an ambiguous provider/network result is `outcome_unknown`, with the reservation held visibly;
- prediction IDs and timestamps are saved before polling or webhook handling;
- webhook delivery is idempotent because Replicate retries delivery;
- customer-facing progress uses named stages/status, not invented percentages;
- provider logs are support evidence and must be redacted before customer display.

## Acceptance gates for implementation

- No paid provider call can be admitted without an authenticated Workspace, authorized principal, exact accepted Brand Profile revision, Content Language, explicit Arabic Variety value, exact operation/output contract, versioned Model Policy, exact Replicate identifier/version evidence, price snapshot, quote, and reservation/cost guard.
- No inspiration-derived call can be admitted without a pinned Inspiration Item rights snapshot and Remix Brief; source bytes are rejected unless that snapshot permits transformation.
- All curated defaults explicitly keep provider safety filtering enabled. A customer cannot smuggle `disable_safety_checker: true` or an internal fallback flag through raw parameters.
- All 9:16 routes validate the actual output dimensions; I2V and motion-transfer inputs are normalized to 9:16 or rejected before the quoted paid call.
- Arabic and English prompts, Arabic varieties, mixed bidi brand names, Arabic glyph rendering, and audio dialect are separate qualification cells.
- Preview and final are distinct quality lanes. Promotion reuses the accepted Creative Brief Snapshot and reference set; it does not silently alter the creative intent.
- Every terminal provider result is durably ingested or visibly failed before Replicate's one-hour deletion window.
- Retry is idempotent and cannot create duplicate predictions after an ambiguous create response.
- Fallback never occurs without an explicit compatible authorization and never raises the accepted quote.
- The complete paid smoke matrix stops automatically at the account-side $0.40 ceiling.

## Source index

- [Replicate official models](https://replicate.com/docs/topics/models/official-models)
- [Replicate predictions](https://replicate.com/docs/topics/predictions)
- [Prediction lifecycle and deadlines](https://replicate.com/docs/topics/predictions/lifecycle)
- [Webhook behavior](https://replicate.com/docs/topics/webhooks)
- [Output files and retention](https://replicate.com/docs/topics/predictions/output-files)
- [API data retention](https://replicate.com/docs/topics/predictions/data-retention/)
- [Replicate public pricing overview](https://replicate.com/pricing)
- [Official image-editing collection](https://replicate.com/collections/image-editing)
- [Official video-editing collection](https://replicate.com/collections/video-editing)
