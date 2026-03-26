# Social Core Parity - Tracer Bullet Issues

Parent plan: Social Core Parity Plan (Node Banana -> Postiz-level social core), approved in-chat on 2026-03-26.

## User Stories (Reference)

1. As a workspace user, I can connect social accounts with correct OAuth callback handling.
2. As a workspace user, I can complete page/channel selection without client-side token exposure.
3. As a workspace user, publishing a post is durably dispatched and not silently dropped.
4. As a workspace user, stuck or failed publishing jobs are auto-recovered or clearly requeued.
5. As a workspace user, expiring social tokens are proactively refreshed.
6. As a workspace admin, social usage is limited by plan (channels/posts/webhooks).
7. As a workspace user, quota failures return actionable 402 responses.
8. As an operator, social lifecycle events are queryable and correlated.
9. As a workspace user, I receive lightweight notifications for publish/auth failures.
10. As an integrator, I can subscribe to signed social webhooks with retry visibility.
11. As a developer, provider adapters must pass standardized conformance tests.
12. As a workspace user, async provider publish states are reconciled to final outcomes.

## Issue Backlog

### NB-SOC-001 - OAuth Contract and Redirect URI Plumbing
Type: AFK  
Blocked by: None - can start immediately  
User stories addressed: 1

## What to build
Implement strict provider `authenticate` contract (`code`, `state`, `redirectUri`, optional `codeVerifier`) and route plumbing that always uses stored callback URL from OAuth state metadata for token exchange.

## Acceptance criteria
- [ ] Provider interface is updated to strict authenticate params and all call sites compile.
- [ ] Connect flow stores callback URL and callback flow passes that URL to provider authenticate.
- [ ] At least one provider (LinkedIn) is validated end-to-end with route tests for successful callback.
- [ ] No provider uses `state` or overloaded `codeVerifier` as redirect URI.

---

### NB-SOC-002 - Server-side Selection Session Escrow
Type: AFK  
Blocked by: NB-SOC-001  
User stories addressed: 2

## What to build
Replace callback token handoff with server-side short-lived selection session. Callback returns `{ requiresPageSelection, pages, selectionSessionId }`; select-page consumes `{ platform, pageId, selectionSessionId }`.

## Acceptance criteria
- [ ] New DB-backed selection session storage exists with expiry and one-time consumption semantics.
- [ ] Callback no longer returns access/refresh tokens to client payloads.
- [ ] Select-page endpoint accepts only `selectionSessionId` (no raw tokens).
- [ ] Social channels UI flow is updated and works for page-selection providers.
- [ ] Regression tests assert no token leakage in callback/select-page JSON responses.

---

### NB-SOC-003 - Migrate All Existing Providers to New Auth Contract
Type: AFK  
Blocked by: NB-SOC-001  
User stories addressed: 1

## What to build
Apply the new authenticate contract across all current providers (X, LinkedIn, Instagram, Facebook, TikTok, YouTube) and remove redirect URI misuse patterns.

## Acceptance criteria
- [ ] All providers compile with strict authenticate params.
- [ ] Provider unit tests are updated and passing for auth/token exchange behavior.
- [ ] Existing social route tests remain green.
- [ ] Provider docs/comments match real callback contract.

---

### NB-SOC-004 - OAuth State and Selection Session Cleanup Endpoint
Type: AFK  
Blocked by: NB-SOC-002  
User stories addressed: 1, 2

## What to build
Add protected internal cleanup endpoint for expired OAuth states and selection sessions so cron can keep auth tables clean.

## Acceptance criteria
- [ ] Internal endpoint exists and is secret-protected.
- [ ] Expired OAuth states and selection sessions are deleted in one run.
- [ ] Endpoint returns structured cleanup counts.
- [ ] Route tests validate auth protection and cleanup behavior.

---

### NB-SOC-005 - Dispatch Metadata and Non-silent Publish Failures
Type: AFK  
Blocked by: None - can start immediately  
User stories addressed: 3

## What to build
Add dispatch reliability fields to social posts (`dispatchStatus`, `dispatchAttempts`, `workflowRunRef`, `nextDispatchAt`, `lastDispatchError`, `lockedAt`) and change publish route so workflow start failure is persisted and retry-scheduled.

## Acceptance criteria
- [ ] Social post schema and repository support all new dispatch fields.
- [ ] Publish endpoint records dispatch intent and updates metadata atomically.
- [ ] Workflow start failure no longer silently logs-only; post metadata captures retry state.
- [ ] API response includes dispatch-related state needed by UI.
- [ ] Tests cover immediate start success and immediate start failure paths.

---

### NB-SOC-006 - Cron Dispatcher for Due Queued Posts
Type: AFK  
Blocked by: NB-SOC-005  
User stories addressed: 3

## What to build
Add protected internal dispatch endpoint (cron-triggered) that scans due queued posts and starts publish workflows idempotently using DB guards.

## Acceptance criteria
- [ ] Dispatcher route is secret-protected and batch-processes due posts.
- [ ] Duplicate dispatch for same post is prevented by DB-level guard/lock semantics.
- [ ] Dispatch attempts and workflow refs are persisted for each attempt.
- [ ] Route tests cover idempotency and concurrent invocation behavior.

---

### NB-SOC-007 - Stuck Publish Sweeper and Requeue Policy
Type: AFK  
Blocked by: NB-SOC-006  
User stories addressed: 4

## What to build
Add sweeper logic (internal endpoint) that finds stale `publishing` posts and transitions them to recoverable failed/requeued states according to retry policy.

## Acceptance criteria
- [ ] Stale threshold and retry policy are codified constants/config.
- [ ] Sweeper marks stuck posts deterministically and writes clear error context.
- [ ] Recoverable posts are requeued with `nextDispatchAt`; non-recoverable posts fail terminally.
- [ ] Tests verify stale detection and transitions for both recoverable and terminal cases.

---

### NB-SOC-008 - Proactive Token Refresh Dispatcher
Type: AFK  
Blocked by: NB-SOC-003  
User stories addressed: 5

## What to build
Add protected internal endpoint that scans accounts expiring within buffer and starts token-refresh workflows in controlled batches.

## Acceptance criteria
- [ ] Expiring account query and buffer window are implemented and configurable.
- [ ] Dispatcher starts token-refresh workflow idempotently per account window.
- [ ] Accounts requiring reauth are surfaced consistently after refresh failure.
- [ ] Route and workflow tests validate happy/failure paths.

---

### NB-SOC-009 - Social Plan Limits Policy (Channels, Posts, Webhooks)
Type: HITL  
Blocked by: None - can start immediately  
User stories addressed: 6

## What to build
Define and implement tiered social limits for `free`, `pro`, `enterprise`, including monthly posts and channel/webhook caps.

## Acceptance criteria
- [ ] One canonical limits map exists and is used by enforcement paths.
- [ ] Monthly usage counters are implemented for posts.
- [ ] Active channel and webhook usage checks are implemented.
- [ ] Decision note is captured for exact numeric limits and billing URL source.

---

### NB-SOC-010 - Quota Enforcement in Connect/Publish/Webhooks + Standard 402
Type: AFK  
Blocked by: NB-SOC-009  
User stories addressed: 6, 7

## What to build
Enforce plan limits in relevant social routes and return standardized 402 payload with actionable message and billing URL.

## Acceptance criteria
- [ ] `connect`, post create/publish, and webhook create paths enforce limits.
- [ ] Quota errors return consistent 402 JSON shape.
- [ ] Error payload includes actionable message and billing URL.
- [ ] Route tests verify each enforcement point and error format.

---

### NB-SOC-011 - Social Event Log and Correlated Structured Logging
Type: AFK  
Blocked by: NB-SOC-005  
User stories addressed: 8

## What to build
Introduce social event logging for lifecycle states and add consistent structured log context (`workspaceId`, `postId`, `accountId`, `provider`, `workflowRunRef`, `dispatchKey`).

## Acceptance criteria
- [ ] Event table/repository supports append and query by workspace/post/account.
- [ ] Core social routes and workflows emit structured logs with required fields.
- [ ] Key lifecycle transitions emit events (`queued`, `publishing`, `published`, `failed`, `reauth_required`, `dispatch_failed`).
- [ ] Tests cover event emission for at least publish success and publish failure paths.

---

### NB-SOC-012 - Lightweight User Notifications for Social Failures
Type: AFK  
Blocked by: NB-SOC-011  
User stories addressed: 9

## What to build
Add minimal notification path for social failure events (publish failure and account reauth required).

## Acceptance criteria
- [ ] Notification service contract exists for social event triggers.
- [ ] Publish failure and reauth-required flows emit user-visible notifications.
- [ ] Notifications include actionable context (account/provider/post).
- [ ] Tests validate trigger conditions and payload shape.

---

### NB-SOC-013 - Social Webhook Subscriptions and Signed Delivery
Type: HITL  
Blocked by: NB-SOC-010, NB-SOC-011  
User stories addressed: 10

## What to build
Implement webhook registration and signed delivery for social events, including retry/backoff and delivery history.

## Acceptance criteria
- [ ] Workspace-scoped webhook CRUD endpoints exist with secret management.
- [ ] Event-driven deliveries are signed and auditable.
- [ ] Retry/backoff and delivery status history are persisted.
- [ ] Webhook limits are enforced by plan policy.
- [ ] Integration tests validate signature verification and retries.

---

### NB-SOC-014 - Provider Conformance Test Harness
Type: AFK  
Blocked by: NB-SOC-003  
User stories addressed: 11

## What to build
Create shared conformance test suite for provider adapters covering auth contract, refresh behavior, error mapping, and publish normalization.

## Acceptance criteria
- [ ] Conformance harness can run against all providers via common fixtures.
- [ ] Required assertions are centralized (retry/refresh-token/bad-body classifications).
- [ ] Existing provider tests are mapped/ported to the harness where practical.
- [ ] CI test command includes conformance suite.

---

### NB-SOC-015 - Async Publish Reconciliation Flow
Type: AFK  
Blocked by: NB-SOC-006, NB-SOC-014  
User stories addressed: 12

## What to build
Add reconciliation flow for providers returning `processing` status so posts converge to final states (`published` or `failed`) with event and notification hooks.

## Acceptance criteria
- [ ] Reconciliation workflow/dispatcher exists for async publish providers.
- [ ] Social post state machine supports processing-to-final transitions.
- [ ] Finalization emits lifecycle events and notifications.
- [ ] Tests cover processing success and processing timeout/failure outcomes.

## Delivery Order (Recommended)
1. NB-SOC-001, NB-SOC-005, NB-SOC-009
2. NB-SOC-002, NB-SOC-003, NB-SOC-006, NB-SOC-010
3. NB-SOC-004, NB-SOC-007, NB-SOC-008, NB-SOC-011
4. NB-SOC-012, NB-SOC-013, NB-SOC-014
5. NB-SOC-015
