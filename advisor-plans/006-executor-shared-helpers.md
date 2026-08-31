# Plan 006: De-duplicate executor error handling and type the `workflowId` accessor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 330af0b..HEAD -- src/store/execution/ src/store/workflowStore.ts`
> If in-scope files changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition. (Plan 003 edits `waitForPendingImageSyncs` at
> workflowStore.ts:399-418 — that specific change is expected and harmless.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes error-path control flow in five executors; mitigated by existing executor tests)
- **Depends on**: 003 (same file region in workflowStore.ts — land 003 first to avoid conflicts)
- **Category**: tech-debt / typescript
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

Five generation executors (`nanoBanana`, `generateVideo`, `generateAudio`, `generate3d`, `llmGenerate`) each hand-roll the same two things:

1. **An identical HTTP-error parsing block** — the `if (!response.ok)` body in `nanoBananaExecutor.ts:139-154` and `generateVideoExecutor.ts:116-131` is character-for-character the same (parse JSON error, fall back to truncated text, `updateNodeData` error status, throw). A fix to error handling (new error code, different truncation, retry hint) must be repeated in five files and will drift — `generateAudioExecutor` has already diverged with a unique `errorHandled` flag the others lack.
2. **An unsafe cast to reach `workflowId`** — `NodeExecutionContext.get` is typed `() => unknown` (`types.ts:50`), so each executor does `(get() as { workflowId?: string | null } | undefined)?.workflowId ?? null`. The compiler is overruled at five sites; if the store field is ever renamed, nothing breaks at compile time — uploads silently lose their project attribution.

This plan extracts one shared helper for the error block and adds a typed `getWorkflowId` to the execution context. It deliberately does NOT attempt full consolidation of the executors' success paths — those genuinely differ per node type, and merging them is where the risk lives.

## Current state

- `src/store/execution/types.ts` — `NodeExecutionContext` interface (lines 35-51). Last two members today:

```ts
  appendOutputGalleryImage: (targetId: string, image: string) => void;
  get: () => unknown;
```

- `src/store/workflowStore.ts:966-994` — `_buildExecutionContext` constructs the context; ends with `get: get as () => unknown,` (line 993). The store state has a `workflowId` field (confirm with `grep -n "workflowId" src/store/workflowStore.ts | head`).
- The duplicated error block, verbatim in `nanoBananaExecutor.ts:139-154` and `generateVideoExecutor.ts:116-131` (and with minor variation in `generateAudioExecutor.ts`, `generate3dExecutor.ts`, `llmGenerateExecutor.ts`):

```ts
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
      }

      updateNodeData(node.id, {
        status: "error",
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }
```

- The cast sites (5): `nanoBananaExecutor.ts:101`, `generateVideoExecutor.ts:95`, `generateAudioExecutor.ts:160`, `generate3dExecutor.ts:101`, `llmGenerateExecutor.ts:66` — pattern `(get() as { workflowId?: string | null } | undefined)?.workflowId ?? null`. Re-locate with `grep -rn "workflowId?: string" src/store/execution/`.
- Existing executor tests: `src/store/execution/__tests__/` has tests for nanoBanana, generateVideo, llmGenerate (NOT generateAudio/generate3d). They mock `fetch` and assert on `updateNodeData` calls — they are the safety net for this refactor.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Executor tests | `pnpm test:run src/store/execution/__tests__` | all pass |
| Full suite | `pnpm test:run` | all pass |
| Scoped typecheck | `npx tsc --noEmit 2>&1 \| grep -E "store/execution\|store/workflowStore"` | no output |
| Lint | `pnpm lint` | exit 0 |

Note: bare `npx tsc --noEmit` has ~297 pre-existing errors in unrelated test files (plan 004). Use the scoped grep; or `pnpm typecheck` if plan 004 landed.

## Scope

**In scope**:
- `src/store/execution/httpResponseError.ts` (create) + `src/store/execution/__tests__/httpResponseError.test.ts` (create)
- `src/store/execution/types.ts` — add `getWorkflowId` to `NodeExecutionContext`
- `src/store/workflowStore.ts` — ONLY `_buildExecutionContext` (lines ~966-994)
- The five executors listed above — replace the error block and the cast; nothing else in them
- `src/store/execution/index.ts` — export the new helper if the barrel exports siblings

**Out of scope** (do NOT touch):
- The executors' success paths, history handling, cost tracking — genuinely node-specific.
- `generateAudioExecutor`'s `errorHandled` flag beyond what the helper replacement naturally removes — if removing it requires restructuring the executor's catch, leave the flag and only swap the `!response.ok` block; note it in the index.
- `simpleNodeExecutors.ts`, `splitGridExecutor.ts`, `videoProcessingExecutors.ts`, `studioAssetSync.ts`, `uploadInputAssets.ts` — different shapes; not part of the quintet.
- `waitForPendingImageSyncs` / `trackSaveGeneration` — plan 003's territory.
- Removing `get: () => unknown` from the context — other call sites may use it; you are ADDING `getWorkflowId`, not removing `get`.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b refactor/executor-shared-helpers`
- Commits: (1) helper + tests, (2) typed accessor + context, (3) one commit per executor migration. Conventional style: `refactor(execution): extract shared HTTP error handling`
- PRs target `develop`. Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the shared error helper

Create `src/store/execution/httpResponseError.ts`:

```ts
/**
 * Shared HTTP error extraction for generation executors.
 * Parses the API error envelope ({ error: string }) with a truncated-text
 * fallback, marks the node as errored, and throws.
 */
import type { WorkflowNodeData } from "@/types";

export async function throwIfResponseError(
  response: Response,
  nodeId: string,
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void,
): Promise<void> {
  if (response.ok) return;

  const errorText = await response.text();
  let errorMessage = `HTTP ${response.status}`;
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = errorJson.error || errorMessage;
  } catch {
    if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
  }

  updateNodeData(nodeId, { status: "error", error: errorMessage });
  throw new Error(errorMessage);
}
```

The behavior must be byte-equivalent to the excerpt in Current state (same message formats, same truncation at 200).

**Verify**: `npx tsc --noEmit 2>&1 | grep "httpResponseError"` → no output.

### Step 2: Unit-test the helper

Create `src/store/execution/__tests__/httpResponseError.test.ts` (pattern: sibling tests in the same directory). Cases in Test plan.

**Verify**: `pnpm test:run src/store/execution/__tests__/httpResponseError.test.ts` → all pass.

### Step 3: Add the typed `getWorkflowId` accessor

1. `src/store/execution/types.ts` — add to `NodeExecutionContext` (keep `get` as-is):
   ```ts
   /** Current workflow/project id, or null when unsaved. */
   getWorkflowId: () => string | null;
   ```
2. `src/store/workflowStore.ts` `_buildExecutionContext` — add alongside the existing members:
   ```ts
   getWorkflowId: () => get().workflowId ?? null,
   ```
   (Confirm the store field's exact name/type first; if the store types `workflowId` as `string | null` the `?? null` is redundant but harmless.)

**Verify**: `npx tsc --noEmit 2>&1 | grep -E "store/execution|store/workflowStore"` → no output. Expect test files that build a mock `NodeExecutionContext` to now FAIL typecheck for the missing member — add `getWorkflowId: () => null` to those mock contexts (in `src/store/execution/__tests__/*`); that is in scope.

### Step 4: Migrate the five executors

In each of `nanoBananaExecutor.ts`, `generateVideoExecutor.ts`, `generateAudioExecutor.ts`, `generate3dExecutor.ts`, `llmGenerateExecutor.ts`:

1. Replace the cast line with `const projectId = getWorkflowId();` (destructure `getWorkflowId` from `ctx` where the other members are destructured).
2. Replace the `if (!response.ok) { ... }` block with `await throwIfResponseError(response, node.id, updateNodeData);`.

One executor per commit; run `pnpm test:run src/store/execution/__tests__` after each.

**Verify (after all five)**: `grep -rn "workflowId?: string" src/store/execution/` → no matches; `grep -rln "throwIfResponseError" src/store/execution --include="*.ts" | grep -v __tests__ | wc -l` → 6 (helper + 5 executors).

### Step 5: Full gates

**Verify**: `pnpm test:run` → all pass; `npx tsc --noEmit 2>&1 | grep -E "store/execution|store/workflowStore"` → no output; `pnpm lint` → exit 0.

## Test plan

- `httpResponseError.test.ts`: `response.ok` true → resolves, no `updateNodeData`; 500 with JSON `{ error: "boom" }` → throws "boom", node marked error; 502 with non-JSON text body → throws `HTTP 502 - <text>` truncated to 200 chars; 404 with empty body → throws `HTTP 404`.
- Existing executor tests in `src/store/execution/__tests__/` must pass unmodified **except** for adding `getWorkflowId` to mock contexts. If any existing test asserts the exact error message format, it doubles as the byte-equivalence check — do not weaken those assertions.

## Done criteria

ALL must hold:

- [ ] `grep -rn "workflowId?: string" src/store/execution/` → no matches (all five casts gone)
- [ ] `grep -c "getWorkflowId" src/store/execution/types.ts` → 1+
- [ ] `pnpm test:run src/store/execution/__tests__` → all pass, including ≥4 new helper tests
- [ ] `pnpm test:run` → all pass
- [ ] `npx tsc --noEmit 2>&1 | grep -E "store/execution|store/workflowStore"` → no output
- [ ] `git status` → no files outside scope modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- An executor's `!response.ok` block differs **behaviorally** from the canonical excerpt (not just whitespace) — list the difference; do not silently normalize it into the helper.
- The store has no `workflowId` field, or it lives somewhere other than top-level state — report what you found instead of guessing the accessor.
- Existing executor tests fail after a migration for any reason other than the missing `getWorkflowId` mock member.
- You're tempted to also consolidate the success paths or the outer catch blocks — explicitly deferred; stop at the two replacements.

## Maintenance notes

- New generation executors should use `throwIfResponseError` and `getWorkflowId` — both are now the documented pattern (consider noting in CLAUDE.md's "Adding New Node Types" SOP).
- The deeper consolidation (shared success-path/result-dispatch, removing `generateAudio`'s `errorHandled` flag, untangling the outer catch classification) is deliberately deferred — it needs characterization tests for generateAudio/generate3d first (those two executors currently have NO tests; see advisor-plans/README.md unplanned findings).
- Reviewer should scrutinize: that the helper is awaited (it reads `response.text()`), and that no executor's catch block now double-reports errors.
