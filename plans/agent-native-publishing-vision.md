# Agent-Native Publishing — product direction

Date: 2026-06-21
Status: vision note (capture, not a build plan yet)

> **Thesis:** node-banana should not run content-generating agents on our infra.
> It should be the **agent-native publishing & review hub**: any agent harness,
> running on the *user's own* machine with the *user's own* keys, generates posts
> and pushes them into node-banana, which owns review (the Kanban board),
> scheduling, and multi-platform publishing. The content "factory" becomes a
> portable recipe that plugs into any harness; node-banana becomes the
> destination that recipe targets.

This came out of pairing node-banana with the `flowleap-social-factory` project
(a quality-disciplined, grounded text-content pipeline: planner → writer →
reviewer → deterministic gate → editor). That factory *proves the generation
model*; node-banana *owns the last mile*.

---

## The core idea

```
[user's local agent: Claude Code / OpenClaw / Hermes / anything]
        runs the FACTORY recipe (grounded, reviewed, curated)
                              │
                              ▼  POST a post-pack (or MCP submit_post)
[node-banana]  ──►  Kanban review board  ──►  schedule  ──►  publish (8 platforms)
```

- **We do NOT run the LLM agent.** The user does, locally, with their compute and
  API keys.
- **node-banana exposes an endpoint** (and ideally an MCP server) that receives a
  post-pack and drops it on the Kanban in `review`.
- The user **reviews on the board, schedules, and publishes** through node-banana's
  existing multi-platform infra.
- node-banana becomes the place agent-generated content goes to get **vetted and
  shipped** — not a place that generates it.

## Why this is the right architecture

1. **Running agents server-side at scale is a money pit** — per-user inference
   cost, timeouts, retries, model-ops, prompt-injection, abuse. BYO-agent deletes
   that entire category of cost and operational pain.
2. **It meets power users where they already are** — in their own agent harness —
   instead of forcing them into an inferior web agent we'd have to build and lose
   at.
3. **It picks the defensible half.** Generation is a commodity race. Multi-platform
   OAuth + reliable scheduling + a review surface is the hard, durable part — and
   it's already built in node-banana. This lets us *own that* and stop competing on
   generation.

## The contract is the product surface

If any agent can target it, the **ingest schema is the product**. It must be
simple and strict, or agents send garbage. The good news: the factory already
defines this contract — the **post-pack** (lesson, postType, scorecard, grounding
sources, editor decision) is exactly what the "social route" should accept and
what the Kanban board should display. Straight line:

```
local agent runs factory → POST post-pack → Kanban (review) → schedule → publish
```

**Plug mechanism: make node-banana an MCP server.** Tools like `list_channels`,
`submit_post`, `schedule_post`. Then any MCP-speaking harness (Claude Code, etc.)
plugs in with zero custom integration. Ship a plain REST endpoint as the fallback
for harnesses that don't speak MCP. That's the concrete "pluggable to any agent."

## Where the moat moves (be deliberate)

If the factory runs client-side, our quality differentiator (grounding + review
discipline) lives in a recipe we hand out. That's a *relocation*, not a loss. The
retained moat becomes:

- The **publishing/scheduling/multi-platform infra** (expensive, durable).
- The **review surface** — the Kanban board that shows grounding, scorecard, and
  editor decision so a human vets quality before it ships. (A working version of
  this board already exists in `flowleap-social-factory`: lesson-first cards,
  postType badges, edu score, editor-pick filter.) This becomes our quality story,
  not the generator.
- Optionally a **marketplace/library of grounded factory recipes** (patent, SaaS,
  personal-brand). Premium value lives here.

Decide explicitly what is open (the recipe) vs. paid (the hub + curated recipes).

## Scope discipline: a loop, not a "playground"

"Full agent playground" is the one scope smell to resist. Keep it a **loop**:
*agent generates → review → approve → schedule → publish → (later) analytics back.*
Everything serves that loop. The moment it becomes "a place to do arbitrary agent
stuff," it stops being a product.

## Business model

BYO-agent means we don't sell the AI; we sell the hub: channel connections,
scheduling reliability, the review board, analytics. Price on channels / seats /
scheduled volume — the proven scheduler-SaaS model, minus the cost of running
generation.

## Cheapest first proof (≈ a day)

Don't build the marketplace or the multi-harness abstraction yet. Build the
thinnest slice of the contract and dogfood it:

1. One endpoint: `POST /api/social/posts/ingest` that accepts a post-pack and drops
   it on the Kanban in `review`.
2. Change the `flowleap-social-factory` runner's final step from "git commit" to
   "POST to that endpoint" (~10 lines — it's already a recipe + thin runner).
3. Run the FlowLeap factory locally → posts appear on node-banana's board →
   schedule → publish.

If that loop feels good with our own content, the whole architecture is validated
before generalizing to "any agent / any grounding."

## Open questions

- Auth model for ingest (per-workspace API key? OAuth? scoped token per agent?).
- How much of the post-pack the board renders vs. stores (scorecard, grounding
  trail, editor decision are all useful to surface for the human reviewer).
- MCP server packaging + distribution (how a user points their agent at it).
- What stays open-source (the recipe) vs. proprietary (the hub, curated recipes).

## References

- `flowleap-social-factory` — the proof-of-model factory and the post-pack
  contract (frontmatter + lesson/postType + scorecard + grounding + editor
  decision), plus the Kanban review board to copy.
