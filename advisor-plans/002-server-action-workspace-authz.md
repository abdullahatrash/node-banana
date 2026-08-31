# Plan 002: Validate workspace membership in studio server actions (IDOR fix)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 330af0b..HEAD -- src/app/studio/actions.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

Next.js server actions are public HTTP endpoints. Three actions in `src/app/studio/actions.ts` — `fetchProjects(workspaceId)`, `fetchProjectDetail(workspaceId, projectId)`, and `deleteProject(workspaceId, projectId)` — accept a caller-supplied `workspaceId` and never verify the authenticated user is a member of that workspace. The helper they call, `requireWorkspace()`, only ensures the user has *a personal workspace* (creating one if missing); it ignores the `workspaceId` argument entirely. Any authenticated user who obtains or guesses another workspace's ID can list its projects, read full project detail **including `workflowJson` and asset storage keys**, and soft-delete its projects. This is a cross-tenant IDOR with a destructive variant.

The API routes are NOT affected: `authorizeStudioRequest` resolves `x-workspace-id` against the user's own membership list (`getWorkspaceCandidates(userId)` in `src/lib/studio/authz.ts:191-251`). The server actions are the one path that bypasses this. After this plan, every action that takes a `workspaceId` verifies membership and throws otherwise.

## Current state

- `src/app/studio/actions.ts` (226 lines) — five exported server actions: `fetchWorkspaces()` (safe — filters by `user.id`), `fetchProjects`, `fetchProjectDetail`, `deleteProject` (all three vulnerable), `deleteAsset` (safe by accident — see Out of scope).

The broken helper and one vulnerable action:

```ts
// src/app/studio/actions.ts:62-69 (current)
async function requireWorkspace(userId: string, userName: string | null, userEmail: string | null) {
  const { workspaceId } = await ensurePersonalWorkspaceForUser({
    userId,
    userName,
    userEmail,
  });
  return workspaceId;
}
```

```ts
// src/app/studio/actions.ts:133-139 (current — note workspaceId is trusted)
export async function fetchProjects(workspaceId: string): Promise<SAProjectSummary[]> {
  if (!isDatabaseConfigured()) return [];

  const user = await requireUser();
  await requireWorkspace(user.id, user.name, user.email);

  const rows = await listProjects(workspaceId);
```

`fetchProjectDetail` (lines 153-165) and `deleteProject` (lines 197-205) follow the same shape: `requireUser()` → `requireWorkspace(...)` (result discarded) → repository call with the caller's `workspaceId`.

- The file already imports everything needed for a membership check (lines 3-14): `getDb`, `workspaceMembers`, `workspaces` from the schema, and `and, eq, isNull` from drizzle-orm. The membership-check query shape to copy already exists in this same file:

```ts
// src/app/studio/actions.ts:85-99 (existing pattern in fetchWorkspaces — reuse this WHERE shape)
  let rows = await db
    .select({ ... })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, user.id),
        isNull(workspaces.deletedAt),
      ),
    );
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm test:run src/app/studio/__tests__/actions.test.ts` | all pass |
| Gate-A | `pnpm test:gate-a` | all pass |
| Full suite | `pnpm test:run` | all pass |
| Scoped typecheck | `npx tsc --noEmit 2>&1 \| grep "app/studio/actions"` | no output |
| Lint | `pnpm lint` | exit 0 |

Note: a bare `npx tsc --noEmit` currently fails with ~297 pre-existing errors in unrelated test files. Do not fix those (plan 004). Use the scoped grep.

## Scope

**In scope** (the only files you should modify/create):
- `src/app/studio/actions.ts`
- `src/app/studio/__tests__/actions.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/lib/studio/authz.ts` and `src/lib/studio/repository.ts` — correct as-is; the fix belongs at the action boundary.
- `deleteAsset(assetId)` (lines 207-225) — it resolves the user's own personal workspace and filters the UPDATE by it, so it cannot delete cross-workspace. Its semantics (only works for personal-workspace assets) are a known quirk; changing its signature would ripple into callers. Leave it.
- Any caller components of these actions — signatures do not change.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b fix/server-action-workspace-authz`
- Commit style: conventional commits, e.g. `fix(studio): verify workspace membership in server actions`
- PRs target `develop`. Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a membership-validation helper

In `src/app/studio/actions.ts`, below `requireWorkspace`, add:

```ts
async function requireWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error("You do not have access to this workspace.");
  }
}
```

**Verify**: `npx tsc --noEmit 2>&1 | grep "app/studio/actions"` → no output.

### Step 2: Enforce it in the three vulnerable actions

In `fetchProjects`, `fetchProjectDetail`, and `deleteProject`, after `const user = await requireUser();`, add `await requireWorkspaceMembership(user.id, workspaceId);`.

In these three actions the existing `await requireWorkspace(user.id, user.name, user.email);` call only side-effects personal-workspace creation and its result is discarded — **remove it from these three actions** (keep the `requireWorkspace` function itself; `deleteAsset` still uses it). Membership in a real workspace is now the actual precondition.

**Verify**: `npx tsc --noEmit 2>&1 | grep "app/studio/actions"` → no output, and `grep -c "requireWorkspaceMembership" src/app/studio/actions.ts` → 4 (1 definition + 3 call sites).

### Step 3: Write tests

Create `src/app/studio/__tests__/actions.test.ts`. Mock `next/headers` (`headers()` returning a dummy `Headers`), `@/lib/auth/session` (`getAuthenticatedUserFromHeaders`), `@/lib/db` (`getDb`, `isDatabaseConfigured`), and `@/lib/studio/repository` (`listProjects`, `getProject`, `softDeleteProject`, `listProjectAssets`, `ensurePersonalWorkspaceForUser`). For the membership query, have the mocked `getDb()` return a chainable stub whose `.limit(1)` resolves to `[]` or `[{ workspaceId: "ws_1" }]` per test. Use `src/app/api/studio/projects/__tests__/route.test.ts` as the structural pattern for mocking style.

Cases are listed in the Test plan.

**Verify**: `pnpm test:run src/app/studio/__tests__/actions.test.ts` → all pass.

### Step 4: Run the broader gates

**Verify**: `pnpm test:gate-a` → all pass. `pnpm test:run` → all pass. `pnpm lint` → exit 0.

## Test plan

In `src/app/studio/__tests__/actions.test.ts`:

1. **Unauthenticated** → `fetchProjects("ws_1")` rejects with "Not authenticated." and `listProjects` not called.
2. **Non-member (the regression this plan fixes)** → authenticated user, membership query returns `[]` → `fetchProjects("ws_other")` rejects with "You do not have access to this workspace." and `listProjects` NOT called. Same assertion for `fetchProjectDetail` (and `getProject` not called) and `deleteProject` (and `softDeleteProject` not called).
3. **Member happy path** → membership query returns a row → `fetchProjects` returns mapped summaries; `deleteProject` resolves when `softDeleteProject` returns truthy.
4. **`deleteProject` not-found** → membership OK, `softDeleteProject` returns false → rejects with "Project not found."
5. **DB not configured** → `fetchProjects` returns `[]` without calling auth.

## Done criteria

ALL must hold:

- [ ] `grep -c "requireWorkspaceMembership" src/app/studio/actions.ts` → `4`
- [ ] `pnpm test:run src/app/studio/__tests__/actions.test.ts` → all pass (≥8 tests)
- [ ] `pnpm test:run` → all pass
- [ ] `npx tsc --noEmit 2>&1 | grep "app/studio/actions"` → no output
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `actions.ts` no longer matches the "Current state" excerpts (drift).
- You find a caller that passes a workspaceId the user is legitimately NOT a member of (e.g. a public-sharing feature) — the membership requirement would break it; that needs an owner decision.
- The drizzle chainable-mock approach fights you for more than two attempts — report rather than weakening assertions to "doesn't throw".

## Maintenance notes

- Any **new** server action that accepts a `workspaceId` must call `requireWorkspaceMembership` — reviewers should make this a checklist item. (Plan 005's route wrapper covers API routes; server actions have no equivalent wrapper — if more actions accumulate, consider extracting one.)
- If role-based restrictions are wanted later (e.g. only owner/admin may `deleteProject`), extend the helper to return the member's `role` and check it — `STUDIO_ROLE_PERMISSIONS` in `src/lib/studio/authz.ts:87` is the reference.
- Reviewer should scrutinize: that `requireWorkspace` removal didn't break `deleteAsset` (it must keep using it), and that error messages don't leak workspace existence (the generic "no access" message is intentional — same response whether the workspace exists or not).
