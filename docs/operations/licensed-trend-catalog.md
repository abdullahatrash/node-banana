# Licensed trend catalog operations

The licensed trend catalog is the media-bearing Inspiration lane. It is deliberately separate from YouTube and other public-metadata discovery: only operator-published media packages with a verified commercial remix license can enter it.

## Guarantees

- Catalog entry revisions are immutable and SHA-256 bound to exact source-media and license-document object identities.
- Publishing streams and verifies both S3 objects before making a revision active.
- A Workspace sees only the exact catalog revision named by an active, unexpired entitlement.
- Preview delivery rechecks the entitlement and returns a five-minute signed object URL.
- Importing is a durable leased job. It reserves Workspace storage quota, conditionally copies both objects, verifies the copied bytes, creates immutable licensed-rights evidence and a Rights Snapshot, then creates the Inspiration Item atomically with the completed job.
- Catalog or entitlement pause, revocation, and expiry are checked at browse, preview, import, materialization, and Blitz-queue boundaries.
- Arabic content stores `contentLanguage` and `arabicVariety` separately. English entries cannot claim an Arabic variety.
- Browsing, previewing, and importing spend no Generation Credits. The first billable boundary remains explicit quote acceptance for generation in Blitz.

## Provider onboarding

Do not publish scraped or assumed-to-be-reusable media. The commercial/provider agreement must grant commercial model-input use and the selected `transform` or `derivative` scope. Upload the exact provider media and its license/evidence document to the configured S3 bucket, retaining the object version ID and ETag.

Call `POST /api/studio/internal/licensed-trend-catalog` with `x-studio-internal-secret`:

1. `action: "publish"` with a complete `licensed-trend-catalog-entry/v1` document excluding the server-computed document digest.
2. `action: "grant"` with the Workspace ID, exact catalog revision, territories, expiry, and grant authority.

The internal endpoint also supports `set_catalog_state` (`active`, `paused`, or `revoked`) and `revoke_entitlement`. Never expose this endpoint or `STUDIO_INTERNAL_API_SECRET` to the browser.

## Automatic provider feed

A contracted provider can push catalog updates through the provider-neutral webhook at:

```text
POST /api/studio/webhooks/licensed-trends/<provider-key>
```

Configure `LICENSED_TREND_PROVIDER_PUBLIC_KEYS_JSON` as a map of provider key to retained Ed25519 public keys:

```json
{
  "licensed.partner": {
    "partner-2026": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  }
}
```

Each request carries `x-trend-event-id`, a positive `x-trend-sequence` beginning at 1, RFC 3339 `x-trend-occurred-at`, `x-trend-key-id`, and an unpadded base64url `x-trend-signature`. The Ed25519 signature covers this exact UTF-8 message:

```text
<provider-key>
<event-id>
<sequence>
<occurred-at>
sha256:<lowercase body SHA-256>
```

The body is a strict `licensed-trend-provider-event/v1` envelope. `publish_batch` accepts 1–20 complete unsigned `licensed-trend-catalog-entry/v1` documents; every document must name the authenticated provider. `set_catalog_state` accepts one catalog ID and `active`, `paused`, or `revoked`; a provider cannot mutate another provider's catalog entry.

The webhook verifies the raw body before parsing it and only enqueues the immutable event. It does not access provider media, publish a catalog revision, grant a Workspace entitlement, or generate content inline. Replaying the same event ID with the exact identity and body returns the stored state. Reusing an event ID or sequence with different signed bytes fails with a conflict.

The scheduled `licensed-trend-provider-events` worker consumes exactly `last_sequence + 1` per provider. Gaps stay queued, leases recover after worker interruption, and partial batch retries are safe because catalog revisions are immutable and digest-bound. A known-invalid event blocks later sequences. Operators may retry it after repairing an object-delivery problem, or explicitly skip only a terminal event with an 8–500 character audit reason:

```bash
curl -X POST http://localhost:3002/api/studio/internal/licensed-trend-provider-events \
  -H "x-studio-internal-secret: $STUDIO_INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"retry","providerKey":"licensed.partner","eventId":"event-1"}'
```

```bash
curl -X POST http://localhost:3002/api/studio/internal/licensed-trend-provider-events \
  -H "x-studio-internal-secret: $STUDIO_INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"skip","providerKey":"licensed.partner","eventId":"event-1","reason":"Provider withdrew the package and confirmed it must not publish."}'
```

Skipping advances only the exact next provider sequence and never publishes its payload. Entitlement grants remain a separate commercial-operations action: a signed provider package is not automatically available to any Workspace.

Do not configure TikTok's Research API as this product feed. TikTok limits Research Tools to qualifying independent or academic non-profit researchers, so a commercial trend product needs a separately contracted licensed source or an approved product API use case. The Commercial Content API is for commercial-content transparency and is not a general organic MENA trend corpus. See the official [Research API eligibility](https://developers.tiktok.com/doc/research-api-get-started) and [Commercial Content API](https://developers.tiktok.com/products/commercial-content-api) documentation.

## Local end-to-end test

Start Postgres and MinIO, migrate, seed, and start the app on port 3002:

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed
PORT=3002 pnpm dev
```

In another terminal, run:

```bash
pnpm smoke:licensed-trends
```

The smoke test signs in as the local seeded user, uploads a synthetic one-pixel fixture and evidence document, publishes and grants an exact catalog revision, browses and previews it through the Workspace API, requests import, runs the materialization worker, verifies the completed database lineage, and renders `/inspiration`. It then queues the exact item into Blitz, verifies the accepted Brand revision and Arabic variety are pinned into a protected-expression-safe Remix Brief, renders `/blitz`, and proves both the Generation Intent count and Generation Credit balance are unchanged. Finally it revokes its synthetic catalog/entitlement and archives both imported and queued fixtures. It never calls an AI provider or spends Generation Credits.

For normal queued work, run:

```bash
pnpm workers:local -- --url http://localhost:3002
```

The `licensed-trend-imports` summary reports claimed, succeeded, retried, and terminally failed imports.
The `licensed-trend-provider-events` summary independently reports signed feed events claimed, published, retried, failed-known, or outcome-unknown.

## Feature-by-feature acceptance

1. Grant an Arabic package and an English package to a test Workspace. Confirm language, Arabic-variety, region, topic, and hook filters work in both interface directions.
2. Open each media preview. Confirm an entitled Workspace receives the exact bytes and another Workspace receives no preview.
3. Import a package. Confirm the card moves from `available` to `importing`, then to `imported` after the worker runs.
4. Inspect the imported source and evidence Assets, licensed Rights Evidence, Rights Snapshot, Inspiration `catalogBinding`, and materialization job. Their digests and exact catalog revision must agree.
5. Add the imported item to Blitz. Confirm the versioned Remix Brief pins the active Brand Profile, source revision, rights snapshot, language/Arabic variety, influence plan, protected-expression exclusions, and exact provider prompt.
6. Revoke the entitlement and confirm preview, a new import, and Blitz queueing are rejected. The existing source remains visible only as non-actionable retained evidence until archived.
7. Expire a grant and repeat the previous check. Then publish a higher catalog revision and confirm an old entitlement never silently follows the head revision.
8. Stop the worker after either object copy, restart it, and confirm deterministic keys and command receipts complete one Inspiration Item without duplicate Assets.
9. Lower Workspace storage quota below the package size. Confirm the import retries/fails without a ready Inspiration Item or generation spend.

## Production readiness

- Use versioned object storage or otherwise immutable provider object keys.
- Restrict catalog publishing and entitlement grants to a trusted commercial-operations service.
- Keep provider/license renewals ahead of `rights.expiresAt`; expiry fails closed.
- Monitor terminal materialization failures and storage quota rejections.
- Retain evidence according to the Workspace rights-retention and erasure policy.
- Do not adapt YouTube API media into this path without a separate explicit reproduction/remix license that is independent of YouTube API access.
