# Plan 001: Require authentication on /api/studio/copy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 330af0b..HEAD -- src/app/api/studio/copy/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `330af0b`, 2026-06-10

## Why this matters

`POST /api/studio/copy` streams LLM completions (Gemini, OpenAI, Anthropic) using the server's API keys, and it is the **only** route under `src/app/api/studio/` with no authentication or authorization check. Anyone who can reach the deployment (it is deployed publicly at tasmeemai.vercel.app) can use it as a free LLM proxy: pick any model in the registry, send arbitrary messages and a system prompt, and consume the project's paid API quota. Every sibling studio route gates on `authorizeStudioRequest()`; this one was missed. After this plan, unauthenticated requests get a 401 and the route behaves like its siblings.

## Current state

- `src/app/api/studio/copy/route.ts` — the vulnerable route (89 lines). The POST handler starts at line 57 and goes straight from `request.json()` to `streamText()`:

```ts
// src/app/api/studio/copy/route.ts:57-73 (current)
export async function POST(request: Request) {
  try {
    const { messages, model: modelKey, system } = (await request.json()) as CopyRequest;

    const resolvedModel = modelKey || "gemini-2.5-flash";
    const aiModel = createModel(resolvedModel);
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: aiModel,
      system,
      messages: modelMessages,
      temperature: 0.9,
      maxOutputTokens: 2048,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
```

  Note the handler signature uses `Request`, not `NextRequest`.

- The convention every sibling route follows (exemplar: `src/app/api/studio/prompts/route.ts:28-45`):

```ts
// src/app/api/studio/prompts/route.ts:31-45 (exemplar — match this)
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
```

- `authorizeStudioRequest` and `authzErrorResponse` live in `src/lib/studio/authz.ts`. For a route path containing neither `/projects` nor `/assets`, `action: "read"` maps to the `workspaces:read` permission (see `mapActionToPermission`, `src/lib/studio/authz.ts:148-173`), which every workspace role (owner/admin/member) has — so any signed-in workspace member can still use copy mode. That is the intended behavior.
- `authorizeStudioRequest` expects a `NextRequest` (it reads `request.headers`); `getContentOSSession` resolves the workspace from the `x-workspace-id` header if present, otherwise falls back to the user's first workspace membership (`src/lib/studio/authz.ts:214-251`). The copy UI calls this route via the AI SDK's `useChat`, which does **not** send `x-workspace-id` — the fallback path makes that fine, since this route reads no workspace data.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Focused tests | `pnpm test:run src/app/api/studio/copy/__tests__/route.test.ts` | all pass |
| Gate-A (CI gate) | `pnpm test:gate-a` | 120+ tests pass |
| Full suite | `pnpm test:run` | all pass |
| Scoped typecheck | `npx tsc --noEmit 2>&1 \| grep "api/studio/copy"` | no output |
| Lint | `pnpm lint` | exit 0 |

Note: a bare `npx tsc --noEmit` currently fails with ~297 **pre-existing** errors in unrelated test files. Do not try to fix those (that is plan 004). Use the scoped grep above.

## Scope

**In scope** (the only files you should modify/create):
- `src/app/api/studio/copy/route.ts`
- `src/app/api/studio/copy/__tests__/route.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/lib/studio/authz.ts` — the auth helpers are correct as-is.
- `src/components/simple-studio-shell/forms/CopyForm.tsx` and any client code — the client already sends session cookies; no client change is needed.
- The error-masking logic at `route.ts:74-87` — it is deliberate and correct; keep it.
- Rate limiting / abuse quotas — a real follow-up, but not this plan.

## Git workflow

- Branch from `develop`: `git checkout develop && git checkout -b fix/secure-copy-route`
- Commit style: conventional commits, e.g. `fix(studio): require auth on /api/studio/copy`
- PRs target `develop` (`gh pr create --base develop`). Do NOT push or open a PR unless the operator instructed it. Never push directly to `develop`/`master`.

## Steps

### Step 1: Add the auth gate to the POST handler

In `src/app/api/studio/copy/route.ts`:

1. Add imports:
   ```ts
   import { NextRequest } from "next/server";
   import { isDatabaseConfigured } from "@/lib/db";
   import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
   ```
2. Change the handler signature from `POST(request: Request)` to `POST(request: NextRequest)`.
3. At the top of the handler body, **before** the existing `try`, add the `isDatabaseConfigured()` 503 guard exactly as in the prompts exemplar (use `Response.json` or `NextResponse.json` consistently with the rest of this file — the file currently uses `Response.json`).
4. Inside the `try`, **before** `request.json()`, add:
   ```ts
   const authz = await authorizeStudioRequest(request, {
     route: "/api/studio/copy",
     action: "read",
   });
   if (!authz.authorized) {
     return authzErrorResponse(authz);
   }
   ```

**Verify**: `npx tsc --noEmit 2>&1 | grep "api/studio/copy"` → no output.

### Step 2: Write route tests

Create `src/app/api/studio/copy/__tests__/route.test.ts`, modeled structurally on `src/app/api/studio/prompts/__tests__/route.test.ts` (read it first; reuse its mocking approach for `@/lib/studio/authz` and `@/lib/db`). Mock the `ai` package's `streamText` and `convertToModelMessages` (and the three `@ai-sdk/*` provider factories) so no network is touched. Cases to cover are in the Test plan below.

**Verify**: `pnpm test:run src/app/api/studio/copy/__tests__/route.test.ts` → all pass.

### Step 3: Run the broader gates

**Verify**: `pnpm test:gate-a` → all pass. `pnpm test:run` → all pass. `pnpm lint` → exit 0.

## Test plan

New file `src/app/api/studio/copy/__tests__/route.test.ts`:

1. **401 unauthenticated**: `authorizeStudioRequest` mocked to return `{ authorized: false, status: 401, error: "...", reason: "unauthenticated" }` → response status 401, body `{ success: false }`-shaped, and `streamText` NOT called.
2. **503 no database**: `isDatabaseConfigured` mocked false → 503, `authorizeStudioRequest` NOT called.
3. **Happy path**: authz mocked authorized; `streamText` mocked to return an object whose `toUIMessageStreamResponse()` returns a `Response` → handler returns that response and `streamText` was called with `temperature: 0.9`.
4. **Unknown model**: body `{ model: "bogus-model", messages: [] }` with authz OK → 500 with `error: "Unsupported model selected"` (the existing masking).
5. **Missing API key masking**: registry model whose env var is unset → 500 with `error: "Model API key not configured"` (set/unset env in the test via `vi.stubEnv`).

Pattern file: `src/app/api/studio/prompts/__tests__/route.test.ts`.

## Done criteria

ALL must hold:

- [ ] `grep -n "authorizeStudioRequest" src/app/api/studio/copy/route.ts` → at least one match
- [ ] `pnpm test:run src/app/api/studio/copy/__tests__/route.test.ts` → all pass (≥5 tests)
- [ ] `pnpm test:gate-a` → all pass
- [ ] `pnpm test:run` → all pass
- [ ] `npx tsc --noEmit 2>&1 | grep "api/studio/copy"` → no output
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The POST handler in `src/app/api/studio/copy/route.ts` no longer matches the "Current state" excerpt.
- You find evidence (comments, docs, or a calling site that runs without a database) that this route is intentionally usable in a **keyless local mode without a DB** — adding the `isDatabaseConfigured` gate would break that mode, and the trade-off needs an owner decision.
- `authorizeStudioRequest` rejects requests in the happy-path test for a reason other than your mock (signature drift in `authz.ts`).

## Maintenance notes

- If a per-workspace LLM usage quota is added later, this route's `authz.workspaceId` is now available to attribute usage to.
- Reviewer should scrutinize: the 503 guard ordering (before auth, matching siblings) and that the streaming response path still returns `result.toUIMessageStreamResponse()` untouched.
- Deferred follow-up: rate limiting on this route (documented in advisor-plans/README.md as unplanned finding).
