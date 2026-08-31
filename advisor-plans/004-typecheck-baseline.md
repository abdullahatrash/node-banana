# Plan 004: Establish a green `tsc --noEmit` baseline and a `typecheck` script

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `npx tsc --noEmit 2>&1 | grep -c "error TS"` —
> this plan was written when the count was **297**. If it is now 0, mark this
> plan DONE-by-others in the index and stop. If it is wildly different
> (e.g. >400), re-derive the per-file breakdown in Step 1 before proceeding.

## Status

- **Priority**: P2
- **Effort**: M–L (large but mechanical)
- **Risk**: LOW
- **Depends on**: none (but coordinate: plans 001–003, 005, 006 each keep their own scope typecheck-clean)
- **Category**: dx / typescript
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

The repo has `strict: true` but **no working typecheck gate**: there is no `typecheck` script in `package.json`, and a bare `npx tsc --noEmit` fails with 297 errors. Nearly all are in test files — component tests under `src/components/__tests__/` (e.g. 33 errors in `GenerateVideoNode.test.tsx`, 28 in `GenerateImageNode.test.tsx`) and store-util tests (e.g. `src/store/utils/__tests__/localStorage.test.ts:159` passes `{ workflowId, totalCost }` where `WorkflowCostData` also requires `incurredCost` and `lastUpdated`). This is type drift: the production types evolved and the test fixtures didn't. The consequences are concrete: nobody can use `tsc` as a pre-merge gate, every other improvement plan in this directory has to use scoped greps instead of a clean exit code, and tests are silently asserting against stale shapes — which is exactly how a refactor breaks behavior without any test noticing the type change. After this plan, `pnpm typecheck` exists, exits 0, and CI can enforce it.

## Current state

- `tsconfig.json` — `strict: true`, `noEmit: true`, includes `**/*.ts`/`**/*.tsx` (test files are type-checked; there is no test-excluding tsconfig).
- `package.json` scripts — `lint`, `test`, `test:run`, `test:gate-a` exist; **no `typecheck`**.
- Error distribution (measured at planning time, top files):

```
33 src/components/__tests__/GenerateVideoNode.test.tsx
28 src/components/__tests__/GenerateImageNode.test.tsx
27 src/components/__tests__/OutputNode.test.tsx
23 src/components/__tests__/GroupNode.test.tsx
21 src/components/__tests__/SplitGridNode.test.tsx
21 src/components/__tests__/AnnotationNode.test.tsx
18 src/components/__tests__/EaseCurveNode.test.tsx
16 src/components/__tests__/ImageInputNode.test.tsx
15 src/components/__tests__/AudioInputNode.test.tsx
...
```

- Representative error shapes (from `src/store/utils/__tests__/localStorage.test.ts`):
  - `TS2345` — fixture object literal missing required properties of the target type (`WorkflowCostData` missing `incurredCost`, `lastUpdated`).
  - `TS2345` — fixture string where a union literal type is required (`provider: string` not assignable to `ProviderType`).

  Expect the component-test errors to be the same two shapes against node-data types from `src/types/index.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Error count | `npx tsc --noEmit 2>&1 \| grep -c "error TS"` | decreasing → 0 |
| Per-file breakdown | `npx tsc --noEmit 2>&1 \| cut -d'(' -f1 \| sort \| uniq -c \| sort -rn` | shrinking list |
| Full suite | `pnpm test:run` | all pass |
| New script | `pnpm typecheck` | exit 0 (after Step 5) |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `package.json` — add the `typecheck` script only; no dependency changes.
- Test files reported by `tsc` (predominantly `src/components/__tests__/*.test.tsx`, `src/store/utils/__tests__/*.test.ts`) — fix fixtures/assertions to satisfy the real types.
- Test helper/fixture files if you extract shared builders (create under the existing `__tests__` directories).
- CI workflow file (`.github/workflows/*`) — ONLY if one already runs lint/tests; add a typecheck step beside them. If no CI file exists, skip — do not create one.

**Out of scope** (do NOT touch):
- **Production source files.** If an error's correct fix appears to be in production code (the type is wrong, not the test), that is a STOP condition — report it; do not change `src/types/index.ts` or any non-test module.
- `tsconfig.json` — do not loosen `strict`, do not exclude test files. The point is a real gate, not a hollow one.
- Suppressions: no `@ts-ignore`, no `@ts-expect-error`, no `any`. The single allowed escape: when a test **deliberately** feeds malformed data (e.g. testing `JSON.parse` fallback paths), use `as unknown as <TargetType>` at that call site with a one-line comment saying the malformation is the point of the test.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b fix/typecheck-baseline`
- Commit per logical chunk (e.g. one commit per test-file cluster), conventional style: `test(types): fix fixture drift in component node tests`
- PRs target `develop`. Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Capture the baseline

Run the per-file breakdown command and save it to `/tmp/tsc-baseline.txt`. This is your worklist; work file-by-file, largest first.

**Verify**: file exists and totals ≈297 errors.

### Step 2: Fix the store-util test errors first (smallest, clearest)

Fix `src/store/utils/__tests__/localStorage.test.ts` (and any sibling util tests in the list): complete the fixture objects to the full required type (e.g. add `incurredCost`, `lastUpdated` to `WorkflowCostData` fixtures) and use the union literal values for fields like `provider`. Look up the real type definitions in `src/types/index.ts` and `src/store/utils/localStorage.ts` — fix the fixture to the type, never the reverse.

**Verify**: `npx tsc --noEmit 2>&1 | grep "store/utils"` → no output, and `pnpm test:run src/store/utils/__tests__` → all pass.

### Step 3: Fix the component test files, one at a time

For each file in the worklist (start with `GenerateVideoNode.test.tsx`): read the node-data interface it exercises (in `src/types/index.ts`), then repair fixtures. Where many tests in one file build the same node shape, extract a local `makeNodeData(overrides?: Partial<X>): X` builder at the top of that test file rather than repeating 20 complete literals. Keep behavior identical — fixtures gain required fields with neutral values; assertions are untouched unless they assert on a now-wrong shape.

After EACH file: `npx tsc --noEmit 2>&1 | grep "<that file>"` → no output, and `pnpm test:run <that file>` → all pass. Commit per file or per cluster.

**Verify (after the last file)**: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.

### Step 4: Confirm no test regressions

**Verify**: `pnpm test:run` → all pass (same count or higher than before you started; no skips added).

### Step 5: Add the script (and CI step if CI exists)

In `package.json` scripts, add: `"typecheck": "tsc --noEmit"`. If a GitHub Actions workflow already runs `pnpm lint` or `pnpm test`, add `pnpm typecheck` next to it; otherwise skip CI.

**Verify**: `pnpm typecheck` → exit 0.

## Test plan

No new tests — this plan repairs existing ones. The gate is: `pnpm test:run` passes with no tests deleted or skipped (`grep -rn "\.skip\|xit(\|xdescribe(" src/**/__tests__` shows no NEW occurrences vs. `git stash` baseline), and `pnpm typecheck` exits 0.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` → exit 0
- [ ] `grep '"typecheck"' package.json` → one match
- [ ] `pnpm test:run` → all pass
- [ ] `git diff --stat develop -- src/ | grep -v __tests__ | grep -v "^$"` → only the summary line (no production files changed)
- [ ] No new `@ts-ignore`/`@ts-expect-error`: `git diff develop | grep -c "@ts-ignore\|@ts-expect-error"` → 0
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Fixing any error correctly requires changing a **production** type or module — list the file, the error, and why the test looks right; the owner decides.
- A fixture fix makes a test FAIL (the test was passing only because the stale shape masked a behavior change) — that's a real bug discovery; report it with the failing assertion rather than adjusting the assertion to pass.
- The error count at Step 1 differs from ~297 by more than ~50 in either direction.
- You are tempted to exclude test files from tsconfig to get to green — that is explicitly the hollow version of this plan; stop instead.

## Maintenance notes

- Once green, the other advisor plans' "scoped typecheck" greps can be replaced by plain `pnpm typecheck` — whoever executes plans after this one lands should use the script.
- Reviewer should scrutinize: that fixture "neutral values" are genuinely neutral (e.g. adding `incurredCost: 0` doesn't change what an assertion on totals expects).
- Follow-up worth considering (not in scope): a pre-commit hook or CI job running `pnpm typecheck` if CI was absent.
