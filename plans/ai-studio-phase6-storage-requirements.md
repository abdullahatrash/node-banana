# Phase 6 Implementation Spec: S3-Compatible End-to-End Upload (R2 Default)

> Date: 2026-03-23  
> Status: Decision-complete handoff for implementation  
> Goal: Finish the last MVP infra blocker before social/analytics

## Summary

Implement a complete upload lifecycle for generated assets:

1. `presign` (already exists) creates pending metadata
2. client uploads binary directly to S3-compatible storage
3. `finalize` marks metadata as `ready` (or `failed`)

This spec locks all major decisions so implementation requires no additional product decisions.

## Locked Decisions

- Backend interface remains `s3` (means S3-compatible API, not AWS-only).
- Default production provider is Cloudflare R2 via existing `S3_*` env contract.
- No UploadThing adoption in this phase.
- Local storage flow remains supported and non-breaking.
- Delete behavior remains metadata soft-delete only.

## Scope

### In scope

- New finalize API for pending S3 uploads.
- Client upload orchestration (`presign -> PUT -> finalize`) for generated assets.
- Metadata state machine and idempotent finalize semantics.
- R2-compatible env/cors requirements and test coverage.

### Out of scope

- Hard-delete worker for storage objects.
- UploadThing integration.
- Password recovery, billing, social, analytics.

## Current Baseline (already in repo)

- Presign API exists: `/api/studio/assets/presign`
- Presign writes `metadata.uploadState = "pending"` on asset record.
- Local metadata sync exists via `/api/studio/assets` (storageProvider `local`) in `studioAssetSync`.
- Asset delete is soft-delete only.

## API Contract Changes (Required)

## 1) Add finalize endpoint

Use existing route file and add `PATCH` handler:

- Route: `/api/studio/assets/[assetId]`
- Method: `PATCH`
- Auth: `authorizeStudioRequest(..., { action: "write" })`
- Workspace scoping: required; only asset in caller workspace may be updated.

### Request body

```json
{
  "uploadState": "ready" | "failed",
  "sizeBytes": 12345,
  "checksum": "optional-string",
  "mimeType": "optional-string",
  "error": "optional-string"
}
```

### Response body

```json
{
  "success": true,
  "asset": { "...asset row..." }
}
```

### Validation rules

- `uploadState` is required and must be `ready` or `failed`.
- `sizeBytes` if provided must be non-negative number.
- `error` is required when `uploadState = "failed"`.

### State machine rules

- Initial state after presign: `pending`.
- Allowed transitions:
  - `pending -> ready`
  - `pending -> failed`
  - `failed -> failed` (idempotent duplicate finalize only; not a new upload attempt)
  - `ready -> ready` (idempotent no-op allowed)
- Disallowed:
  - `ready -> failed` (return `409`)
  - `failed -> ready` (return `409`) in this phase.

### Retry model (locked)

- Upload retries **must create a new presign** and therefore a **new `assetId`**.
- Reusing a prior failed `assetId` for a new upload attempt is not allowed.
- Clients must not attempt to recover a failed upload by transitioning the same row from `failed -> ready`.
- Rationale: keeps finalize semantics simple/idempotent and avoids ambiguous multi-attempt history on one row.

### Metadata update rules

- Merge existing `metadata` object and set:
  - `uploadState`
  - `uploadedAt` when ready
  - `failedAt` and `uploadError` when failed
- Preserve existing metadata keys (do not wipe `originalFileName`).

## 2) Repository function additions

In `src/lib/studio/repository.ts` add asset update helper used by PATCH route:

- `finalizeAssetUpload({ workspaceId, assetId, uploadState, sizeBytes, checksum, mimeType, error })`
- Must:
  - fetch current asset in workspace
  - enforce transition rules above
  - update `metadata`, optional size/checksum/mimeType, `updatedAt`
  - return updated asset row

## 3) Error behavior

- `401` unauthenticated
- `403` wrong workspace/no access
- `404` asset not found in workspace
- `409` invalid transition
- `400` invalid payload

Keep existing response envelope shape: `{ success: false, error }`.

## Client Integration Changes (Required)

## 1) Studio client API wrappers

Extend `src/lib/studio/client.ts` with:

- `createStudioAssetPresign(input)`
- `finalizeStudioAssetUpload(assetId, input)`

Use the same `fetchApi` + workspace header path as existing studio calls.

## 2) Generated asset sync path

Extend `src/store/execution/studioAssetSync.ts` to add S3 upload branch:

- For `STORAGE_BACKEND=s3` and presign available:
  1. call presign with `projectId`, `assetType`, `contentType`, `fileName`
  2. upload binary with `PUT uploadUrl`
  3. call finalize with `ready` (+ known size/checksum if available)
- On upload failure:
  - call finalize with `failed` and error message for the **same `assetId` returned by that presign call**
  - surface non-fatal warning to UI/log

### Binary source contract (locked)

- Integration point remains `syncStudioAssetFromSaveResult` (do not refactor all executors).
- Because this boundary currently receives `saveResult.filePath`, the S3 branch must load bytes from that saved artifact path before PUT.
- Accepted implementation patterns:
  - localhost-only API route that reads the file and returns bytes, or
  - equivalent server-assisted read path.
- This prevents requiring executor-level refactors and keeps blast radius low.

Keep current local path intact as fallback:

- If storage backend is local or presign endpoint returns configuration error, continue local metadata flow unchanged.

## 3) Integration points

Do not refactor all executors. Integrate at the shared sync boundary where generated save result is already handled:

- `syncStudioAssetFromSaveResult` should decide local vs s3 upload strategy.

This minimizes blast radius and preserves existing execution behavior.

## Storage Configuration Requirements (R2 Default)

Use current env contract:

- `STORAGE_BACKEND=s3`
- `S3_BUCKET_NAME=<bucket>`
- `S3_REGION=auto` (R2 default recommendation)
- `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `S3_ACCESS_KEY_ID=<key>`
- `S3_SECRET_ACCESS_KEY=<secret>`
- `S3_FORCE_PATH_STYLE=false` (override only if provider requires)

R2 bucket must allow CORS for browser presigned upload/retrieval:

- methods: `PUT`, `GET`, `HEAD`
- allowed headers include `Content-Type` (and checksum header if later used)
- allowed origin includes app origin(s)

## Testing Requirements (Must Ship)

## API tests

Add/extend tests for `/api/studio/assets/[assetId] PATCH`:

- `401` unauthenticated
- `403` non-member
- `404` unknown asset/workspace mismatch
- `400` invalid payload
- `200` pending -> ready
- `200` pending -> failed
- `200` ready -> ready idempotent
- `409` ready -> failed
- `409` failed -> ready

## Regression tests

- Existing suites remain green:
  - `pnpm test:gate-a`
- Add/extend presign tests to assert pending metadata created with expected keys.

## Smoke tests

Extend smoke strategy with S3 mode:

- New script or mode flag: `pnpm smoke:infra` with `STORAGE_BACKEND=s3`
- Validate:
  - presign success
  - upload success
  - finalize ready
  - asset list shows finalized metadata
  - soft-delete still works

## Pending lifecycle policy (locked)

- Pending rows can orphan due to tab close/network interruption.
- Phase 6 policy:
  - Keep orphan rows (no hard-delete worker in this phase).
  - Add `pendingExpiresAt` metadata at presign time with a fixed 24h window.
  - Treat rows older than `pendingExpiresAt` as stale-operationally (eligible for janitor/cleanup in post-MVP phase).
- Full automatic cleanup worker remains out-of-scope for Phase 6 and moves to post-MVP backlog.

## Docs Requirements

Update README + env docs:

- clarify `s3` means S3-compatible storage
- recommend R2 defaults
- include CORS note for presigned uploads
- include Phase 6 verification commands

## Acceptance Criteria (Phase 6 Done)

- Generated asset upload to S3-compatible storage works end-to-end with metadata state transitions.
- Failures are visible and recorded as `failed` state without corrupting records.
- Local fallback path remains functional.
- Gate A suite remains green, and new finalize/s3 tests are green.
- Smoke in S3 mode passes in local dev with configured bucket.

## Execution Order (Implementation Sequence)

1. Add repository finalize helper + transition rules.
2. Add PATCH finalize route.
3. Add studio client finalize/presign wrappers.
4. Add S3 upload branch in studio asset sync boundary.
5. Add tests (API + regression).
6. Update docs.
7. Run full verification (`test:gate-a`, new tests, smoke local+s3).

## Notes on UploadThing (Decision Record)

UploadThing remains deferred because Phase 6 requires minimal-risk completion on existing storage ownership architecture. Consider a post-MVP spike only if we want managed upload orchestration.

## Post-Phase Addendum (Audit + Updated Plan)

> Date: 2026-03-24  
> Status: Decision-complete for next increments (`6b`, `6c`)  
> Scope: Quota fairness, usage warning UX, and asset portability clarifications

### Audit Snapshot (Current Repo State)

- Phase 6 S3 generated-asset lifecycle is implemented (`presign -> PUT -> finalize` for generated outputs).
- `pendingExpiresAt` fixed 24h metadata is implemented on presign.
- Quota enforcement is **not** implemented yet:
  - no `workspace_storage_limits` table
  - no `expectedSizeBytes` in presign contract
  - no presign-time quota projection lock/check
- User download is supported in UI (`OutputNode` download action).
- Local filesystem integration exists (directory picker + localhost-only file routes).
- Cross-device portability is partial:
  - generated assets are synced to S3 in `STORAGE_BACKEND=s3`
  - user-uploaded input assets are still persisted via local workflow image storage paths (`/api/workflow-images`) and node base64/refs, so they are not fully cloud-portable yet.

### Locked Direction (Reconfirmed)

- Shared bucket is acceptable; fairness is enforced per workspace in app/data layer.
- `6b`: hard quota block at presign time, default 10 GB/workspace.
- `6c`: add usage visibility/warnings and complete cloud-portable handling for user-uploaded input assets.
- Keep local fallback behavior non-breaking for local/dev workflows.

## Phase 6b: Workspace Storage Quotas (Implementation Plan)

### Data model + migration

- Add `workspace_storage_limits` table:
  - `workspace_id` (PK/FK to `workspaces.id`)
  - `quota_bytes` (`bigint`, required)
  - `updated_at` (timestamp with timezone)
- Backfill all existing workspaces with `10 * 1024 * 1024 * 1024` bytes.
- Ensure workspace provisioning paths insert quota row idempotently.

### Presign contract + enforcement (`POST /api/studio/assets/presign`)

- Request body adds required `expectedSizeBytes` (non-negative integer).
- Return `400` for missing/invalid `expectedSizeBytes`.
- Enforce under one DB transaction:
  - `pg_advisory_xact_lock(hash(workspace_id))`
  - compute `ready_used_bytes`: non-deleted S3 assets in `ready`
  - compute `pending_reserved_bytes`: non-deleted S3 `pending` assets with unexpired `pendingExpiresAt`, summing `metadata.expectedSizeBytes`
  - `projected = ready_used_bytes + pending_reserved_bytes + expectedSizeBytes`
  - compare against `quota_bytes`
- If `projected > quota_bytes`:
  - return `403`, no asset row created
- If allowed:
  - continue presign flow
  - persist pending metadata with:
    - `uploadState: "pending"`
    - `pendingExpiresAt` (24h fixed)
    - `expectedSizeBytes`

### Client + smoke updates

- `createStudioAssetPresign` input type requires `expectedSizeBytes`.
- `syncStudioAssetFromSaveResult` reads file blob first, then presigns with exact `blob.size`.
- Update `scripts/smoke-infra.sh` S3 presign payload to include `expectedSizeBytes`.

### Phase 6b tests

- Presign route:
  - `400` missing/invalid `expectedSizeBytes`
  - `403` projected exceeds quota
  - `200` projected within quota
  - boundary `projected == quota` allowed
  - expired pending excluded
  - pending metadata includes `expectedSizeBytes` and `pendingExpiresAt`
- Regression: existing finalize/state tests remain green.

## Phase 6c: Usage Warnings + Input Asset Portability

### 1) Quota usage visibility and warnings

- Add workspace usage read API (or enrich existing workspace payload) returning:
  - `quotaBytes`
  - `readyUsedBytes`
  - `pendingReservedBytes`
  - `effectiveUsedBytes` (`ready + pending`)
  - `remainingBytes`
  - `usagePercent`
  - `warningLevel` (`none | low | medium | high | critical`)
- Warning thresholds (locked for this phase):
  - `low`: `>= 80%`
  - `medium`: `>= 90%`
  - `high`: `>= 95%`
  - `critical`: `>= 99%`
- UI behavior:
  - show passive usage meter in Studio shell
  - show non-blocking warning banner/toast when crossing threshold
  - show blocking error when presign returns quota exceeded (`403`)

### 2) Cloud-portable user input assets

- Goal: when workspace uses S3 mode, user-uploaded input assets (image/audio) become workspace assets in object storage, not local-only workflow files.
- Add client upload path for input nodes:
  - on file selection, compute bytes
  - call presign (`expectedSizeBytes`)
  - direct PUT
  - finalize `ready`
  - persist node reference to Studio asset identity (assetId/key), not only local imageRef/base64
- Hydration/load behavior:
  - if node has studio asset reference, load via server-mediated asset URL/read path
  - if not, keep existing local ref/base64 behavior (backward compatibility)
- Save/load compatibility:
  - existing workflow JSON remains readable
  - legacy local refs still hydrate via `/api/workflow-images`
  - new S3-backed refs hydrate without requiring the same local disk path

### 3) Phase 6c tests

- API usage tests for threshold calculations and warning levels.
- Presign response/UI integration tests for quota warning/exceeded states.
- Input-node integration tests:
  - upload file in S3 mode -> asset recorded/finalized
  - workflow reload on different machine/session resolves input asset from workspace storage
  - local mode behavior unchanged.

## Env Var Impact (Locked)

- No new required environment variables for `6b` or `6c`.
- Existing storage envs remain:
  - `STORAGE_BACKEND=s3`
  - `S3_BUCKET_NAME`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Default quota is DB-backed fixed `10 GB` per workspace in this phase (admin override via DB/script, not env).
