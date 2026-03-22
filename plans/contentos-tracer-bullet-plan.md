# Plan: ContentOS Multi-Phase Tracer Bullet Implementation

> Source PRD: `/Users/neoak/projects/node-banana/PRDS.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: Use stable domain route namespaces: `/api/studio/*`, `/api/social/*`, `/api/analytics/*`, `/api/canvas/*`, `/api/auth/*`, `/api/billing/*`.
- **Schema**: Use PostgreSQL with tenant-first schema design; all domain records are workspace-scoped where applicable.
- **Key models**: `users`, `workspaces`, `workspace_members`, `social_accounts`, `posts`, `post_variants`, `media_assets`, `generation_jobs`, `brand_kits`, `account_metrics`, `post_metrics`, `competitors`, `canvases`, `cards`.
- **Auth/AuthZ**: Workspace-aware authentication and authorization on every protected API boundary.
- **Async architecture**: Background workers for long-running generation, scheduling/publishing, analytics collection, and digest jobs.
- **Storage boundaries**: Object storage for media binaries; relational DB for metadata, ownership, status, and reporting.
- **Provider boundaries**: External AI and social platform integrations are behind adapter boundaries to isolate provider changes.

---

## Phase 1: Foundation Slice (MVP)

**User stories**: Users can sign up, access a workspace, and have persistent account/workspace context across sessions.

### What to build

Deliver one complete, production-style path for identity and tenancy: a user can authenticate, enter a workspace-scoped app shell, and perform scoped operations with durable storage.

### Acceptance criteria

- [ ] User can sign in and access an authenticated workspace context.
- [ ] Workspace membership and role checks are enforced for protected operations.
- [ ] Core workspace metadata persists in the primary database.
- [ ] API boundaries reject unauthenticated and unauthorized requests correctly.

---

## Phase 2: AI Studio Core Reliability Slice (MVP)

**User stories**: Users can create and run an AI workflow end-to-end (prompt/image input to generated output), save result assets, and rerun reliably.

### What to build

Ship a thin but complete AI Studio path: start from a project/workspace, run a generation workflow, receive output with clear status and error handling, and persist/reload generated assets and workflow state.

### Acceptance criteria

- [ ] A user can execute a minimal workflow from input to output successfully.
- [ ] Workflow execution state and failure states are clear, actionable, and recoverable.
- [ ] Generated media and workflow state persist and reload without manual repair.
- [ ] End-to-end automated tests cover happy path plus key failure paths.

---

## Phase 3: Social Hub Connect + Publish Slice (MVP)

**User stories**: Users can connect at least one social account and publish generated content directly.

### What to build

Deliver a complete first publishing loop: connect one platform account, select generated media, and publish one adapted post with status visibility.

### Acceptance criteria

- [ ] User can connect/disconnect one target platform account through OAuth.
- [ ] User can publish one generated asset with platform-specific formatting.
- [ ] Publish status transitions are visible (`draft` to `published`/`failed`).
- [ ] Publish failures are retriable with clear error reasons.

---

## Phase 4: Social Hub Scheduling Slice (MVP)

**User stories**: Users can schedule posts, preview platform variants, and rely on automated publish execution.

### What to build

Add scheduling as an end-to-end slice: create scheduled posts, show queue/calendar view, execute via worker, and update post outcomes automatically.

### Acceptance criteria

- [ ] User can schedule posts for future publish times.
- [ ] User can preview per-platform post variants before scheduling.
- [ ] Scheduled jobs are executed automatically and update post status reliably.
- [ ] Retry/backoff policy handles transient platform failures.

---

## Phase 5: Analytics Dashboard Slice (MVP)

**User stories**: Users can view unified performance metrics for connected accounts and posts.

### What to build

Ship one complete analytics loop: ingest own-account/post metrics on schedule, normalize to shared schema, and display a usable dashboard with key trends.

### Acceptance criteria

- [ ] Metrics ingestion runs on schedule for connected accounts.
- [ ] Normalized metrics are persisted and queryable by workspace and timeframe.
- [ ] Dashboard shows core metrics and top-performing content.
- [ ] Data freshness windows are visible to the user.

---

## Phase 6: Billing + Launch Hardening Slice (MVP)

**User stories**: Users can subscribe to plans, stay within limits, and use a stable production-ready product.

### What to build

Deliver monetization and readiness as one vertical slice: subscription lifecycle, plan-based entitlements/limits, operational visibility, and launch-grade guardrails.

### Acceptance criteria

- [ ] Users can start/manage subscription plans.
- [ ] Plan limits are enforced for generation and connected-account usage.
- [ ] Entitlement checks are consistently applied across major product paths.
- [ ] Production monitoring and error reporting are active for critical flows.

---

## Phase 7: AI Studio Brand Kit + Templates Slice (Post-MVP)

**User stories**: Users can define a brand kit and generate consistently on-brand content from templates.

### What to build

Add brand consistency and faster content creation via brand profile persistence, template workflows, and reusable generation presets.

### Acceptance criteria

- [ ] User can configure and update brand kit settings.
- [ ] Template-driven generation uses brand defaults consistently.
- [ ] Generated outputs can be produced in platform-ready formats.
- [ ] Brand/template usage is workspace-scoped and reusable.

---

## Phase 8: Analytics Competitor + Weekly Digest Slice (Post-MVP)

**User stories**: Users can track competitor performance and receive recurring AI-driven insights.

### What to build

Complete the intelligence loop with competitor tracking, comparative trend analysis, and scheduled digest generation.

### Acceptance criteria

- [ ] User can configure and track competitor profiles.
- [ ] Competitor metrics are collected and normalized on schedule.
- [ ] Weekly digest is generated with actionable recommendations.
- [ ] Comparative insights surface clear opportunities and gaps.

---

## Phase 9: Canvas Workspace Slice (Lowest Priority / Post-MVP)

**User stories**: Users can plan campaigns and strategy in a card-based infinite canvas linked to their content workflow.

### What to build

Deliver a planning canvas slice with core card operations, linking, persistence, and basic AI-assisted card creation.

### Acceptance criteria

- [ ] User can create/edit/reposition core card types on an infinite canvas.
- [ ] Card relationships and organization persist reliably.
- [ ] Canvas state is workspace-scoped and reloads correctly.
- [ ] Basic AI-assisted card generation works end-to-end.

