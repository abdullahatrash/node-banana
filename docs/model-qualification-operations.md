# Replicate model qualification operations

Model qualification is an operator-only, explicitly paid procedure. Normal application startup, tests, catalog discovery, and `pnpm qualify:replicate <plan.json>` without the exact confirmation flag make no provider calls.

Before considering a paid run, execute the secret-safe, no-network operator preflight:

```bash
pnpm qualify:replicate:check reviewed-plan.json
```

The preflight validates the complete reviewed plan, exact curated capability set, bilingual and Arabic-variety cells, lifecycle coverage, source-media URLs, derivative-use evidence, runtime-compatible region/mode, per-cell quantities, the local `$0.40` ceiling, dedicated credential separation, safe harness endpoints, and both Ed25519 trust maps. It never constructs a provider client and rejects the paid-execution flag. Use `--json` for machine-readable output.

Before executing more than one model plan, validate the whole intended launch
portfolio together. This no-network check requires Arabic copy, text-to-image,
image remix, text-to-video, and image-to-video coverage, rejects duplicate runs
or executions, and totals every reviewed plan under the same account ceiling:

```bash
pnpm qualify:replicate:portfolio -- \
  reviewed-copy-plan.json \
  reviewed-image-plan.json \
  reviewed-image-remix-plan.json \
  reviewed-video-plan.json
```

The portfolio total covers the pending batch only. The durable Postgres ledger
remains authoritative for completed and incomplete spend already committed by
the same Replicate account and can still block the first paid submission.

Before authoring that plan, inspect the current Official Model contract with the
dedicated qualification token:

```bash
pnpm qualify:replicate:inspect prunaai/p-image > /tmp/p-image-contract.json
```

This command makes exactly one authenticated `GET /v1/models/{owner}/{name}`
request. It cannot accept the paid-execution flag, never creates a prediction,
and sends no prompt, Brand, media, or Workspace data. The report pins the model
identity, exact input-schema digest, required keys, enums, defaults, and numeric
limits. It intentionally does not treat mutable catalog price estimates as
qualification evidence: review and digest current license and pricing sources
separately, then map the prompt, aspect ratio, quantity, media, safety, and locked
parameters into the reviewed plan.

For models whose reviewed price is composed from input and output megapixels,
each smoke cell must also provide `pricingInputAssets` in the exact order sent
to the provider. Every entry pins the HTTPS URL and authoritative decoded width
and height. The attestation must lock a positive `output_megapixels` value.
Preflight recomposes the provider input, rejects missing or reordered evidence,
and signs the resulting per-component maximums into spend authorization v2.
Runtime uses the same calculation from server-probed Workspace asset dimensions;
browser-declared dimensions are never trusted for a reservation.

## Replicate target identity

Replicate has two supported target contracts and the reviewed plan must name the
right one:

- An Official Model uses `endpoint: "official"` and sets `version` to the exact
  stable `owner/name` model identifier. Replicate may report the executed
  version as `hidden`; the runner instead verifies the returned `model`
  identity and re-digests the current OpenAPI input schema before every paid
  cell.
- A community model uses `endpoint: "versioned"` and pins the immutable version
  identifier. The returned version must match exactly.

Never copy the literal value `hidden` into a qualification. Official Model APIs
are stable model targets, while the independently pinned schema digest and
90-day maximum qualification window detect contract drift. See Replicate's
[Official Models](https://replicate.com/docs/topics/models/official-models) and
[HTTP API](https://replicate.com/docs/reference/http/) documentation.

## Safety boundary

The only paid invocation is:

```bash
MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY='<ephemeral Ed25519 PEM>' \
  pnpm qualify:replicate reviewed-plan.json --execute-paid-smoke
```

The literal `--execute-paid-smoke` flag is mandatory. Review the plan and its immutable Replicate version, real input schema digest, required Brand-reference fixtures, 9:16 cases, cancellation case, language coverage, license evidence, and pricing evidence before using it. Never run the command from CI, application startup, a fork, or an untrusted plan.

## Prerequisites

1. Apply database migrations through `0131_model_qualification_spend_evidence`.
2. Set a dedicated, least-privileged `REPLICATE_QUALIFICATION_API_TOKEN`. Customer BYOK credentials must never be used. Example-file placeholders are treated as missing.
3. Expose `/api/studio/webhooks/replicate-qualification` through an HTTPS tunnel and set that full URL as `QUALIFICATION_WEBHOOK_URL`. Set `QUALIFICATION_WEBHOOK_OBSERVER_URL` to the local app's `/api/studio/internal/qualification-webhooks` route. The receiver verifies Replicate's signature, stores only an append-only payload digest and identity receipt, and correlates both `start` and terminal deliveries to the stable run/case submission key. This is also the safe recovery path when the paid submission response is lost: the runner waits for verified webhook evidence and never blindly retries a paid prediction.
4. Set `QUALIFICATION_INGESTION_URL` to the local app's `/api/studio/internal/qualification-artifacts` route. Text output is hashed and checked with deterministic Unicode-script evidence without retaining its content. Every media output is fetched only from `REPLICATE_OUTPUT_HOSTS`, size-bounded, decoded, hashed, and stored as an immutable technical inspection. Media never receives invented language evidence: the paid runner waits up to 15 minutes for an operator to accept or reject the exact content digest.
5. While a media cell is waiting, list the pending reviews with `pnpm qualify:replicate:review --list`. Open the returned Replicate prediction URL, compare it to the reported digest and dimensions, then record one immutable decision. For an image use `--method operator_visual_review`; for video use `--method operator_playback_review`. Example:

   ```bash
   pnpm qualify:replicate:review \
     --receipt qai_<receipt> \
     --digest sha256:<content-digest> \
     --decision accepted \
     --reviewer operator@example.com \
     --method operator_visual_review \
     --languages ar \
     --notes "Arabic composition, shaping, and Brand fidelity reviewed."
   ```

   The review command never calls Replicate or starts a prediction. A rejection or conflicting second review fails closed.
6. Set `QUALIFICATION_SPEND_OBSERVER_URL` to the local app's `/api/studio/internal/qualification-spend` route. Configure a distinct `QUALIFICATION_SPEND_SIGNING_KEY_ID` and `QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY`; the private key must match the public key stored under that ID in `QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON`. Replicate's public prediction object exposes runtime metrics, not an exact per-prediction account charge, so runtime estimates must never be imported as billing evidence.
7. Configure a random `QUALIFICATION_HARNESS_TOKEN` of at least 32 characters for the observer and the remaining internal services.
8. Configure `REPLICATE_WEBHOOK_SIGNING_SECRET` from Replicate's webhook-signing-secret endpoint. A made-up local value cannot verify Replicate deliveries.
9. Pin the spend service's Ed25519 public keys in `QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON`. The local service binds signed preflight authorizations and observed receipts to the Replicate account, credential fingerprint, immutable model version, stable run/case identity, and prediction.
10. Supply `MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY` only for the command invocation. Keep the corresponding public key in `MODEL_QUALIFICATION_PUBLIC_KEYS_JSON` for runtime verification.

## Durable account ceiling

The server-owned matrix ID `replicate-production-qualification/v1` has a strict account-wide ceiling below USD 0.40. Before any paid submission, the runner identifies the account using the configured Replicate credential, obtains signed maximum-cost authorizations for every cell, and atomically reserves the complete matrix budget across all runs for that account. Caller-declared maximums are not accepted.

After each prediction reaches a reconciled terminal state, the runner requires a signed provider-account billing receipt and records it append-only before proceeding. The runner waits while the operator performs this non-provider action in another terminal:

```bash
pnpm qualify:replicate:spend -- --list
```

Open the prediction URL from that list and locate a Replicate account usage export,
invoice line, or account view that identifies both the exact prediction and its
USD charge. Preserve that evidence in the operator-controlled audit store and
compute its SHA-256 digest. Aggregate account totals, model averages, elapsed
runtime, and locally calculated estimates are not acceptable. Import the exact
charge only after confirming the binding:

```bash
pnpm qualify:replicate:spend -- \
  --run qualification-run-001 \
  --case arabic-complete \
  --prediction prediction-id \
  --amount 0.012 \
  --observed-at 2026-09-05T00:00:00.000Z \
  --evidence-kind replicate_account_usage_export \
  --evidence-digest sha256:<digest> \
  --reviewer operator@example.com \
  --notes "Exact prediction ID and charge verified in the retained account export." \
  --confirm-exact-prediction-charge
```

The command never calls Replicate and stores only the evidence digest, reviewer,
and a digest of the notes. The source evidence itself must remain available in
the controlled audit store. An ambiguous or aggregate charge must be left
unimported, which intentionally stops the paid matrix before another prediction.

Unknown cost, an untrusted signature, an expired authorization, an unresolved provider outcome, missing Brand/reference coverage, or an unavailable durable ledger stops the matrix before another paid call. Completed runs count observed cost; incomplete runs retain their full reservation. Legacy qualification rows without verified account spend block new qualification until an operator reconciles them.

The runner never prints provider tokens, harness tokens, or signing private keys. Store the signed qualification envelope as reviewed configuration only after every matrix cell and receipt gate succeeds.
