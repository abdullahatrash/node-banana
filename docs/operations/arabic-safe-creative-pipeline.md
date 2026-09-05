# Arabic-safe creative pipeline: implementation and release evidence

Issue: [#183](https://github.com/abdullahatrash/node-banana/issues/183).

This implementation is **not approved for release**. The authenticated creative routes reject requests unless `CREATIVE_GENERATION_ENABLED=true`. Leave that switch unset until the outstanding acceptance work below is completed. Existing Simple Studio and Content Piece generation remain on their existing contracts.

## Module survey and implementation

The existing `model-routing` module owns qualified model/version/schema admission, region and rights validation, managed quote/reserve/settlement, BYOK cost guards, provider effect identity, cancellation/reconciliation, and durable asset/text receipts. Those authorities are reused. The new `creative-generation` module owns the request, reduced brief, copy approval, deterministic composition, and visual/publication review lifecycle.

Creative sessions pin Workspace, accepted Brand Profile revision/digest, language, Arabic variety, output dimensions/aspect/duration/fps, source hashes, rights snapshot/evidence, funding and idempotency. Migration `0140_arabic_safe_creative_sessions.sql` stores optimistic session heads, immutable revision snapshots, and command receipts. Stage references retain the authoritative generation intent and operation; provider failures and uncertain outcomes remain inspectable there.

The brief distinguishes accepted Brand assertions from document-wide source evidence. The current Brand Profile does not provide per-claim source mappings, so the brief does not invent those mappings or describe accepted assertions as independently verified facts. Competitors, uncertainties, unrelated content angles, billing data and Workspace membership never enter the compiled brief.

Copy generation requests strict `creative-copy/v1` JSON. Arabic and English have independent reading order; explicit literal spans protect URLs, handles, numbers, SKUs, and foreign-script strings. Validation rejects hostile bidi overrides and invalid JSON without repairing, normalizing, trimming, translating or retrying generated text. The original model text receipt remains authoritative even if its copy contract fails.

The `tasmeemai-creative-prompt/v1` provider policy sends the compiled prompt exactly and excludes automatically appended Brand fields and logo inputs. Legacy `tasmeemai-brand-prompt/v1` intents retain their original prompt/media behavior. Visual prompts request text-free artwork; approved copy is not an input to the visual compiler.

The versioned composition pins copy and plate hashes. Sharp/Pango/HarfBuzz/FriBidi render logical Unicode using bundled, checksum-pinned Noto Sans Arabic. A Unicode cmap check rejects unsupported glyphs before host fallback can change the output. Text boxes enforce measured overflow, bounded shrinking, opaque contrast panels, nonoverlap, reading order, and a conservative versioned 9:16 safe area. Image export and video export use the same PNG text layers. Video requires an operator-provisioned FFmpeg executable (`CREATIVE_FFMPEG_PATH`, default `ffmpeg`). The bundled font and OFL license are traced into the creative route deployment under `assets/fonts/creative/`.

## Authenticated command interface

`POST /api/studio/creatives` creates a pinned session. `GET /api/studio/creatives/{sessionId}` returns it with authoritative operation observations. `POST` on the latter route supports:

- `edit`, `approve_copy`: append authored revisions and exact approval; no provider call.
- `admit`: request a fixed quote/admission for `copy` or `visual`. Managed confirmation is a separate explicit request. `regenerate=true` is required for another attempt.
- `execute`: execute the exact admitted intent through the existing single-attempt provider adapter.
- `collect`: bind validated provider text or a canonical plate to the session.
- `approve_visual`: acknowledge the exact inspection finding digest.
- `render`: preview an optional unsaved copy/layout draft or export the stored approved composition, without provider generation.
- `approve_publication`, `handoff`: approve exact exported bytes and return the versioned asset/copy/composition/rights/intent handoff.
- `cancel`: record durable cancellation intent before propagating cancellation to active canonical operations. Unknown provider outcomes do not become fabricated refunds.

Every mutation uses the authenticated `x-workspace-id`, `idempotency-key`, and exact `expectedRevision`. Copy/layout changes invalidate later export approval. A visual plate carries `creativePlateReviewRequired`; a composed asset carries `creativeReviewRequired`. Social delivery checks the exact historical approved snapshot immediately before resolving delivery media, so copying a library URL does not bypass review and later edits do not erase an earlier approved revision.

## Inspection and spending constraints

`CREATIVE_PLATE_INSPECTOR_URL` and `CREATIVE_PLATE_INSPECTOR_TOKEN` configure a trusted HTTPS internal inspection adapter. It receives Workspace/asset identity and the exact plate digest, and returns `creative-plate-inspection/v1` with detector identity, version and bounded text/watermark/protected-mark findings. It must only inspect canonical media and must not perform paid generation or retries. This repository does not provision that adapter or claim its qualification.

Missing, failed, stale or malformed inspection yields an explicit unavailable warning. A human must acknowledge the exact warning before acceptance. High-confidence watermark/protected-mark findings reject the plate. No inspection result starts another provider operation.

No paid inference or qualification was used to develop or validate this change. Local raster and video fixture generation uses Sharp and FFmpeg only. Existing managed-credit, BYOK and qualification ledgers remain separate.

## Evidence and remaining acceptance work

Automated evidence includes strict request/brief/copy contracts; exact authored bytes; Arabic/Latin literal and hostile-control cases; real Arabic, English and bilingual raster output; byte-identical repeat image output; glyph rejection; measured overflow; contrast; safe areas; nonoverlap and timing; immutable request/idempotency behavior; explicit regeneration; cancellation/admission races; managed/BYOK forwarding and quote-required states; unknown/failure preservation; inspection warning/rejection; and local 9:16 FFmpeg composition. Existing model-routing and social tests cover the reused authorities. Migration 0140 was executed in an isolated localhost Postgres schema: concurrent creation, exact historical replay, stale revision/key conflict, Workspace isolation, and database-enforced immutability passed. The test removed only its generated temporary schema afterward.

The following are **not complete** and must not be represented as passed acceptance criteria:

- Creator-facing launch/edit/preview/progress/review UI, keyboard/focus restoration, reduced motion, and desktop/tablet/mobile Arabic RTL and English LTR browser evidence.
- Complete authenticated browser E2E covering Arabic/English/bilingual images, video, insufficient credits, managed settlement, BYOK, cancellation and edit-without-generation against the real database/storage runtime.
- Production migration execution and governance erasure/retention integration for creative session snapshots. Isolated local Postgres evidence does not apply the migration to the product's live schema.
- Qualified OCR/watermark inspection infrastructure and independent visual/render qualification. Local font/shaping/geometry measurements are renderer receipts, not independent approval evidence.
- Native editor and social composer consumption of the versioned handoff as editable layers/captions. The handoff payload and delivery gate exist; query links alone do not establish consumer integration.
- Customer-selected aspect ratios other than currently qualified 9:16 media. The composition contract supports image layouts at 1:1, 4:5 and 16:9, but canonical admission rejects them until matching model/output qualifications exist.
- End-to-end reservation cleanup/credit evidence for every process crash and concurrent cancellation boundary in the new orchestration, and durable render-worker recovery. The implementation currently performs local composition in the authenticated HTTP request.

These gaps keep issue #183 open. Enabling the route is not a substitute for completing the production acceptance matrix.
