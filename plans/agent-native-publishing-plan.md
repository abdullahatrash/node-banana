# Agent-Native Publishing — build plan

Date: 2026-06-23
Status: design locked (via grilling session), ready to slice into issues
Supersedes the "open questions" in [agent-native-publishing-vision.md](agent-native-publishing-vision.md).

## Locked decisions (with ADRs)

| # | Decision | Record |
|---|----------|--------|
| Boundary | node-banana is the **destination**, never the agent runtime. BYO-agent runs generation + decisions on the customer's machine/keys. | ADR 0009 |
| Cognition | The **loop's intelligence lives in the agent.** node-banana provides the *circuit* (tools + state + readable analytics), never the brain. | ADR 0009 |
| Pricing | Flat hub price (~$49). Meter on **Channels + scheduled volume**; media volume = fair-use/overage. No per-user inference COGS. | ADR 0009 |
| Trust | **Default-review.** Post-packs land in the Kanban `review` state; auto-publish only via explicit per-Channel **Auto-publish Scope** on the Agent Key. | ADR 0010 |
| Surface | **REST-first** ingest with a static **Agent Key** (`Authorization: Bearer`). MCP server + OAuth 2.1 deferred until paying multi-tenant demand. | ADR 0011 |
| Contract | **`post-pack/v1`** — versioned, strict (reject unknown), mapped onto the internal Post model, not a mirror. | CONTEXT.md |
| Scope | Build the **social loop only.** Spine kept general so email/blog are future adapters; do NOT widen "Channel" or build other loops yet. | this plan |
| Media | **Agent uploads bytes** (presigned R2) and references asset IDs. Never URL-fetch-at-publish (link rot on deferred publish). | this plan |
| Copilot | **Coexist.** Social Copilot (BYOK, in-app) = on-ramp; External Agent (BYO-agent) = growth surface. Same tool layer (ADR 0008). | CONTEXT.md |

## First customer / first loop (from session start)

Customer zero = **yourself / solo founders.** First Channel = **LinkedIn.** Dogfood: market node-banana itself on LinkedIn via the loop.

## The reusable spine (social is loop #1, the template)

```
External Agent (brain: strategy, BYO) ──> submit Post-pack ──> review board ──> schedule ──> publish (social Channel) ──> measure ──┐
        ^                                                                                                                          │
        └──────────────────────────────────────── read analytics tool ────────────────────────────────────────────────────────┘
```
Same shape later clones to email/blog loops — only the "execute" adapter differs.

## Build slices (dogfood-first)

### Slice 0 — REST ingest proof (~1 day, the vision's cheapest-first)
- `post-pack/v1` strict Zod schema; mapping layer post-pack → internal draft Post in `review`.
- `POST /api/social/posts/ingest`, authed by Bearer **Agent Key** (workspace-scoped, hashed at rest).
- Repoint `flowleap-social-factory` runner's final step from "git commit" to POST.
- Acceptance: run the factory locally → Post-packs appear on the Kanban → manually schedule → publish to LinkedIn.

### Slice 1 — Agent Key management + scopes + media
- Agent Key issue/revoke (per workspace); per-Channel scope model incl. **Auto-publish Scope** enforcement.
- Presigned R2 upload endpoint; post-pack references asset IDs.

### Slice 2 — Analytics-read tool (closes the loop)
- Read surface exposing per-post / per-Channel metrics so the agent can adjust. This is the feedback edge.

### Slice 3 — MCP server adapter
- Wrap the same tool layer as an MCP server (Bearer key first). OAuth 2.1 resource server + elicitation connect-flow later.

### Slice 4 — Metering + plans
- Enforce Channel count + scheduled-volume; media fair-use/overage.

### Slice 5 — Agency Recipe
- Author a `marketing-agency` Paperclip `COMPANY.md` (strategist / writer / designer agents) targeting the Agent Interface. The thing a customer "imports."

## Out of scope (named, so it stays out)
Email/blog/ads loops · widening "Channel" · full OAuth/DCR · server-side cognition · multi-harness abstraction. All deferred until the social loop is proven on your own content.
