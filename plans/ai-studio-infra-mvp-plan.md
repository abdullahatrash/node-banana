# Plan: AI Studio Infrastructure Foundation (MVP)

> Source PRD: `/Users/neoak/projects/node-banana/PRDS.md`
> Last updated: 2026-03-21

## Architectural decisions

Durable decisions that apply across all phases:

- **Database**: PostgreSQL as source of truth using Drizzle ORM/migrations.
- **Auth**: Better Auth with session-based authentication, workspace-scoped authorization.
- **Tenancy**: All core data scoped to `workspace_id` (projects, assets, jobs).
- **Storage**: Object storage for generated binaries (S3 for production, local filesystem fallback in development).
- **Project lifecycle**: Soft-delete for projects/assets first; hard delete/retention policies later.
- **Billing boundary**: Stripe integrated after MVP infra is stable.

---

## Implementation status snapshot

Completed on branch `feature/ui-persistence-project-browser`:

- [x] **Infra baseline shipped** (Drizzle + Postgres wiring, Better Auth integration, studio persistence foundation).
- [x] **UI persistence slice shipped** (hybrid Open Project flow: Studio browser + JSON fallback, project/assets list/open/delete).
- [x] **AuthZ hardening shipped** (workspace membership checks, role-aware delete restrictions, explicit workspace context, route coverage for projects/assets/presign).
- [x] **DB side-effects removed from file routes** (`/api/workflow` and `/api/save-generation` no longer write directly to DB).
- [x] **Protected metadata sync added** from executors/save flows to `/api/studio/assets` and `/api/studio/projects`.

Known gaps to close for infra MVP readiness:

- [ ] Add test coverage for `/api/studio/workspaces`.
- [ ] Finalize environment docs for non-dev auth requirements (`BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`) to avoid production build/runtime failures.
- [ ] Complete true end-to-end S3 upload flow in client path (presign + direct upload + finalize metadata state).
- [ ] Plan and implement account recovery hardening (password reset + magic link/OTP) after core infra MVP is complete.

---

## Phase 1: Local Infra Bootstrap

**User stories**: Team can run AI Studio locally with persistent DB state and auth wiring without breaking existing features.

### What to build

Bring up Dockerized local Postgres, wire Drizzle config/schema/migrations, and wire Better Auth routes/config while preserving current local workflow behavior.

### Acceptance criteria

- [x] `pnpm db:up` starts local Postgres.
- [x] `pnpm db:migrate` creates auth + studio base tables.
- [x] `/api/auth/*` route is available through Better Auth.
- [x] Existing AI Studio run/save flow still works.

---

## Phase 2: Project + Asset Persistence Slice

**User stories**: User can save projects, reopen old projects, and see persisted generated assets.

### What to build

Add workspace-scoped APIs for project CRUD and asset metadata CRUD; sync existing workflow/save-generation routes to DB in a non-breaking way.

### Acceptance criteria

- [x] Project create/list/get/update/delete works via `/api/studio/projects/*`.
- [x] Asset metadata create/list/get/delete works via `/api/studio/assets/*`.
- [x] Existing file-based save paths continue functioning as fallback.
- [x] Duplicate asset saves do not crash metadata sync.

---

## Phase 3: S3 Production Storage Slice

**User stories**: Generated images/videos are stored in scalable object storage and remain accessible later.

### What to build

Use S3-presigned uploads and DB metadata tracking for asset ownership, project linkage, and retrieval; keep local storage fallback for development.

### Acceptance criteria

- [x] Presign endpoint issues PUT/GET URLs when `STORAGE_BACKEND=s3`.
- [x] S3 object keys are namespaced by workspace/project.
- [~] Asset metadata is persisted before/after upload.
- [x] Users can list old assets per project and delete metadata records.

`[~]` means partially complete in backend routes; client direct-upload/finalization flow is still pending.

---

## Phase 4: AuthZ Hardening + Readiness

**User stories**: Only authorized workspace members can view/change projects and assets.

### What to build

Enforce strict session checks and workspace membership checks on all studio routes; add audit fields and baseline observability.

### Acceptance criteria

- [x] Protected endpoints reject unauthenticated requests.
- [x] Workspace membership is enforced for read/write APIs.
- [~] Error handling/logging covers DB/auth/storage failures.
- [x] Infra is ready for Stripe integration in post-MVP phase.

`[~]` indicates core logging is present, but coverage can be improved for workspace selection and workspaces endpoint tests.

---

## Phase 5: Infra Stabilization (Next)

**User stories**: Team can ship infra confidently with clear environment rules, workspace-safe flows, and predictable tests.

### What to build

Add missing test/doc coverage for workspace resolution and production auth env requirements, then validate Studio end-to-end behavior under strict auth mode.

### Acceptance criteria

- [ ] Add API tests for `/api/studio/workspaces` (`401`, `200`, dev bypass behavior).
- [ ] Update docs for required production auth env vars (`BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL`) and local dev examples.
- [ ] Add one e2e-like smoke checklist/script for: create/save project, reopen project, create/list/delete asset metadata under workspace headers.
- [ ] Verify `pnpm build` succeeds in a production-like env with required auth vars set.

---

## Phase 6: S3 End-to-End Completion (Post-Stabilization MVP)

**User stories**: Generated media is persisted to durable object storage with reliable retrieval and cleanup semantics.

### What to build

Complete client integration with presigned S3 upload flow and finalize metadata state transitions, while preserving local storage fallback.

### Acceptance criteria

- [ ] Client can request presign, upload object, and finalize asset metadata per workspace/project.
- [ ] Metadata captures upload status (`pending` -> `ready` / `failed`) and remains queryable by project.
- [ ] Local fallback path remains functional when S3 is not configured.
- [ ] Soft-delete metadata remains non-destructive; hard-delete worker remains explicitly out-of-scope for MVP.

---

## Phase 7: Auth Recovery + Passwordless Options (Post-MVP)

**User stories**: Users can recover account access safely and sign in with low-friction email flows.

### What to build

Add account recovery and passwordless authentication options on top of Better Auth so users can reset credentials or sign in without passwords when needed.

### Acceptance criteria

- [ ] Password reset request flow exists (`forgot password`) and sends time-limited email reset links.
- [ ] Password reset confirmation flow updates credentials and invalidates older active sessions.
- [ ] Email magic link sign-in works for approved origins and creates normal workspace-scoped sessions.
- [ ] Email OTP sign-in fallback is available with expiration + retry/rate-limit controls.
- [ ] Security hardening is enforced for recovery endpoints (rate limiting, non-enumerating errors, audit-safe logging).
