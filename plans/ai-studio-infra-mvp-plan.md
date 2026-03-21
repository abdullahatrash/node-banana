# Plan: AI Studio Infrastructure Foundation (MVP)

> Source PRD: `/Users/neoak/projects/node-banana/PRDS.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Database**: PostgreSQL as source of truth using Drizzle ORM/migrations.
- **Auth**: Better Auth with session-based authentication, workspace-scoped authorization.
- **Tenancy**: All core data scoped to `workspace_id` (projects, assets, jobs).
- **Storage**: Object storage for generated binaries (S3 for production, local filesystem fallback in development).
- **Project lifecycle**: Soft-delete for projects/assets first; hard delete/retention policies later.
- **Billing boundary**: Stripe integrated after MVP infra is stable.

---

## Phase 1: Local Infra Bootstrap

**User stories**: Team can run AI Studio locally with persistent DB state and auth wiring without breaking existing features.

### What to build

Bring up Dockerized local Postgres, wire Drizzle config/schema/migrations, and wire Better Auth routes/config while preserving current local workflow behavior.

### Acceptance criteria

- [ ] `pnpm db:up` starts local Postgres.
- [ ] `pnpm db:migrate` creates auth + studio base tables.
- [ ] `/api/auth/*` route is available through Better Auth.
- [ ] Existing AI Studio run/save flow still works.

---

## Phase 2: Project + Asset Persistence Slice

**User stories**: User can save projects, reopen old projects, and see persisted generated assets.

### What to build

Add workspace-scoped APIs for project CRUD and asset metadata CRUD; sync existing workflow/save-generation routes to DB in a non-breaking way.

### Acceptance criteria

- [ ] Project create/list/get/update/delete works via `/api/studio/projects/*`.
- [ ] Asset metadata create/list/get/delete works via `/api/studio/assets/*`.
- [ ] Existing file-based save paths continue functioning as fallback.
- [ ] Duplicate asset saves do not crash metadata sync.

---

## Phase 3: S3 Production Storage Slice

**User stories**: Generated images/videos are stored in scalable object storage and remain accessible later.

### What to build

Use S3-presigned uploads and DB metadata tracking for asset ownership, project linkage, and retrieval; keep local storage fallback for development.

### Acceptance criteria

- [ ] Presign endpoint issues PUT/GET URLs when `STORAGE_BACKEND=s3`.
- [ ] S3 object keys are namespaced by workspace/project.
- [ ] Asset metadata is persisted before/after upload.
- [ ] Users can list old assets per project and delete metadata records.

---

## Phase 4: AuthZ Hardening + Readiness

**User stories**: Only authorized workspace members can view/change projects and assets.

### What to build

Enforce strict session checks and workspace membership checks on all studio routes; add audit fields and baseline observability.

### Acceptance criteria

- [ ] Protected endpoints reject unauthenticated requests.
- [ ] Workspace membership is enforced for read/write APIs.
- [ ] Error handling/logging covers DB/auth/storage failures.
- [ ] Infra is ready for Stripe integration in post-MVP phase.
