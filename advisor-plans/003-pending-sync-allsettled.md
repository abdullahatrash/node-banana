# Plan 003: Make workflow save resilient to failed image syncs (Promise.all → allSettled)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 330af0b..HEAD -- src/store/workflowStore.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

Before saving a workflow, the store waits for in-flight image-sync promises (uploads of generated images) so that asset IDs are resolved in the saved file. The wait uses `Promise.all`, which **rejects on the first failed sync** — so one failed image upload makes the whole `waitForPendingImageSyncs()` call throw, which aborts the workflow save entirely. The design clearly intends best-effort behavior: the same function has a 60-second timeout that *resolves* (with a console warning) rather than rejects, specifically so saves "continue with save". A rejected sync should behave like a timed-out sync: log it and let the save proceed. Users currently lose workflow saves because of a transient upload failure.

## Current state

- `src/store/workflowStore.ts` — 2,400-line Zustand store. The relevant function is module-level, above the store definition:

```ts
// src/store/workflowStore.ts:395-418 (current)
// Track pending save-generation syncs to ensure IDs are resolved before workflow save
const pendingImageSyncs = new Map<string, Promise<void>>();

// Wait for all pending image syncs to complete (with timeout to prevent infinite hangs)
async function waitForPendingImageSyncs(timeout: number = 60000): Promise<void> {
  if (pendingImageSyncs.size === 0) return;

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`Pending image syncs timed out after ${timeout}ms, continuing with save`);
      resolve();
    }, timeout);
  });

  try {
    await Promise.race([
      Promise.all(pendingImageSyncs.values()),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
```

- Promises are registered via `trackSaveGeneration` in `_buildExecutionContext` (`src/store/workflowStore.ts:979-982`); a `.finally()` removes each entry when it settles.
- Callers of `waitForPendingImageSyncs`: find them with `grep -n "waitForPendingImageSyncs" src/store/workflowStore.ts` — they are in the save path(s); a rejection propagates up and aborts the save.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Store tests | `pnpm test:run src/store/__tests__` | all pass |
| Full suite | `pnpm test:run` | all pass |
| Scoped typecheck | `npx tsc --noEmit 2>&1 \| grep "store/workflowStore"` | no output |
| Lint | `pnpm lint` | exit 0 |

Note: a bare `npx tsc --noEmit` currently fails with ~297 pre-existing errors in unrelated test files. Do not fix those (plan 004). Use the scoped grep.

## Scope

**In scope** (the only files you should modify/create):
- `src/store/workflowStore.ts` — ONLY the `waitForPendingImageSyncs` function body (lines ~399-418)
- `src/store/__tests__/waitForPendingImageSyncs.test.ts` (create) — see Step 2 for the export it needs

**Out of scope** (do NOT touch):
- `trackSaveGeneration` / `_buildExecutionContext` (lines 966-994) — plan 006 touches that region; avoid conflicts.
- The save functions that call `waitForPendingImageSyncs` — their behavior changes automatically once the function stops rejecting.
- Anything else in the 2,400-line store.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b fix/pending-sync-allsettled`
- Commit style: conventional commits, e.g. `fix(store): don't abort workflow save when an image sync fails`
- PRs target `develop`. Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Switch to allSettled and log rejections

Replace the `try` block body of `waitForPendingImageSyncs` so the race is:

```ts
  try {
    await Promise.race([
      Promise.allSettled(pendingImageSyncs.values()).then((results) => {
        const failed = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failed.length > 0) {
          console.warn(
            `${failed.length} pending image sync(s) failed, continuing with save`,
            failed.map((r) => r.reason),
          );
        }
      }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
```

Keep the function signature, the early return, and the timeout logic exactly as they are.

**Verify**: `npx tsc --noEmit 2>&1 | grep "store/workflowStore"` → no output.

### Step 2: Export the function for testing

`waitForPendingImageSyncs` and `pendingImageSyncs` are module-private. To test without executing the whole store, export a test seam at the bottom of the module-level section (near the existing re-exports at `src/store/workflowStore.ts:421-423`):

```ts
// Test-only seam for waitForPendingImageSyncs
export const __testing = { waitForPendingImageSyncs, pendingImageSyncs };
```

Check first whether the repo already has a convention for this (`grep -rn "__testing" src/store/`); if a different convention exists, match it.

**Verify**: `npx tsc --noEmit 2>&1 | grep "store/workflowStore"` → no output.

### Step 3: Write tests, then run gates

Create `src/store/__tests__/waitForPendingImageSyncs.test.ts` (cases in Test plan). Existing store tests in `src/store/__tests__/` show the import style.

**Verify**: `pnpm test:run src/store/__tests__/waitForPendingImageSyncs.test.ts` → all pass; then `pnpm test:run` → all pass; `pnpm lint` → exit 0.

## Test plan

In the new test file (use fake timers where needed; always clear `pendingImageSyncs` in `afterEach`):

1. **Empty map** → resolves immediately.
2. **All syncs resolve** → resolves without warning.
3. **One sync rejects, one resolves (the regression)** → function RESOLVES (does not reject), `console.warn` called once mentioning `1` failed sync. This test fails against the old `Promise.all` code — verify that by stashing your change once if cheap, or by inspection.
4. **Sync hangs past timeout** → with fake timers, a never-settling promise + `timeout: 50` → resolves after advancing timers, warning mentions "timed out".

## Done criteria

ALL must hold:

- [ ] `grep -n "Promise.allSettled" src/store/workflowStore.ts` → exactly one match inside `waitForPendingImageSyncs`
- [ ] `grep -n "Promise.all(pendingImageSyncs" src/store/workflowStore.ts` → no matches
- [ ] `pnpm test:run src/store/__tests__/waitForPendingImageSyncs.test.ts` → ≥4 tests pass
- [ ] `pnpm test:run` → all pass
- [ ] `npx tsc --noEmit 2>&1 | grep "store/workflowStore"` → no output
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The function no longer matches the "Current state" excerpt (drift — plan 006 may have landed nearby).
- You find a caller that **relies on** the rejection (e.g. shows a "save failed because upload failed" dialog) — converting to best-effort would silently change UX; that needs an owner decision.
- Exporting the test seam triggers a lint rule or import-cycle error you can't resolve in one attempt.

## Maintenance notes

- If save behavior should later surface failed syncs to the user (toast instead of console.warn), this function is the single place to do it.
- Reviewer should scrutinize: the warning includes the rejection reasons (debuggability), and `clearTimeout` still runs in `finally`.
- Deferred: the broader question of retrying failed image syncs — out of scope here.
