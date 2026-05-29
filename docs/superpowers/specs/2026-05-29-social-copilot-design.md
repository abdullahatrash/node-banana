# Social Copilot — Design Spec

## Why

The Social Hub lets creators compose, validate, and schedule posts across 11 platforms, and the app has a full media-generation pipeline. What's missing is a conversational way to drive it: "draft a launch post for X, LinkedIn, and Mastodon, attach the hero image from my pool, and schedule them across this week." Postiz proves the pattern (a tool-calling agent that lists channels, validates, and schedules), but it's built on Mastra + CopilotKit + LangGraph. Node Banana already has the better-fitting primitives — the Vercel AI SDK (`ai@6.0.64`) is in production here, the provider/publishing/validation/scheduling infrastructure exists, and there is a media pool. This spec designs a **Social Copilot**: a human-in-the-loop, conversational, draft-producing assistant on a dedicated `/social/copilot` route.

This is a **parity reference, not an architecture copy** (ADR 0006). We use the AI SDK's native agent loop, generative UI, and `needsApproval` human-in-the-loop gate — no Mastra, CopilotKit, or LangGraph.

## Glossary

Uses the canonical terms from `CONTEXT.md`: **Channel**, **Platform**, **Provider Adapter**, **Publishing Settings**, **Publish Validation**, **Safe Defaults**, **Publishing Readiness**, and **Social Copilot** (the term added for this feature). The copilot is explicitly **distinct from Automation** (the rules/tasks engine on the existing `/social/agents` page).

## Decisions (locked during brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| Intent | Human-in-the-loop conversational copilot for composing/scheduling | Not an autonomous poster; not the Automation engine |
| Stack | Vercel AI SDK only (`ai@6.0.64`, `@ai-sdk/*`) | Already the app's stack; existing `/api/chat` uses it |
| State model | **Persisted draft `socialPosts` rows** + media-pool refs (not ephemeral composer state) | ADR 0008 — required so the same tools serve a future MCP client |
| UI surface | Dedicated **`/social/copilot`** route + "Copilot" sidebar entry | Lexically distinct from "Agents & Automation" |
| Threads | Ephemeral (no `copilot_messages` table in v1) | Durable artifact is the draft; thread history is additive later |
| Model | Default **Claude Sonnet 4.6** (`claude-sonnet-4-6`), configurable | Strong tool-use; picker constrained to keyed providers |
| Cost | **BYOK** — user's API key, no app env fallback in production | Cost on the user, not the app owner |
| HITL gate | `needsApproval: true` on `scheduleDraft` + `publishNow` only | Drafting/media are reversible; commit is the boundary |
| Validation | **Hard server-side** re-validation inside commit tools | ADR 0002 — never trust the model |
| MCP | Out of scope for v1; tools built transport-agnostic for phase 2 | ADR 0008 |

## Architecture

```
/social/copilot (client)
  └─ <CopilotChat>  ── useChat({ transport: /api/social/copilot,
        │                        sendAutomaticallyWhen:
        │                        lastAssistantMessageIsCompleteWithApprovalResponses })
        │  renders generative-UI parts + approval panel
        ▼
/api/social/copilot (route handler, BYOK)
  reads X-Anthropic-API-Key (or X-Gemini/X-OpenAI) header  → user-keyed provider
  reads Better Auth session                                → { workspaceId, userId } ctx
  buildSocialCopilotAgent({ apiKey, modelId })  →  ToolLoopAgent
        │  model = createAnthropic({ apiKey })(modelId)
        │  instructions = SOCIAL_COPILOT_SYSTEM_PROMPT
        │  tools = createCopilotTools(ctx)
        │  stopWhen = stepCountIs(12)
        │  prepareStep = stage activeTools (hide commit tools until a draft exists)
        ▼
  createAgentUIStreamResponse({ agent, uiMessages })
        ▼
src/lib/social/copilot/tools/*   (transport-agnostic core — reused by phase-2 MCP)
  each tool.execute(args, { ctx })  →  existing social services
        ▼
existing infra: provider registry · socialPosts repo · validateSelectedPublishingSettings
                · media pool · Vercel Workflow publish/schedule
```

### Module layout

```
src/lib/social/copilot/
  agent.ts                 buildSocialCopilotAgent({ apiKey, modelId, ctx })
  prompt.ts                SOCIAL_COPILOT_SYSTEM_PROMPT builder
  context.ts               CopilotContext = { workspaceId, userId }; resolveContextFromSession()
  tools/
    index.ts               createCopilotTools(ctx): groups all tools, applies activeTools staging
    read.ts                listChannels, getPublishingSettingsSchema, listMediaPoolAssets,
                           listDrafts, getDraft, listScheduledPosts
    draft.ts               createDraft, updateDraft, attachMedia, duplicateDraft, deleteDraft
    validate.ts            validatePublish
    commit.ts              scheduleDraft, publishNow   (needsApproval: true; re-validate in execute)
  schemas.ts               shared zod input/output schemas

src/app/api/social/copilot/route.ts        POST handler (streamed agent UI response)
src/app/social/copilot/page.tsx            dedicated chat page
src/components/social/copilot/
  CopilotChat.tsx          useChat host + message rendering
  CopilotInput.tsx         composer input (reuse agent.input pattern)
  parts/                   generative-UI components (see below)
```

### The tool layer (transport-agnostic core)

Tools are pure functions wrapped as AI SDK `tool()` definitions via a `createCopilotTools(ctx)` factory (mirrors the existing `createChatTools(nodeIds)` pattern). Every `execute` receives the injected `ctx` — **no tool reads the HTTP session directly** — which is what lets the in-app route (ctx from Better Auth) and a future MCP server (ctx from API key) share identical code.

**Read / context** (no approval)

| Tool | Purpose | Backed by |
|------|---------|-----------|
| `listChannels` | Channels + capabilities (`maxContentLength`, `supportsImages/Video/Carousel`, `maxImages`, `requiresPageSelection`, `requiresReauth`, `disabled`) | provider registry + `socialAccounts` repo |
| `getPublishingSettingsSchema` | per-platform Publishing Settings fields + Safe Defaults | settings registry (ADR 0001/0003) |
| `listMediaPoolAssets` | search/list workspace media pool for attachment | assets repo |
| `listDrafts` / `getDraft` | read existing drafts | `socialPosts` repo |
| `listScheduledPosts` | calendar awareness over a date range (cadence, collision avoidance, open slots) | `socialPosts` repo |

**Write / draft** (no approval — reversible)

| Tool | Purpose | Notes |
|------|---------|-------|
| `createDraft` | new draft row: content + selected channels | accepts thread/chain params (`kind`, `position`, `delaySeconds`, `rootPostId`) |
| `updateDraft` | edit content / channels / per-channel Publishing Settings / `scheduledAt` | normalizes settings (ADR 0005); supports per-platform variants |
| `attachMedia` | attach pool asset(s) + alt text | media-pool reference, never generation |
| `duplicateDraft` | clone a draft | enables Reddit one-subreddit-per-post fanout + retargeting (ADR 0004) |
| `deleteDraft` | remove a draft | clean iteration |

**Check**

| Tool | Purpose |
|------|---------|
| `validatePublish` | run `validateSelectedPublishingSettings` → per-channel Publishing Readiness (for chat UX) |

**Commit** (`needsApproval: true`)

| Tool | Purpose |
|------|---------|
| `scheduleDraft` | set schedule, enqueue publish workflow — **re-validates server-side, throws `FatalError` if invalid** |
| `publishNow` | publish immediately — **re-validates server-side, throws `FatalError` if invalid** |

Out of scope for v1: `getAnalytics` (different domain), media generation (separate routes own it).

### Agent loop & loop control

- Single `ToolLoopAgent` (AI SDK "start simplest" guidance) — draft → validate → schedule is one natural loop, not a multi-agent workflow.
- `stopWhen: stepCountIs(12)` safety cap; loop ends naturally when the model stops calling tools.
- `prepareStep` returns `activeTools` that **hide `scheduleDraft`/`publishNow` until at least one draft exists in the conversation**, so the agent cannot attempt to commit nothing.
- Built per request via `buildSocialCopilotAgent` because the model carries the user's key (no module-level singleton).

### Human-in-the-loop (AI SDK native)

- Commit tools declare `needsApproval: true`. The SDK pauses before `execute` and emits an `approval-requested` tool part.
- Client renders an **approval panel** (the proposed schedule/publish, per-channel) with Approve/Deny → `addToolApprovalResponse({ id, approved })`.
- `useChat({ sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })` resumes the run; approved → `execute` runs, denied → `output-denied`.

### Generative UI (render-visual-interface pattern)

Tool outputs render as React components, not raw JSON:

| Part | Rendered as |
|------|-------------|
| `listChannels` | channel multi-select chips with capability badges |
| draft (`createDraft`/`updateDraft`/`getDraft`) | per-platform **preview cards** with char-count + media thumbnails, and **"Open draft →"** deep link to `/social/compose/[postId]` |
| `validatePublish` | per-channel **readiness chips** (ready / blocked + reason) |
| `listScheduledPosts` | week strip showing existing load (for slot selection) |
| `approval-requested` (commit) | **approval panel** with the proposed action + Approve/Deny |

### BYOK key handling

- Client sends the user's key via the existing `src/store/utils/buildApiHeaders.ts` util (default `X-Anthropic-API-Key`).
- Route reads the header → `createAnthropic({ apiKey })`. **No `process.env` fallback in production**; missing key → structured error prompting the user to add one in Settings.
- Model picker is constrained to providers the user has keyed; default Sonnet 4.6 when an Anthropic key is present.
- Keys remain client-stored/header-sent (existing app pattern). Server-stored encrypted keys are a phase-2 prerequisite for MCP — to be its own ADR then.

## Data model

No new tables in v1. Reuses `socialPosts` (drafts, chains via `rootPostId`/`position`/`delaySeconds`, `platformSettings`, `scheduledAt`, `studioAssetId`), `socialAccounts`, and the media-pool assets table. Draft cleanup: copilot-created drafts are ordinary draft rows; they appear in `/social/posts` and are subject to the same lifecycle. (A GC policy for abandoned copilot drafts is noted as a follow-up, not v1 scope.)

## Error handling

- **Missing/invalid key** → 4xx structured error surfaced as a chat notice with a Settings link.
- **Invalid draft at commit** → `validatePublish` re-run inside `execute` throws `FatalError`; surfaced as a denied/blocked commit with per-channel reasons (no retry).
- **Provider/publish errors** → existing `classifyError` + Vercel Workflow retry semantics apply downstream of `scheduleDraft`/`publishNow`; the copilot reports the queued result, not the eventual publish outcome.
- **Tool arg validation** → zod schemas on every tool; AI SDK surfaces repair/retry within the step budget.
- **Rate limit (429)** → chat notice asking the user to retry, mirroring `/api/chat`.

## Testing

- **Tool unit tests** (deterministic, no LLM): each tool's `execute` against a seeded workspace — `createDraft` writes a row, `validatePublish` rejects an over-limit X post, `scheduleDraft` throws on an invalid draft, `duplicateDraft` clones, ctx scoping prevents cross-workspace access.
- **Server-side validation gate test:** assert `scheduleDraft`/`publishNow` reject an unvalidated/invalid draft even when called directly (model bypass simulation).
- **Route test:** BYOK header precedence (user key over env), missing-key error, streamed response shape.
- **`activeTools` staging test:** commit tools absent until a draft exists.
- **Approval-flow test:** `needsApproval` produces an `approval-requested` part; approval runs `execute`, denial yields `output-denied`.
- Follows the existing `src/app/api/**/__tests__` patterns (Vitest).

## Non-goals (v1)

- MCP server / external-agent access (phase 2; tools are built ready for it)
- Media generation from chat (separate routes own it)
- Persisted conversation threads / thread history UI
- Analytics tools
- Autonomous posting (that's Automation, a separate feature)
- Live composer binding (draft-producing only)

## Phasing

1. Tool layer + schemas + `createCopilotTools(ctx)` (with unit tests) — the reusable core.
2. `buildSocialCopilotAgent` + `/api/social/copilot` route (BYOK, streamed).
3. `/social/copilot` page + sidebar entry + `CopilotChat` with plain text rendering.
4. Generative-UI parts + `needsApproval` approval panel.
5. `prepareStep` staging + system-prompt hardening (per-platform rules, Safe Defaults, scheduling guidance).

Phase 2 (separate spec): MCP server exposing the same tools, server-stored encrypted keys, per-tool authorization scopes.
