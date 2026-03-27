# Social Parity Remaining Issues (Node Banana -> Postiz-Level)

This file tracks the remaining social backend parity slices as independently grabbable implementation issues.

## Issue 1: Dispatch Idempotency Ledger
- Type: AFK
- Blocked by: None
- User stories: US2 durable dispatch, US4 observability
- Status: Completed
- Scope:
  - Add `social_dispatch_runs` with unique `dispatch_key`.
  - Record dispatch intent before workflow start.
  - Enforce conflict-safe duplicate start behavior.

## Issue 2: Dispatcher Concurrency Gate Enforcement
- Type: AFK
- Blocked by: Issue 1
- User stories: US2 durable dispatch
- Status: Completed
- Scope:
  - Enforce provider `maxConcurrentJobs` during dispatch.
  - Reserve and release concurrency slots atomically.

## Issue 3: Missing-Dispatch Recovery Scanner
- Type: AFK
- Blocked by: Issue 1
- User stories: US2 self-healing
- Status: Completed
- Scope:
  - Add protected internal recovery endpoint.
  - Re-dispatch orphaned queued+dispatched posts safely.

## Issue 4: Token Refresh Lease Ownership
- Type: AFK
- Blocked by: Issue 1
- User stories: US2 token durability, US4 observability
- Status: Completed
- Scope:
  - Add per-account refresh lease/idempotency model.
  - Prevent duplicate refresh workflows.

## Issue 5: Per-User Notification Read Model
- Type: AFK
- Blocked by: None
- User stories: US4 user-visible failures
- Status: Completed
- Scope:
  - Add `social_event_reads (event_id, user_id)`.
  - Move read/unread semantics to per-user APIs.

## Issue 6: Notification Preferences + Digest Eligibility
- Type: AFK
- Blocked by: Issue 5
- User stories: US4 notifications
- Status: Completed
- Scope:
  - Add `social_notification_preferences`.
  - Apply preference-aware event eligibility.

## Issue 7: Digest Dispatch Internal Workflow
- Type: AFK
- Blocked by: Issue 6
- User stories: US4 notifications
- Status: Completed
- Scope:
  - Add protected digest dispatcher endpoint.
  - Batch and de-duplicate digest sends.

## Issue 8: Webhook Subscription Filters
- Type: AFK
- Blocked by: None
- User stories: US4 webhooks
- Status: Completed
- Scope:
  - Add `social_webhook_subscriptions` filters.
  - Fanout only to matching subscriptions.

## Issue 9: Webhook Dead-Letter + Replay Control Plane
- Type: AFK
- Blocked by: Issue 8
- User stories: US4 webhooks reliability
- Status: Completed
- Scope:
  - Classify terminal failures into dead-letter.
  - Add replay endpoint with idempotency key + audit trail.

## Issue 10: Webhook URL Hardening
- Type: AFK
- Blocked by: None
- User stories: US4 security
- Status: Completed
- Scope:
  - Enforce HTTPS.
  - Reject localhost/private-network destinations.

## Issue 11: Post Chain Orchestration (Root + Delayed Children)
- Type: AFK
- Blocked by: Issue 1
- User stories: US5 behavioral parity
- Status: Completed
- Scope:
  - Extend social post model with chain context.
  - Add deterministic child scheduling behavior.

## Issue 12: Repeat Automation Rules + Task Queue
- Type: AFK
- Blocked by: Issue 11
- User stories: US5 automation parity
- Status: In Progress
- Scope:
  - Add `social_automation_rules` and `social_automation_tasks`.
  - Implement deterministic task key + duplicate-safe claiming.

## Issue 13: Automation Trigger Guards
- Type: AFK
- Blocked by: Issue 12
- User stories: US5 automation safety
- Status: Planned
- Scope:
  - Loop prevention.
  - Max limits and tenant isolation guards.

## Issue 14: Ops Snapshot Endpoints
- Type: AFK
- Blocked by: Issue 1, Issue 9
- User stories: US4 observability
- Status: Completed
- Scope:
  - Add protected ops snapshot endpoints for social internals.

## Issue 15: Backfill + Migration Safety Slice
- Type: AFK
- Blocked by: Issue 1, Issue 5, Issue 8, Issue 11, Issue 12
- User stories: US2/US4/US5 continuity
- Status: In Progress
- Scope:
  - Add additive migrations + safe defaults.
  - Add backfill steps for nullable compatibility fields.
