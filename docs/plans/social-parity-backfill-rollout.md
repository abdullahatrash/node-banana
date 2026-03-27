# Social Parity Backfill Rollout (Issue 15)

This runbook finalizes social parity continuity by combining additive schema hardening and an idempotent one-time backfill.

## Goals
- Keep rollout zero-downtime.
- Preserve compatibility for existing rows created before Issues 1/5/8/11/12.
- Avoid destructive or blocking schema changes.

## What ships
1. Additive migration:
   - `drizzle/0012_social_backfill_safety.sql`
   - Adds safe defaults and non-breaking indexes only.
2. One-time backfill script:
   - `scripts/db-backfill-social-parity.mjs`
   - Idempotently repairs historical social records.

## Rollout sequence
1. Deploy application code that is backward-compatible with null legacy fields.
2. Run migrations:
   - `pnpm db:migrate`
3. Run backfill dry-run:
   - `pnpm db:backfill:social -- --dry-run`
4. Review dry-run counts and proceed.
5. Run backfill apply:
   - `pnpm db:backfill:social`
6. Re-run backfill once more (optional) to verify idempotency:
   - `pnpm db:backfill:social`
7. Validate core metrics via internal ops snapshot:
   - `GET /api/social/internal/ops-snapshot?workspaceId=<id>`

## Backfill behavior
- `social_posts`
  - Fills missing `kind` with `post`.
  - Fills missing `trigger_source` using priority:
    - `chain` for chain posts
    - `automation` for posts carrying automation metadata
    - fallback `manual`
  - Fills missing `dispatch_status` by post status:
    - `queued` -> `pending`
    - `publishing/published` -> `dispatched`
    - `failed` -> `failed`
- `social_event_reads`
  - Seeds per-user read rows from legacy `social_events.read_at` where possible.
- `social_webhook_subscriptions`
  - Creates default subscription records for legacy webhooks with no subscriptions.
- `social_automation_tasks`
  - Normalizes invalid `run_index`.
  - Normalizes `task_key` toward deterministic format when safe.
  - Fills unresolved null `task_key` with unique fallback key.

## Safety notes
- Migration is additive and does not drop or rename columns/tables.
- Backfill uses guarded updates/inserts and can be run multiple times.
- Existing app traffic can continue during backfill.
