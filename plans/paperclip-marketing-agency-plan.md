# Plan: Marketing Agency on Paperclip, powered by node-banana

> End-to-end plan. Goal: solve a solo dev's **distribution problem** by running an
> autonomous marketing agency in Paperclip, using **node-banana** as the
> content-creation + social-scheduling engine. Built for me first; packaged as a
> reusable product for others second.

## 0. The two systems (division of labor)

| | **Paperclip** (`/Users/neoak/projects/paperclip`) | **node-banana** (`/Users/neoak/projects/node-banana`) |
|---|---|---|
| Role | The **agency** — strategy, org chart, tasking, budgets, governance, heartbeats | The **studio** — image/video generation pipelines + social drafting/scheduling/analytics |
| Shape | Node server + React UI, agent orchestration | Next.js 16 app, REST API routes, social copilot tool layer |
| In the metaphor | The brains / management | The hands that produce & publish |

Paperclip agents *decide and direct*; node-banana *creates and ships*. Clean seam.

## 1. The marketing-agency company (Paperclip side)

Built as an `agentcompanies/v1` package (markdown-native: `COMPANY.md`, `teams/`,
`agents/<slug>/AGENTS.md`, `skills/`). Use the **`company-creator`** skill to scaffold.

### Proposed org chart

```
CMO (strategy, goal alignment, budget owner)
├── Content Lead
│   ├── SEO / Blog Writer        → skills: seo-content, keyword-research
│   └── Copywriter               → skills: direct-response-copy, positioning-angle
├── Social Manager               → node-banana (MCP + CLI): drafts, schedule, analytics
├── Email / Lifecycle            → skills: email-sequences, newsletter-skill
└── Creative (Designer)          → node-banana (MCP + CLI): image/video generation
```

Paperclip already ships the marketing skill suite these agents need:
`marketing-orchestrator`, `positioning-angle`, `keyword-research`, `seo-content`,
`direct-response-copy`, `email-sequences`, `newsletter-skill`, `content-atomizer`,
`lead-magnet`, `brand-voice`.

### Goals, budgets, heartbeats
- **Goal** (company mission), e.g. *"Grow product X to N signups/month via owned content + social."*
  Every task traces back to it (Paperclip goal-ancestry).
- **Budgets**: per-agent monthly token caps so a runaway loop can't drain spend.
- **Heartbeats**: Social Manager wakes daily (draft + schedule), Content Lead 2–3×/week,
  Email weekly. Management reviews on its own cadence.

## 2. Dual-use: mine now, product later

Not a fork in the road — Paperclip supports both at once:
- **Multi-company isolation**: one deployment runs my real company + any demo/customer companies, fully isolated.
- **Portable company templates**: export the "Marketing Agency" company (org + agents + skills)
  with **secret scrubbing**, others **import** it as a starting template.

So: build it for myself → harden → `export` as a template → that *is* the product.

## 3. node-banana integration: one tool-core → MCP + CLI

**Key reuse**: `src/lib/social/copilot/tools/index.ts` already exposes
`createCopilotTools()` with typed tools (`listChannels`, `createDraft`, `listDrafts`,
`listScheduledPosts`, `getDraft`, `updateDraft`, `deleteDraft`, `duplicateDraft`, …),
each `{ description, inputSchema (zod), execute }`. Add generation + analytics tools to
the same shape, then project that one definition into **two** surfaces:

```
            src/lib/agent-tools/  (single source of truth)
            ├── social tools  (reuse createCopilotTools)
            ├── generate tools (wrap /api/generate, /api/workflow)
            └── analytics tools (wrap social/analytics)
                      │
        ┌─────────────┴─────────────┐
   MCP server                     CLI (bin)
  (stdio/http)                 `node-banana <cmd>`
        │                             │
   Paperclip agents             Paperclip agents
   call tools natively          shell out in tasks
```

### 3a. MCP server (primary, autonomous path)
- New package/entry: `src/mcp/server.ts` (or `packages/node-banana-mcp/`). Use
  `@modelcontextprotocol/sdk`. Register each agent-tool as an MCP tool (name, zod→JSON schema, execute).
- Tools to expose (start small): `generate_image`, `run_workflow`, `create_draft`,
  `schedule_post`, `list_scheduled_posts`, `list_channels`, `get_analytics`.
- Auth: server-to-server token (node-banana already uses better-auth); MCP server holds a
  service credential, never the agent's.

### 3b. CLI (scripting / fallback path)
- Add `"bin": { "node-banana": "dist/cli.js" }` to `package.json`.
- Commands mirror the tools: `node-banana generate ...`, `node-banana draft create ...`,
  `node-banana schedule ...`, `node-banana analytics ...`. JSON in/out for agent parsing.
- Why both: MCP for in-loop autonomous tool calls; CLI for deterministic heartbeat jobs,
  cron-style routines, and debugging by hand.

## 4. How Paperclip agents reach node-banana

- **MCP**: the `claude-local` adapter writes the agent's `settings.json` (it already
  references `mcpServers`). Attach the node-banana MCP server there so the Creative + Social
  Manager agents get the tools. Precedent: Paperclip ships its own `packages/mcp-server`.
- **CLI**: agents running under `claude_local` / `process` adapters can invoke
  `node-banana ...` directly from their workspace shell. Add a small Paperclip **skill**
  (`SKILL.md`) documenting the CLI so agents learn it at runtime (Paperclip's runtime skill injection).
- node-banana runs as a service (local `pnpm dev` now; deploy later). Agents talk to it over MCP/CLI;
  it owns the API keys (Gemini/fal/Replicate) and the social accounts.

## 5. Phased roadmap

**Phase 1 — Foundations (local, mine)**
1. Scaffold the Marketing Agency company in Paperclip (`company-creator`): CMO + 4 reports, goals, budgets.
2. Stand up node-banana locally; confirm `/api/generate` and `/api/social/*` work.
3. Extract the shared `agent-tools` core (reuse `createCopilotTools`, add generate + analytics).

**Phase 2 — Integration**
4. Build the node-banana **MCP server** over the tool-core; attach to Creative + Social Manager agents.
5. Build the node-banana **CLI**; write a Paperclip skill documenting it.
6. First end-to-end run: CMO sets a goal → Creative generates an image → Social Manager drafts + schedules a post.

**Phase 3 — Autonomy & distribution**
7. Wire heartbeats + routines (daily social, weekly email). Set budgets/guardrails.
8. Run my own distribution for ~2 weeks; tune skills, prompts, governance gates.

**Phase 4 — Productize**
9. Scrub secrets, `export` the company as a reusable template.
10. Onboarding docs + a second (demo) company to validate import for others.

## 6. Open decisions
- [ ] Local-only for now, or also deploy (Docker / AWS ECS) once stable?
- [ ] Which social channels first (the `@atproto`/Bluesky dep suggests Bluesky is wired; what else)?
- [ ] Run node-banana as a separate service vs. embed an MCP entry in its own process.
- [ ] Budget ceilings per agent (token caps) for the first autonomous run.

---
*Decisions captured: plan-first; integrate via **MCP + CLI**. Sources: paperclip README,
docs/adapters/*, docs/companies/companies-spec.md; node-banana src/app/api/*, src/lib/social/copilot/tools.*
