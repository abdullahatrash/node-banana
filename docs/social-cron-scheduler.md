# Social Publishing Scheduler (Cron Wiring)

The social publishing backend (dispatch, recovery, sweep, token refresh,
webhook delivery, automation, digest, cleanup) is implemented as a set of
internal API routes under `src/app/api/social/internal/*`. Nothing invokes
them automatically unless a scheduler is wired up — this document describes
that wiring on Vercel, plus a QStash-based fallback for self-hosted
deployments.

## Authentication: how cron requests pass internal auth

Every internal route is guarded by `ensureInternalSocialAuth()`
(`src/lib/social/internal-auth.ts`), which accepts either:

- `x-social-internal-secret: <secret>`, or
- `Authorization: Bearer <secret>`

compared against the `SOCIAL_INTERNAL_API_SECRET` environment variable.

Vercel Cron Jobs authenticate their own requests by sending
`Authorization: Bearer $CRON_SECRET`, where `CRON_SECRET` is a project
environment variable you define yourself (Vercel does not generate it for
you, but does attach it to every cron-triggered request once it's set).

Because both mechanisms use the same `Authorization: Bearer <secret>` shape,
**no route code changes were needed**. The wiring is a configuration step:

1. Generate a secret: `openssl rand -hex 32`
2. Set it as `SOCIAL_INTERNAL_API_SECRET` in your Vercel project's
   environment variables.
3. Set the exact same value as `CRON_SECRET` in the same project.
4. Deploy. Vercel's cron invocations will now authenticate against the
   internal routes with zero additional code.

This was the deliberate choice over adding a second "accept CRON_SECRET too"
code path: it keeps `internal-auth.ts` as the single source of truth for
what counts as a valid internal caller, and treats Vercel's cron secret as
just another holder of the same shared secret.

## Vercel cron limits that shaped the schedule

Per Vercel's docs (fetched live, not from training data — see
`vercel-json` / `cron-jobs/usage-and-pricing`):

- Up to 100 cron jobs per project, all plans.
- **Hobby plan: once-per-day only**, with schedule expressions more
  frequent than daily failing at deploy time, and only ±59 minute timing
  precision.
- **Pro/Enterprise: per-minute cadence and per-minute precision.**

The 1-minute jobs below (`dispatch`, `recover-missing-dispatch`) require a
Pro (or Enterprise) plan. If the project is on Hobby, either upgrade or use
the QStash fallback described below for anything more frequent than daily.

## GET support

Vercel cron only ever issues `GET` requests. Three routes
(`recover-missing-dispatch`, `digest-dispatch`, `ops-snapshot`) already
exposed a `GET` handler that delegates to the same logic as `POST`. The
other cron-wired routes (`dispatch`, `automation-dispatch`, `cleanup`,
`reconcile-processing`, `sweep-stuck`, `token-refresh-dispatch`,
`webhook-delivery`) previously only had `POST`; this change adds a thin
`GET` export to each that calls the exact same handler function `POST` uses,
so manual/`curl` `POST` invocations for local testing keep working
unchanged.

## The cron table

Configured in [`vercel.json`](../vercel.json). Cadence choices below are
derived from each route's own tunable thresholds (env vars), not arbitrary
guesses.

| Route | Schedule | Cadence | Why |
|---|---|---|---|
| `dispatch` | `* * * * *` | every 1 min | Publishes due queued posts. This is the primary path a scheduled post relies on — the PRD's acceptance criterion ("a queued post with a past publish time is dispatched without manual invocation") depends directly on this running every minute. |
| `recover-missing-dispatch` | `* * * * *` | every 1 min | Safety net for posts claimed as `dispatched` but whose workflow never actually started (e.g. a crash between claim and `start()`). Runs at the same cadence as `dispatch` so a missed dispatch is caught almost immediately, not minutes later. |
| `webhook-delivery` | `*/2 * * * *` | every 2 min | Drains the outbound webhook delivery queue for downstream integrations. Its own backoff starts at 60s (`webhookBackoffMs`), so a 2-minute poll keeps near-real-time delivery without hammering receiver endpoints. |
| `reconcile-processing` | `*/5 * * * *` | every 5 min | Reconciles posts stuck in `processing` against the provider's live status API. `SOCIAL_RECONCILE_MIN_AGE_SECONDS` defaults to 60s (a post isn't a reconcile candidate until it's been processing for at least a minute), so polling every 5 minutes is frequent relative to that floor without adding provider-API load on every request. |
| `automation-dispatch` | `*/5 * * * *` | every 5 min | Dispatches due recurring automation tasks (rule-triggered scheduled posts). These are typically scheduled with day/hour granularity by users, so 5-minute resolution is comfortably tighter than what any automation rule would need. |
| `sweep-stuck` | `*/10 * * * *` | every 10 min | Recovers posts stuck in `publishing` for longer than `SOCIAL_STUCK_PUBLISHING_MINUTES` (default 30 min). Checking every 10 minutes gives 3 chances to catch a stuck post before the next staleness window closes, without scanning on every single-minute tick for something that by definition can't happen faster than 30 minutes. |
| `token-refresh-dispatch` | `*/10 * * * *` | every 10 min | Refreshes OAuth tokens expiring within `SOCIAL_TOKEN_REFRESH_BUFFER_MINUTES` (default 15 min). A 10-minute cadence guarantees at least one refresh attempt lands inside that 15-minute buffer even if a single run is skipped/delayed, while staying well clear of causing token expiry. |
| `cleanup` | `0 3 * * *` | daily, 03:00 UTC | Purges expired OAuth state/selection-session rows. Pure garbage collection with no user-facing urgency; scheduled off-peak. |
| `digest-dispatch` | `0 13 * * *` | daily, 13:00 UTC | Builds and dispatches the daily notification digest email. Runs once at a fixed daytime UTC hour so digest emails land at a predictable time across time zones biased toward US/EU morning hours. |

### Intentionally NOT cron-wired

- **`ops-snapshot`** (`GET`) — the health-check/observability route (see
  below). Meant to be pulled by external monitoring or an ops dashboard on
  its own cadence, not by this app's own cron.
- **`webhook-replay`** — requires an explicit `workspaceId` (and optionally a
  specific `deadLetterId`) to know what to replay; it's an operator-triggered
  remediation action for a specific tenant's dead-lettered webhooks, not a
  blind sweep a cron job could usefully drive.

## Health check: `ops-snapshot`

`GET /api/social/internal/ops-snapshot` (same shared-secret auth) returns a
point-in-time snapshot of queue depth, lag, and error indicators — e.g.
`oldestPendingWebhookDeliveryAgeSeconds`,
`oldestExpiredRefreshLeaseAgeSeconds`, and per-stage backlog counts. Point
your uptime/monitoring tool (Vercel Monitoring, Better Uptime, Datadog synthetic
check, etc.) at this route on a short interval (e.g. every 1–5 minutes) with
the same `Authorization: Bearer $SOCIAL_INTERNAL_API_SECRET` header, and
alert when lag/backlog fields exceed a threshold. This is the route referenced
by the PRD's "ops snapshot as health check" acceptance criterion.

## Required environment variables

See `.env.example` for the full list; the ones this scheduler depends on:

| Variable | Purpose |
|---|---|
| `SOCIAL_INTERNAL_API_SECRET` | Shared secret all internal routes require. |
| `CRON_SECRET` (Vercel-managed) | Set to the same value as above so Vercel's own cron auth header satisfies internal auth. Not read directly by application code. |
| `SOCIAL_DISPATCH_BATCH_SIZE`, `SOCIAL_DISPATCH_MAX_ATTEMPTS` | Tune `dispatch` batch size / retry ceiling. |
| `SOCIAL_RECOVER_BATCH_SIZE` | Batch size for `recover-missing-dispatch`. |
| `SOCIAL_STUCK_PUBLISHING_MINUTES`, `SOCIAL_STUCK_SWEEP_BATCH_SIZE`, `SOCIAL_STUCK_MAX_RECOVERY_ATTEMPTS` | Tune `sweep-stuck` staleness threshold and batch. |
| `SOCIAL_TOKEN_REFRESH_BATCH_SIZE`, `SOCIAL_TOKEN_REFRESH_BUFFER_MINUTES` | Tune `token-refresh-dispatch`. |
| `SOCIAL_WEBHOOK_DELIVERY_BATCH_SIZE`, `SOCIAL_WEBHOOK_DELIVERY_MAX_ATTEMPTS` | Tune `webhook-delivery`. |
| `SOCIAL_RECONCILE_BATCH_SIZE`, `SOCIAL_RECONCILE_MIN_AGE_SECONDS` | Tune `reconcile-processing`. |
| `SOCIAL_AUTOMATION_DISPATCH_BATCH_SIZE` | Tune `automation-dispatch` batch size. |

## Self-host fallback: QStash

If you deploy outside Vercel (or stay on Vercel Hobby and need
sub-daily cadence), use [Upstash QStash](https://upstash.com/docs/qstash)
as a scheduler. QStash calls your endpoint over plain HTTPS on a cron
schedule and can attach arbitrary headers, so it plugs into the exact same
`ensureInternalSocialAuth()` check with no route changes — just send the
shared secret as a custom header instead of relying on `CRON_SECRET`.

Example: create a QStash schedule for `dispatch` (every minute) using the
QStash CLI/API:

```bash
curl -X POST https://qstash.upstash.io/v2/schedules/https://your-app.example.com/api/social/internal/dispatch \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Upstash-Cron: * * * * *" \
  -H "Upstash-Forward-x-social-internal-secret: $SOCIAL_INTERNAL_API_SECRET" \
  -d '{}'
```

Repeat once per route in the cron table above, substituting the path and
`Upstash-Cron` expression from the table. QStash also provides built-in
retries and delivery logs, which can be useful supplementary observability
even alongside Vercel cron.

## Verifying the wiring after deploy

1. Create a social post scheduled a few minutes in the past (or use the
   product UI to schedule one for "now").
2. Wait up to 1 minute; confirm it moves to `published` (or `queued` with
   `dispatchStatus: dispatched` while the publish workflow runs) without any
   manual call to `/api/social/internal/dispatch`.
3. To prove recovery: manually set a post's `dispatchStatus` to `dispatched`
   with a `null` `workflowRunRef` (simulating a crash mid-dispatch) and
   confirm `recover-missing-dispatch` picks it up and restarts the workflow
   within a minute.
4. Call `ops-snapshot` and confirm backlog/lag fields are near zero once the
   above settles.
