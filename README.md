# Node Banana

**Node Banana is the BYOK content pipeline your agents plug into** — a
node-based visual content workflow editor and social publishing hub for
agencies and studios running programmatic, multi-brand content operations.

One engine, three faces:

- **Visual canvas** — a complete standalone product. Drag nodes onto a React
  Flow canvas, wire typed handles together, and run pipelines that generate
  images, text, and more.
- **CLI + MCP** — the agent and scale layer. A single tool registry powers a
  hosted [MCP](https://modelcontextprotocol.io) server and an `nb` CLI, so any
  agent harness (Claude Code, Cursor, n8n, your own scripts) or CI job can drive
  the exact same surface a human uses.
- **Durable social publishing** — a Postiz-class social hub with a durable
  dispatch/recovery/token-refresh pipeline. **X (Twitter) is live end-to-end;**
  adapters for ten more platforms are code-complete (most contract-tested),
  waiting only on their platform credentials.

**BYOK-only.** Each workspace brings its own AI provider keys. The product never
provides or resells inference — a workspace with no key configured gets a clear,
actionable error, never a bill on someone else's key. This is the point: an
agency runs each client brand on that brand's own inference budget.

![Node Banana Screenshot](public/node-banana.png)

---

## Table of contents

- [Tech stack](#tech-stack)
- [Quickstart (the agency persona)](#quickstart-the-agency-persona)
- [Agent surface quickstart (API token → MCP → CLI)](#agent-surface-quickstart-api-token--mcp--cli)
- [The BYOK model](#the-byok-model)
- [Social hub](#social-hub)
- [Architecture overview](#architecture-overview)
- [Development](#development)
- [Honest limitations](#honest-limitations)
- [License](#license)

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) with a custom `server.js` for extended request timeouts |
| Language | TypeScript |
| Node editor | [`@xyflow/react`](https://reactflow.dev) (React Flow) |
| Canvas drawing | Konva.js / react-konva |
| State | Zustand (single-store pattern) |
| Persistence | Drizzle ORM + PostgreSQL 16 |
| Auth | Better Auth (magic link, OAuth, 2FA, organizations) |
| Object storage | Cloudflare R2 / any S3-compatible API (presigned uploads) |
| Agent surface | `@modelcontextprotocol/sdk` (MCP), `commander` (CLI), `zod` schemas |

---

## Quickstart (the agency persona)

From zero to a first scheduled post. Assumes Node.js 20+, `pnpm`, and Docker.

### 1. Install and start Postgres

```bash
pnpm install
pnpm db:up        # docker compose: postgres:16-alpine on localhost:5432
```

### 2. Configure the environment

```bash
cp .env.example .env.local
```

At minimum, set for local dev:

- `DATABASE_URL` — already defaults to the Docker Postgres above.
- `BETTER_AUTH_SECRET` — `openssl rand -hex 32`.
- `BYOK_KEY_ENCRYPTION_KEY` — `openssl rand -hex 32` (encrypts workspace provider keys at rest).
- `SOCIAL_TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32` (encrypts social OAuth tokens at rest).

Notice there is **no `GEMINI_API_KEY` requirement**. AI provider keys are not
read from the environment on any product path — you add them per workspace once
the app is running (see [The BYOK model](#the-byok-model)).

### 3. Migrate and run

```bash
pnpm db:generate      # generate Drizzle migrations
pnpm db:migrate       # apply them
pnpm db:backfill:org  # backfill workspace↔organization mapping
pnpm dev              # http://localhost:3000
```

### 4. Create a workspace and add a BYOK key

1. Sign up at [http://localhost:3000](http://localhost:3000) and open `/studio`.
2. Create a **workspace** — one workspace per client brand.
3. Go to **Settings → Provider Keys (BYOK)** and add a key for a provider you
   own — e.g. Google Gemini. The key is validated and stored encrypted.

### 5. Connect X

In **Settings → Channels**, connect an X account. This requires an X developer
app: set `X_API_KEY` and `X_API_SECRET` in `.env.local` first (see
[Social hub](#social-hub)). Platforms without configured credentials are hidden
rather than shown broken.

### 6. Build your first pipeline

On the canvas, add a **Prompt** node and a **Generate** (`nanoBanana`) node,
connect prompt → image, and press **Run** (or `Cmd/Ctrl+Enter`). Generation
resolves your workspace's Gemini key automatically.

### 7. Schedule your first post

Compose a post in the social hub, attach the generated image, and schedule it
for a few minutes out. When [cron is wired](#cron-requirements), the dispatch
pipeline publishes it with no further clicks. Locally, you can trigger a
dispatch manually — see [`docs/social-cron-scheduler.md`](docs/social-cron-scheduler.md).

---

## Agent surface quickstart (API token → MCP → CLI)

The visual canvas is complete on its own. The agent surface is the upgrade for
driving many brands programmatically. Everything below talks only to the public
API — never to the database — so agents exercise exactly the surface you do.

### 1. Create a workspace-scoped API token

In **Workspace Settings → API Tokens**, create a token. It is shown **once** at
creation, carries a recognizable `nb_` prefix, and is stored only as a SHA-256
hash — a database leak never leaks credentials. A token acts with owner
permissions **within its single workspace**; tenant isolation is guaranteed by
the fixed workspace binding. Revoke it any time to kill a leaked credential
without touching other brands.

### 2. Connect an MCP client

The hosted MCP server is streamable HTTP at `/api/mcp`, authenticated with the
same Bearer token:

```bash
claude mcp add --transport http node-banana https://your-app.example.com/api/mcp \
  --header "Authorization: Bearer nb_your_token_here"
```

Your agent can now discover typed tools: list workspaces and social accounts,
list/upload assets, run a workflow and poll its status, and create/list/track
social posts.

### 3. Use the `nb` CLI

The CLI ships as a pnpm workspace package (`@node-banana/cli`, binary `nb`) that
mirrors the MCP tools:

```bash
pnpm --filter @node-banana/cli build     # compile to packages/cli/dist
node packages/cli/dist/index.js --help    # or `npm link` inside packages/cli for a global `nb`

# Authenticate once — the token is verified, then stored at
# ~/.config/node-banana/config.json with 0600 permissions.
nb auth login --token nb_your_token_here --url https://your-app.example.com
nb auth status

# Discover and act
nb workspaces list
nb accounts list
nb assets upload ./render.png --type image
nb run <projectId> --wait                  # start a run, poll to terminal state
nb post create --account <accountId> \
  --text "Ship day." --media <assetId> \
  --schedule 2026-07-11T15:00:00Z          # or "now" / "draft"
nb post list --status queued
```

Every command accepts `--json` for machine-readable output, so CI pipelines can
parse results:

```bash
nb run <projectId> --wait --json | jq '.status'
```

Errors from the API, CLI, and MCP are structured (what failed, why, and how to
fix it) so an agent can self-correct instead of guessing.

---

## The BYOK model

BYOK ("bring your own key") is a product decision, not just a config toggle. The
business never provides or resells inference, and an agency can run each client
brand on that brand's own provider account and budget.

**Resolution order** (implemented in `src/lib/byok/resolveInferenceKey.ts`):

1. **Request header** — e.g. `X-Gemini-API-Key`, for ad-hoc and agent calls.
2. **Workspace vault** — the workspace's stored, encrypted key.
3. **A typed error** — `byok_key_missing`, naming the provider and pointing to
   **Settings → Provider Keys**. Never a 500, never a leaked env var name.

There is deliberately **no `process.env.<PROVIDER>_KEY` tier** on any product
path (generate, LLM, chat, quickstart). Keys are stored per workspace, encrypted
at rest with AES-256-GCM under `BYOK_KEY_ENCRYPTION_KEY` (separate from the
social-token key, so rotating one never invalidates the other).

Supported providers: **Google Gemini, OpenAI, Anthropic, Kie.ai, fal.ai,
Replicate, WaveSpeed**.

---

## Social hub

A durable social publishing backend with composition, scheduling, and a
recovery-oriented dispatch pipeline.

**X (Twitter) is verified live end-to-end** — connect, compose, schedule,
dispatch, publish, reconcile. Adapters for ten more platforms are implemented —
**LinkedIn, Instagram, Facebook, Threads, TikTok, YouTube, Reddit, Pinterest,
Bluesky, and Mastodon** — so enabling one is a credentials-and-config task, not a
code change. Most are **contract-tested against mocked platform HTTP** (see the
[MSW harness](src/test/msw/README.md)); Bluesky and Mastodon ship without a
contract suite yet. Platforms without configured credentials are cleanly
hidden/disabled rather than shown broken.

Configure only the platforms you use in `.env.local` (each needs its own
developer app — see the "Social Hub — Platform Credentials" block in
`.env.example`). Bluesky (app passwords) and Mastodon (dynamic per-instance
OAuth) need no developer app.

### Cron requirements

The dispatch pipeline is a set of internal routes under
`src/app/api/social/internal/*`. **Nothing publishes until a scheduler invokes
them.** [`vercel.json`](vercel.json) wires the crons:

- **1-minute cadence** — `dispatch` and `recover-missing-dispatch`. These
  require a **Vercel Pro (or Enterprise) plan**; Vercel Hobby is limited to
  once-per-day crons. Coarser jobs (webhook delivery, reconcile, sweep, token
  refresh, cleanup, digest) run on 2–1440-minute intervals.
- **`CRON_SECRET`** — Vercel sends `Authorization: Bearer $CRON_SECRET` on every
  cron request. Set `CRON_SECRET` to the **exact same value** as
  `SOCIAL_INTERNAL_API_SECRET`; the internal routes already accept that header
  shape, so no code change is needed.
- **Self-hosting?** Upstash QStash is the documented fallback for sub-daily
  cadence off Vercel.

Full cadence table, auth model, and post-deploy verification steps are in
[`docs/social-cron-scheduler.md`](docs/social-cron-scheduler.md).

---

## Architecture overview

### Canvas & store

All canvas state lives in a single Zustand store, `src/store/workflowStore.ts`.
`executeWorkflow()` topologically sorts the node graph and executes nodes in
dependency order; `getConnectedInputs()` feeds each node its upstream
images/text/audio. The interactive canvas is the richest execution environment.

### Tool registry — the single seam

`src/lib/agent-tools/registry.ts` is the **one source of truth for the agent
surface**: ten Zod-typed tool definitions (list workspaces, list social
accounts, list/upload assets, get asset download URL, run workflow, get run
status, create/list social posts, get post status). Three thin adapters derive
their behaviour from it and none re-declares a tool:

- **MCP server** — `src/app/api/mcp/route.ts` builds a fresh, stateless server
  per request from the registry.
- **CLI** — `packages/cli`, a command tree over the public API.
- **Public API v1** — `src/app/api/v1/*`, versioned REST re-exposing existing
  Studio/social/generation capabilities.

All three authenticate through one path (`authorizePublicApiRequest`): a Bearer
`nb_` token resolves to a workspace-scoped session with the same authorization
rules as the app, so programmatic access can never cross tenant boundaries.

### Dispatch pipeline

`src/app/api/social/internal/*` implement durable dispatch, missed-dispatch
recovery, stuck-post sweep, token refresh, webhook delivery/replay, reconcile,
automation, digest, and cleanup — each idempotent and cron-invoked with a shared
secret.

### Server-side workflow runner

`src/lib/workflow-runner/*` is the headless runner behind the `run-workflow`
tool. It executes an honest subset of node types as pure server round-trips
(see [Honest limitations](#honest-limitations)) and resolves inference keys
through the same BYOK seam as the interactive canvas.

---

## Development

This is a pnpm workspace: the root Next.js app plus `packages/cli`.

```bash
pnpm dev            # dev server (custom server.js) at http://localhost:3000
pnpm build          # production build
pnpm lint           # ESLint (Next.js flat config)
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest, watch mode
pnpm test:run       # Vitest, single run (CI)
pnpm test:gate-a    # deterministic API/auth regression subset
```

CLI package tests: `pnpm --filter @node-banana/cli test:run`.

### Testing approach

Tests assert **external behaviour** — given a request or tool call, the response,
persisted state, and outbound HTTP — never internal call structure. Two seams:

- **Route-handler tests** (the established pattern) cover the public API, token
  auth, and BYOK key resolution.
- **MSW provider contract tests** run each social provider's *real* SDK/`fetch`
  code against mocked platform HTTP, exercising request signing, URL building,
  and real error-classification for successful post, token-refresh, rate-limit
  retry, and permanent-failure paths. The harness is opt-in per file — see
  [`src/test/msw/README.md`](src/test/msw/README.md).

---

## Honest limitations

This section is deliberate. Everything above is shipped; here is what is *not*
yet true, so you can plan around it.

- **Server runner executes a subset of node types.** The headless runner behind
  the API/MCP/CLI supports `prompt`, `imageInput`, `llmGenerate`, `nanoBanana`,
  and `output` only. A workflow containing any other node type (annotation,
  splitGrid, video, audio, GLB viewer, router/switch, etc.) returns a structured
  `unsupported_node` error from the API. Those nodes still run on the interactive
  canvas — the canvas remains the full-capability surface.
- **Serverless timeouts.** On Vercel, `generate` is capped at 300s and the MCP /
  social-internal routes at 60s. Very long, multi-step runs can exceed
  serverless limits; the canvas uses the custom `server.js` for longer local
  runs.
- **Agent-surface asset upload needs S3/R2.** `nb assets upload` and the
  `upload-asset` tool require `STORAGE_BACKEND=s3` with valid `S3_*` credentials.
  The `local` storage backend is a dev convenience for the canvas only.
- **Only X is live-verified.** The other ten platform adapters are code-complete
  (most contract-tested) but not yet verified against their live APIs; each needs
  its platform credentials before it can publish.
- **No billing or plan enforcement yet.** Access is scoped by token → workspace;
  metering and paywalls are a separate future effort.

---

## License

MIT — see [LICENSE](LICENSE).
