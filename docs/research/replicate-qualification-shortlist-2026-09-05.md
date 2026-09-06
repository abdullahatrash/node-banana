# Replicate qualification shortlist: economical 9:16 image and video

Observed: 2026-09-05

## Decision

Qualify these two Replicate Official Models first:

1. **Still generation and editing:** `black-forest-labs/flux-2-klein-4b`
2. **Short video generation and animation:** `prunaai/p-video`

This is a qualification shortlist, not a production approval. No prediction was
created while preparing it, no provider credential was read, and no Replicate
credit was spent. Public prices and schemas are observations, not durable
quotes. The existing qualification workflow must inspect and digest the live
OpenAPI schema immediately before a paid cell, bind the exact account-side
charge afterwards, and stop under its server-owned spend ceiling.

## Why these two

`black-forest-labs/flux-2-klein-4b` is the least expensive current candidate found
that keeps text-to-image, image-to-image, multi-reference Brand conditioning,
commercial use, and explicit 9:16 output in one Official Model contract. Its
current price is $1 per thousand input-image megapixels and $1 per thousand
output megapixels. Replicate describes it as a sub-second generation and editing
model; Black Forest Labs' first-party model README calls the Apache-2.0 model
professional quality and highlights photorealism, readable text, spatial
reasoning, and high-resolution editing. [Live model, price, and usage
terms](https://replicate.com/black-forest-labs/flux-2-klein-4b), [live
input/output schema](https://replicate.com/black-forest-labs/flux-2-klein-4b/api/schema)

`prunaai/p-video` is the least expensive current unified short-video candidate
found. It exposes text-to-video and image-to-video in the same Official Model,
has a draft tier for iteration, and explicitly supports vertical social output.
A 720p draft costs $0.005 per output second; standard 720p costs $0.02 per
second. Replicate describes the model as suitable for product animation and
short-form social content, while documenting its limitations for extreme camera
motion and complex multi-scene storytelling. [Live model, price, and first-party
guidance](https://replicate.com/prunaai/p-video), [live input/output
schema](https://replicate.com/prunaai/p-video/api/schema)

The live pricing metadata observed on 2026-09-05 also carried an undated notice
that paid pricing would resume after an extended free launch period on Monday at
09:00 CET. Because that notice does not state a calendar date and can expire at
any time, budget and authorize against the displayed paid tiers; never assume a
prediction will be free.

The next still rung is `black-forest-labs/flux-2-dev`, followed by
`black-forest-labs/flux-2-pro`; neither is an automatic substitution. Replicate
prices Dev at $0.012 per input/output megapixel with `go_fast=true`, while Pro is
a $0.015 base plus $0.015 per input/output megapixel. They should be qualified
only if Klein fails Brand/Arabic quality gates. [Replicate's FLUX.2 comparison
and pricing](https://replicate.com/blog/run-flux-2-on-replicate)

## Exact contract to inspect and qualify

### `black-forest-labs/flux-2-klein-4b`

| Concern | Current official evidence | Qualification rule |
| --- | --- | --- |
| Capabilities | Required text `prompt`; optional `images` for image-to-image; live schema allows at most 5 JPEG, PNG, GIF, or WebP references. | Cover both an empty-reference text case and a Brand-reference edit case. Enforce 5 references. |
| 9:16 | `aspect_ratio` enum is exactly `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `21:9`, `9:21`, or `match_input_image`. `output_megapixels` is exactly `0.25`, `0.5`, `1`, `2`, or `4`, default `1`. | Use `aspect_ratio: "9:16"`. Use 0.25 MP only for the minimum lifecycle smoke and 1 MP for representative visual review. Verify actual pixel ratio after decoding. |
| Safety | `disable_safety_checker` exists and defaults to `false`. | Always send `disable_safety_checker: false`; reject client overrides. |
| Reproducibility | `seed` is documented for reproducible generation; `go_fast` currently defaults to `false`. | Persist the seed, normalized inputs, schema digest, and returned execution evidence. A seed does not replace visual qualification. |
| Output | An array of URI values; output format enum is WebP, JPG, or PNG, default JPG. | Require exactly one result for the lane; ingest and inspect its bytes immediately rather than persisting the temporary provider URL as the asset. |
| Pricing | $0.001 per input-image MP plus $0.001 per output MP. | A minimum one-output 0.25 MP 9:16 text lifecycle smoke is about **$0.00025**. A representative 1 MP text case is about **$0.001**; one ~1 MP reference plus a 1 MP output is about **$0.002**. Exact cost varies with actual pixels and must be reconciled from the account charge. |
| Commercial/data statements | The first-party README says the model is Apache 2.0 and may be used commercially. Replicate says inputs/outputs are not used for training. It does not display the stronger model-specific “inputs and outputs are not retained” statement shown for P-Video. | Capture the Apache-2.0 source digest in qualification, apply Replicate's general API-retention deadline, and do not infer zero retention from “zero training.” |

The live model is the source of its current pricing and model identity. The
qualification inspector must still perform its authenticated `GET` and store the
schema digest; this public research note is not a substitute for that artifact.

### `prunaai/p-video`

| Concern | Current official evidence | Qualification rule |
| --- | --- | --- |
| Capabilities | Required text `prompt`; optional `image` for image-to-video and optional `last_frame_image`; supported image formats are JPG/JPEG, PNG, and WebP. It also accepts conditioning audio, which is outside this first smoke. | Cover text-to-video and a separate Brand-owned first-frame image-to-video case. Do not send source trend video; this endpoint does not document video-edit input. |
| 9:16 | Text mode supports `9:16`. When `image` is supplied, `aspect_ratio` is ignored and the input controls framing. | Set `aspect_ratio: "9:16"` for text mode. Normalize the I2V fixture itself to 9:16 and verify actual output dimensions. |
| Duration | Live schema accepts 1–20 seconds, default 5. The README still says 1–10 seconds. | Enforce the shared, documented-safe 1–10 second interval until the authenticated schema inspection resolves the mismatch. A 1-second lifecycle smoke lies within both contracts; use 5 seconds for meaningful visual review. |
| Quality controls | `resolution` is 720p or 1080p; `fps` is 24 or 48; `draft` selects preview quality. Replicate notes vertical output may work better at 1080p/48 fps. | Start at 720p/24 fps with `draft: true`; a passing smoke does not qualify final vertical quality. Promote the same accepted brief/reference to standard or higher quality for visual review. |
| Safety/audio | The live schema reports the hazardous default `disable_safety_filter: true`; `save_audio` also defaults to `true`. | Always send `disable_safety_filter: false`. Send `save_audio: false` for the initial visual smoke unless audio rights, language, and review are explicitly in scope. |
| Output | One video URI. | Use asynchronous prediction evidence and immediate durable ingestion; verify decoded duration, dimensions, MIME type, and playback. |
| Pricing | Displayed paid tiers are draft 720p $0.005/s, draft 1080p $0.01/s, standard 720p $0.02/s, and standard 1080p $0.04/s. A temporary free-launch notice was also visible, but without a dated expiry. | Reserve the paid tier. One 1-second 720p draft lifecycle smoke is at most **$0.005** at the displayed rate. One useful 5-second 720p draft visual case is at most **$0.025**; standard is **$0.10**. Reconcile the exact account-side charge before continuing. |
| Commercial/data statements | Replicate marks it commercial-use, data-privacy, and zero-training, and explicitly says inputs and outputs are not retained or used for training. | Still ingest output immediately and retain only Workspace-governed evidence/artifacts. Model badges do not establish a processing region. |

## Repository fit before any paid smoke

`prunaai/p-video` is already present in
[`CURATED_MODELS`](../../src/lib/model-routing/catalog.ts), and its draft-720p
price maps directly to the repository's existing per-second quote basis.

`black-forest-labs/flux-2-klein-4b` is **not** currently curated. The read-only
qualification inspector deliberately throws `QUALIFICATION_MODEL_NOT_CURATED`
for an unknown model, so an operator cannot safely inspect or qualify Klein yet.
It must first be added to the reviewed catalog.

That catalog change alone is insufficient. Current `CostQuote` and signed
qualification price schemas accept only `image`, `second`, or `run` unit prices.
Klein is billed separately for actual input-image and output megapixels. A flat
per-image estimate would underquote large/multiple references unless the policy
also locks and validates input count, decoded input megapixels, and output
megapixels before reservation. Deepen that price contract before exposing Klein
to either BYOK or managed execution. Until then, the currently curated
`black-forest-labs/flux-2-pro` has the same multi-property pricing mismatch and
is not a safe shortcut merely because it is listed.

The qualification plan also requires an exact 9:16 output shape. Replicate's
Klein schema exposes nominal megapixels and aspect ratio, not exact decoded
width/height. The first paid visual cell must therefore validate actual bytes
against the planned dimensions; metadata alone cannot prove that gate.

## Version and pinning behavior

Both shortlisted targets are **Official Models**. Replicate says Official Models
are actively maintained, predictably priced, and have stable APIs. The official
HTTP endpoint is `POST /v1/models/{owner}/{name}/predictions`; callers provide
the stable `owner/name` identifier and do **not** supply a version. [Official
Model contract](https://replicate.com/docs/topics/models/official-models), [HTTP
API reference](https://replicate.com/docs/reference/http/)

For this repository, represent each target using the existing official endpoint
contract:

```json
{
  "endpoint": "official",
  "version": "black-forest-labs/flux-2-klein-4b"
}
```

or:

```json
{
  "endpoint": "official",
  "version": "prunaai/p-video"
}
```

Do not copy the literal returned value `hidden` into configuration. A current
P-Video example shows `version: "hidden"`, which reflects execution reporting
for an Official Model rather than an immutable version ID. Pin reproducibility
with the stable official identity, authenticated live-schema digest, normalized
input digest, qualification envelope/expiry, and returned prediction evidence.
[P-Video official prediction example](https://replicate.com/prunaai/p-video/examples)

## Data location and retention boundary

Replicate's public model and deployment contracts do **not** document a selectable
or guaranteed execution region for either shortlisted Official Model. The
deployment contract exposes model version, hardware, and scaling configuration,
but no region field. Therefore the processing region is **not proven** by model
identity and must remain closed in Node Banana until a current signed provider
region-evidence route is accepted. This is an inference from the documented
contract, not a claim about where a particular prediction actually ran.
[Deployment contract](https://replicate.com/docs/topics/deployments/create-a-deployment)

Replicate's current subprocessor page lists AWS, CoreWeave, Fly.io, and GCP among
its infrastructure/data-hosting subprocessors and identifies their listed
locations as the United States. That disclosure is relevant governance evidence,
but it does not bind either model to one named facility or execution region.
[Replicate subprocessors](https://replicate.com/docs/topics/site-policy/subprocessors/)

For API-created predictions, Replicate's general policy says input parameters,
output values/files, and logs are removed after one hour by default. Output-file
URLs under `replicate.delivery` also expire after one hour. Node Banana must
therefore stream successful output into Workspace storage and persist hashes and
lineage before the deadline, even when a model page makes a stronger privacy
claim. [API data retention](https://replicate.com/docs/topics/predictions/data-retention/),
[output-file behavior](https://replicate.com/docs/topics/predictions/output-files)

## Cheapest safe first paid cells

After the no-network plan checks, authenticated schema inspection, rights and
Brand fixtures, webhook/signature setup, region admission, and exact spending
authorization all pass, the lowest-cost useful sequence is:

1. FLUX.2 Klein 4B T2I: one 1 MP 9:16 JPG, safety enabled — approximately
   $0.001. The absolute minimum 0.25 MP lifecycle cell is about $0.00025.
2. FLUX.2 Klein 4B Brand I2I: one ~1 MP input and one 1 MP 9:16 output, same
   locked safety policy — approximately $0.002.
3. P-Video T2V lifecycle: one second, 720p/24, draft, 9:16, audio off, safety
   enabled — $0.005.
4. P-Video Brand I2V visual review: five-second normalized 9:16 input, 720p/24,
   draft, audio off, safety enabled — $0.025.

Public-list-price estimate for those four useful predictions: **approximately
$0.033**.
This estimate is not authorization to execute them. It excludes retries and any
pixel-count difference, and the repository's account-wide qualification ceiling
and exact per-prediction receipt gates remain authoritative.

## Final recommendation

Promote neither model from metadata alone. Author the reviewed qualification plan
for these two exact Official Model identities, capture authenticated schema
digests, include Arabic prompt comprehension and mixed Arabic/Latin image review,
validate Brand-reference identity and true 9:16 bytes, and keep all safety flags
forced on. If FLUX.2 Klein 4B fails Arabic typography or Brand fidelity, qualify
`black-forest-labs/flux-2-dev`, then `black-forest-labs/flux-2-pro`, as controlled
promotion lanes. If P-Video fails
final-quality vertical motion or Arabic audio, retain it only as the inexpensive
silent draft lane and qualify a separate accepted-concept renderer.
