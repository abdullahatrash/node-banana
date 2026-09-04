# X Ads attribution operations

Tasmeemai uses X's server-side Web Conversion API for optional first-party acquisition attribution. It never loads an X advertising pixel in the browser. This purpose is independent of product analytics, Workspace publishing metrics, and customer X channel credentials.

Official references:

- [X Web conversions and Conversion API](https://docs.x.com/x-ads-api/measurement/web-conversions)
- [X Ads authenticated requests](https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests)
- [X Ads account access](https://docs.x.com/x-ads-api/fundamentals/accessing-ads-accounts)

## Production gate

Set every value below before setting the operator switch to `true`:

```dotenv
X_ADS_ATTRIBUTION_ENABLED=false
X_ADS_API_VERSION=12
X_ADS_PIXEL_ID=
X_ADS_API_KEY=
X_ADS_API_SECRET=
X_ADS_ACCESS_TOKEN=
X_ADS_ACCESS_TOKEN_SECRET=
X_ADS_EVENT_ID_SIGN_UP=
X_ADS_EVENT_ID_TRIAL_STARTED=
X_ADS_EVENT_ID_PURCHASE=
X_ADS_ACCOUNT_CURRENCY=USD
NEXT_PUBLIC_PRIVACY_URL=https://example.com/privacy
X_ADS_PRIVACY_NOTICE_VERSION=
X_ADS_REGION_REVIEW_VERSION=
X_ADS_API_ACCESS_REVIEW_VERSION=
X_ADS_EVENT_RETENTION_DAYS=30
X_ADS_RECEIPT_RETENTION_DAYS=365
```

The OAuth token must belong to an X user with Account Administrator or Ad Manager access to the relevant Ads account. `X_ADS_ACCOUNT_CURRENCY` must match that Ads account; purchase conversions in another currency are rejected rather than misreported. Record the completed Ads API access/role check in `X_ADS_API_ACCESS_REVIEW_VERSION`. Record the reviewed cross-border/region decision in `X_ADS_REGION_REVIEW_VERSION`. The privacy notice version must describe X as a recipient, the exact event and identifier categories, purposes, retention, revocation boundary, and user rights.

`X_ADS_API_KEY` and `X_ADS_API_SECRET` are deliberately not `X_API_KEY` and `X_API_SECRET`. The latter configure customer social publishing and cannot authorize Tasmeemai's acquisition measurement.

## Data contract

- The only accepted events are `sign_up`, `trial_started`, and `purchase`.
- At least one supported matching identifier is required. The current product producers use the verified account email, normalized and SHA-256 hashed before it reaches the durable outbox. A valid `twclid` may also be supplied by a trusted server producer.
- Raw email, phone, IP address, user agent, prompts, generated media, and Brand data are never written to the attribution outbox.
- The stable `conversion_id` is reused across retries for provider deduplication.
- Pending payloads expire at the earlier of the consent expiry or configured event retention.
- Accepted and terminal unknown-outcome payloads are scrubbed. Minimal request-digest/debug-ID evidence remains for the separate receipt-retention period.
- Revocation appends a new consent revision, blocks new admission, cancels and scrubs queued payloads, and prevents a claimed job from starting delivery after the final consent recheck. Data already accepted by X or already in flight cannot be recalled.

## Scheduling

Vercel runs commercial-source reconciliation followed by delivery every minute:

```text
GET /api/studio/internal/marketing-attribution?limit=20
```

Retention runs daily:

```text
GET /api/studio/internal/marketing-attribution?action=retention&limit=500
```

Reconciliation reads durable trial and verified merchant-completion facts only when the latest consent was already active at the source event time. It never backfills an event from before a later consent or reactivation. Successful producer receipts are skipped; transient best-effort enqueue loss is recovered with the same source-derived idempotency key and exact merchant occurrence time.

Both scheduled requests require `Authorization: Bearer $CRON_SECRET`. Manual/internal event admission and the explicit `reconcile` command use `POST` plus `x-studio-internal-secret`; never expose that endpoint or secret to a browser.

For local execution, start the app with `PORT=3002 pnpm dev`, then run `pnpm workers:local -- --url http://localhost:3002`. `pnpm doctor:local` prints every missing X Ads gate without printing credentials.

## Verification checklist

1. Keep `X_ADS_ATTRIBUTION_ENABLED=false` while credentials and reviews are prepared.
2. Run `pnpm doctor:local`; confirm the X Ads check lists the expected blockers.
3. Apply migrations with `pnpm db:migrate`.
4. Sign in as a test user and open Settings → Privacy in English and Arabic. Confirm the X Ads control is unavailable and the blocker copy is direction-safe.
5. Complete the public notice, role/access review, and regional review. Configure credentials and three Event IDs, then set the switch to `true` and restart.
6. Enable consent for the test user. Start a trial or complete a signed merchant checkout.
7. Run the worker once. Confirm the event becomes `delivered`, its payload is `{}`, one immutable delivery receipt exists, and neither table contains the raw email.
8. Revoke consent with queued test events. Confirm a new consent revision, cancelled state, scrubbed payloads, and no subsequent external call.
9. Replay the same consent and producer idempotency keys. Confirm no duplicate consent revision, outbox row, provider conversion, or receipt.
10. Exercise a simulated network loss and an X 4xx response. Confirm stable retry deduplication for unknown outcomes and terminal `failed_known` for definitive rejection.
