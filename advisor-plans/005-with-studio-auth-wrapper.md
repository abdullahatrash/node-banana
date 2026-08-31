# Plan 005: Extract a `withStudioAuth` route wrapper (consistent envelopes, sanitized 500s, validated PATCH)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 330af0b..HEAD -- src/app/api/studio/ src/lib/studio/`
> If in-scope files changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition. (Plan 001 intentionally lands first and adds
> auth to the copy route — that specific change is expected, and the copy
> route is out of scope here anyway.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches 12 route files; mitigated by existing route tests + gate-a)
- **Depends on**: 001 (avoid editing collisions in `src/app/api/studio/`), ideally 004 (green typecheck makes verification cleaner, not required)
- **Category**: tech-debt / security-hardening
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

Twelve studio route files repeat the same ~25-line preamble — `isDatabaseConfigured()` 503 guard, `authorizeStudioRequest` call, `authzErrorResponse` early return, and an outer `try/catch` that builds a 500. Three costs: (1) any change to the auth or envelope contract means twelve edits that can drift; (2) the catch blocks return **raw `error.message`** to clients (`prompts/route.ts:57-65`, `assets/presign/route.ts` and others) — internal errors from Drizzle/S3 leak to API consumers; (3) the prompts PATCH handler trusts `request.json()` with zero validation, passing `body.name`/`body.promptText`/`body.formConfig`/`body.isPublic` straight to the repository. After this plan: one wrapper owns the preamble, 500 responses are generic with the real error logged server-side, and the PATCH body is validated like its POST sibling already is.

## Current state

- The repeated preamble, exemplar `src/app/api/studio/prompts/route.ts:28-65` (GET):

```ts
export async function GET(
  request: NextRequest,
): Promise<NextResponse<PromptsGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/prompts",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }
    // ... handler body ...
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list prompts",  // ← leaks error.message
      },
      { status: 500 },
    );
  }
}
```

- The 12 route files using `authorizeStudioRequest` (confirm with `grep -rln "authorizeStudioRequest" src/app/api/studio --include="route.ts"`):
  `workspaces`, `projects`, `projects/[projectId]`, `prompts`, `prompts/public`, `prompts/[promptId]`, `assets`, `assets/[assetId]`, `assets/[assetId]/download`, `assets/ingest`, `assets/presign`, `assets/presign-multipart`, `assets/legacy-download` (≈12–13; trust the grep).
- Authz types: `StudioAuthorizationResult = StudioAuthorizationSuccess | StudioAuthorizationFailure` in `src/lib/studio/authz.ts:67-85`. Success carries `userId`, `workspaceId`, `role`, `permissions`, `contentSession`.
- The unvalidated PATCH, `src/app/api/studio/prompts/[promptId]/route.ts:25-49`:

```ts
    const body = await request.json();          // ← `any`, no validation
    // ... authz, existence check ...
    const prompt = await updatePrompt(authz.workspaceId, promptId, {
      name: body.name,
      promptText: body.promptText,
      formConfig: body.formConfig,
      isPublic: body.isPublic,
    });
```

  Its POST sibling (`prompts/route.ts:79-98`) already validates `name`/`promptText`/`mode` — match that style.
- Several routes have **domain-specific** catch logic inside (e.g. mapping `StudioAssetNotFoundError` to 404). The wrapper must be the OUTER catch only; inner domain catches stay where they are.
- Many routes are dynamic (`[projectId]`, `[assetId]`, `[promptId]`) — Next.js 16 passes `{ params: Promise<{...}> }` as the second handler argument; the wrapper must pass it through.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Gate-A (covers 6 of the routes) | `pnpm test:gate-a` | all pass |
| Studio route tests | `pnpm test:run src/app/api/studio` | all pass |
| Full suite | `pnpm test:run` | all pass |
| Scoped typecheck | `npx tsc --noEmit 2>&1 \| grep -E "api/studio\|lib/studio"` | no output |
| Lint | `pnpm lint` | exit 0 |

Note: bare `npx tsc --noEmit` has ~297 pre-existing errors in unrelated test files (plan 004 fixes them). Use the scoped grep. If plan 004 already landed, just run `pnpm typecheck`.

## Scope

**In scope**:
- `src/lib/studio/withStudioAuth.ts` (create) + `src/lib/studio/__tests__/withStudioAuth.test.ts` (create)
- The 12–13 `src/app/api/studio/**/route.ts` files from the grep — **except** `internal/*` and `copy`
- Their existing `__tests__/route.test.ts` files — only where a test asserts on a raw `error.message` in a 500 body and now must expect the generic message
- `src/app/api/studio/prompts/[promptId]/route.ts` — PATCH body validation

**Out of scope** (do NOT touch):
- `src/app/api/studio/internal/*` — different auth mechanism (`ensureInternalStudioAuth`), separate hardening item.
- `src/app/api/studio/copy/route.ts` — plan 001 owns it; migrate it to the wrapper in a later pass.
- `src/lib/studio/authz.ts` — consumed, not modified.
- Response shapes for **success** and **4xx** paths — clients depend on them; only the 500 body's `error` string changes (generic instead of leaked internals).
- `src/app/api/social/**` — same pattern exists there; explicitly deferred.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b feature/with-studio-auth-wrapper`
- One commit for the wrapper + its tests, then one commit per migrated route (or small cluster) — atomic, per repo convention.
- Conventional commits, e.g. `refactor(studio): migrate prompts routes to withStudioAuth`
- PRs target `develop`. Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the wrapper

Create `src/lib/studio/withStudioAuth.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  authorizeStudioRequest,
  authzErrorResponse,
  type StudioAuthorizationResult,
} from "@/lib/studio/authz";
import { logger } from "@/utils/logger";

type AuthorizedStudio = Extract<StudioAuthorizationResult, { authorized: true }>;

interface WithStudioAuthOptions {
  route: string;
  action: "read" | "write" | "delete";
}

type RouteContext = { params: Promise<Record<string, string>> };

export function withStudioAuth<C extends RouteContext | undefined = undefined>(
  options: WithStudioAuthOptions,
  handler: (
    request: NextRequest,
    authz: AuthorizedStudio,
    context: C,
  ) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context: C): Promise<NextResponse> => {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL is not configured." },
        { status: 503 },
      );
    }

    try {
      const authz = await authorizeStudioRequest(request, options);
      if (!authz.authorized) {
        return authzErrorResponse(authz);
      }
      return await handler(request, authz, context);
    } catch (error) {
      logger.error("system", "Unhandled studio route error", { route: options.route },
        error instanceof Error ? error : undefined);
      return NextResponse.json(
        { success: false, error: "Internal server error." },
        { status: 500 },
      );
    }
  };
}
```

Adjust to reality as you implement: check `authorizeStudioRequest`'s exact options type in `src/lib/studio/authz.ts` (it may take `route`/`action` plus extras) and check how `logger` is invoked elsewhere in `authz.ts:135` for the category/signature. The load-bearing requirements: 503 before auth; `authzErrorResponse` on failure; handler receives the **narrowed** authorized result; outer catch logs server-side and returns a **generic** message.

**Verify**: `npx tsc --noEmit 2>&1 | grep "withStudioAuth"` → no output.

### Step 2: Test the wrapper

Create `src/lib/studio/__tests__/withStudioAuth.test.ts` (pattern: the mocking style in `src/lib/studio/__tests__/authz.test.ts`). Cases in Test plan.

**Verify**: `pnpm test:run src/lib/studio/__tests__/withStudioAuth.test.ts` → all pass.

### Step 3: Migrate routes, one file per commit, simplest first

Order: `prompts/public` → `prompts` → `prompts/[promptId]` → `workspaces` → `projects` → `projects/[projectId]` → `assets` → `assets/presign` → `assets/[assetId]` → `assets/[assetId]/download` → `assets/legacy-download` → `assets/presign-multipart` → `assets/ingest`.

For each: rewrite handlers as `export const GET = withStudioAuth({ route: "...", action: "read" }, async (request, authz, context) => { ... })`, deleting the db-guard/authz/outer-catch boilerplate and keeping ALL body logic, inner validation (400s), domain catches (404 mappings), and success shapes byte-identical. Dynamic routes read params via `const { promptId } = await context.params;`.

After EACH file: run that route's test file (`pnpm test:run <its __tests__ path>`). Where a test asserted a leaked `error.message` in a 500, update the expectation to `"Internal server error."` — that change is the point.

**Verify (after all)**: `pnpm test:run src/app/api/studio` → all pass; `pnpm test:gate-a` → all pass.

### Step 4: Validate the prompts PATCH body

In `src/app/api/studio/prompts/[promptId]/route.ts`, after `await request.json()`, add validation matching the POST sibling's style (`prompts/route.ts:81-98`): reject non-object bodies (400); if `name` is present it must be a non-empty string after trim; `promptText` present → non-empty string; `isPublic` present → boolean; `formConfig` present → plain object (not array/null). Pass through only these four keys, trimmed where strings.

**Verify**: `pnpm test:run src/app/api/studio/prompts` → all pass (add the new validation cases per Test plan).

## Test plan

- `withStudioAuth.test.ts`: 503 when db unconfigured (handler not called); 401/403 pass-through from mocked `authorizeStudioRequest` failure; happy path (handler called with narrowed authz, response returned); thrown handler error → 500 with `error: "Internal server error."` and NOT the thrown message; `context` forwarded to the handler.
- Per migrated route: existing `__tests__/route.test.ts` keeps passing; update only 500-body message expectations.
- PATCH validation (extend `src/app/api/studio/prompts/__tests__/route.test.ts` or the [promptId] test if it exists; create it modeled on the prompts test if not): empty-string `name` → 400; non-boolean `isPublic` → 400; valid partial body → `updatePrompt` called with exactly the four allowed keys.

## Done criteria

ALL must hold:

- [ ] `grep -rln "withStudioAuth" src/app/api/studio --include="route.ts" | wc -l` ≥ 12
- [ ] `grep -rn "error instanceof Error ? error.message" src/app/api/studio --include="route.ts" | grep -v internal | grep -v copy` → no matches (no more leaked 500 messages in migrated routes)
- [ ] `pnpm test:gate-a` → all pass
- [ ] `pnpm test:run` → all pass
- [ ] `npx tsc --noEmit 2>&1 | grep -E "api/studio|lib/studio"` → no output
- [ ] `git status` → no files outside scope modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- A route's preamble deviates from the pattern in a way the wrapper can't express (e.g. authz intentionally AFTER body validation, as in `prompts/route.ts` POST where 400s precede authz) — **note**: if preserving exact status-code ordering for invalid-body-plus-unauthenticated requests matters, migrating that route changes ordering (401 now precedes 400). Flag any route where tests encode that ordering instead of changing the test.
- `assets/ingest` or `presign-multipart` (the two most complex routes) resist mechanical migration after two attempts — leave them un-migrated, mark it in the index, and finish the rest.
- Any existing test fails for a reason other than the 500-message change.

## Maintenance notes

- New studio routes should use `withStudioAuth` from day one — add that to CLAUDE.md's conventions when convenient.
- The `internal/*` routes and `/api/social/**` still carry the old pattern (deliberately deferred) — a follow-up can migrate social routes to a sibling wrapper.
- Reviewer should scrutinize: byte-identical success/4xx bodies per route (diff the test snapshots), and that domain-specific catches (404 mappings) were not swallowed by the outer catch.
