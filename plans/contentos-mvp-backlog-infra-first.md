# Plan: ContentOS MVP Execution Backlog (Infrastructure First)

> Source PRD: `/Users/neoak/projects/node-banana/PRDS.md`  
> Derived from: `/Users/neoak/projects/node-banana/plans/contentos-tracer-bullet-plan.md`

## Priority Rule

MVP execution is **infra-first**:

1. Infrastructure + platform foundation
2. AI Studio core reliability
3. Social publishing path
4. Scheduling automation
5. Analytics dashboard
6. Billing + launch hardening

Post-MVP items (brand kit/templates, competitor digest, canvas workspace) are intentionally excluded from this backlog.

---

## MVP Backlog (Ordered)

### 1) Infrastructure Foundation (Top Priority)

**Goal**: Establish production-capable platform rails before feature expansion.

**Vertical slice outcome**: Authenticated workspace user can hit protected APIs with persistent workspace-scoped storage and operational visibility.

**Includes**
- Auth + session foundation with workspace context
- PostgreSQL + migrations + tenant-aware core schema
- Object storage for media assets
- Queue/worker foundation for async jobs
- Environment/secret configuration model
- Error monitoring + baseline product telemetry

**Exit criteria**
- [ ] Protected API requests enforce auth + workspace membership
- [ ] Core workspace/user records persist in Postgres
- [ ] Media write/read path works via object storage
- [ ] At least one background job executes successfully in worker runtime
- [ ] Monitoring captures API and worker errors

---

### 2) AI Studio Core Reliability (MVP)

**Goal**: Make AI workflow run end-to-end reliably on top of infra.

**Vertical slice outcome**: User creates/runs a simple workflow (input -> generate -> output), saves assets, reloads, reruns.

**Exit criteria**
- [ ] Happy path runs end-to-end with clear statuses
- [ ] Save/reload/rerun is stable
- [ ] Error states are actionable (key missing, provider error, timeout)
- [ ] Automated coverage includes core flow + key failures

---

### 3) Social Connect + Immediate Publish (MVP)

**Goal**: First distribution loop from generated content to one platform.

**Vertical slice outcome**: User connects one social account and publishes one generated post.

**Exit criteria**
- [ ] OAuth connect/disconnect works for first target platform
- [ ] Generated content can be published from app
- [ ] Post status lifecycle is visible and persisted
- [ ] Failed publish is retriable

---

### 4) Social Scheduling + Worker Execution (MVP)

**Goal**: Convert manual publish to scheduled automated delivery.

**Vertical slice outcome**: User schedules platform variants and jobs execute automatically at scheduled time.

**Exit criteria**
- [ ] User can schedule future posts
- [ ] Preview/variant flow is available before scheduling
- [ ] Worker executes due posts and updates statuses
- [ ] Retry/backoff handles transient failures

---

### 5) Analytics Dashboard (MVP)

**Goal**: Provide core performance visibility for connected accounts/posts.

**Vertical slice outcome**: User sees normalized metrics and top-performing content in one dashboard.

**Exit criteria**
- [ ] Scheduled metrics collection runs for connected accounts
- [ ] Metrics are normalized and queryable by workspace/time range
- [ ] Dashboard renders core account + post KPIs
- [ ] Data freshness is visible to user

---

### 6) Billing + Launch Hardening (MVP)

**Goal**: Monetize safely and launch with guardrails.

**Vertical slice outcome**: Subscription plans control usage/entitlements across key workflows.

**Exit criteria**
- [ ] Subscription lifecycle works (start/change/cancel)
- [ ] Plan limits enforced in generation/social usage paths
- [ ] Entitlements consistently checked in protected flows
- [ ] Production readiness checks pass (errors, retries, observability)

---

## Week-by-Week Delivery Sequence (Infra-First)

## Week 1-2: Infrastructure Foundation
- Deliver backlog item 1 end-to-end
- Freeze non-foundational feature work except critical fixes

## Week 3-4: AI Studio Core Reliability
- Deliver backlog item 2
- Add regression suite for run/save/reload/rerun

## Week 5: Social Connect + Immediate Publish
- Deliver backlog item 3 for first platform

## Week 6: Social Scheduling
- Deliver backlog item 4
- Validate worker reliability under retry scenarios

## Week 7: Analytics Dashboard
- Deliver backlog item 5
- Validate data quality and dashboard freshness

## Week 8: Billing + Launch Hardening
- Deliver backlog item 6
- Final MVP stabilization and release checklist

---

## Dependency Gates

- **Gate A (after Week 2)**: No feature slice starts until infra foundation exit criteria are met.
- **Gate B (after Week 4)**: Social slice starts only after AI workflow reliability is green.
- **Gate C (after Week 6)**: Analytics starts only after scheduling worker reliability is validated.
- **Gate D (after Week 8)**: MVP release only if billing limits + observability checks pass.

---

## MVP Release Checklist

- [ ] Infra foundation fully complete (auth/db/storage/queue/monitoring)
- [ ] AI workflow end-to-end stable with automated regression coverage
- [ ] Social publish + schedule loop verified in production-like environment
- [ ] Analytics dashboard populated with real collected metrics
- [ ] Billing and plan-limit enforcement active
- [ ] Critical-path error budgets and alerting in place

