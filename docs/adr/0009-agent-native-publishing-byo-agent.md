# Agent-Native Publishing With a BYO-Agent Cost Boundary

Status: Superseded for Content Operations Runtime execution authority and
engine placement by [ADR 0013](0013-content-operations-runtime-capability-entrypoint.md).
The BYO-agent economic boundary and user-supplied External Agent direction
remain applicable.

Node Banana is the **destination**, not the agent runtime: a customer's **External Agent** (Claude Code, Codex, OpenClaw, Hermes, etc.) runs generation and decision-making on the customer's own machine with the customer's own keys, and submits finished content to a **Workspace** through the **Agent Interface** (MCP + REST), which reuses the transport-agnostic Social Copilot tool layer with context supplied from an **Agent Key** instead of a session (see [0008](0008-social-copilot-persisted-draft-transport-agnostic-tools.md)). We chose this over running the agent server-side (whether on our keys or the customer's via BYOK) because per-user inference and orchestration COGS make a flat subscription bleed, and generation is a commodity while multi-platform OAuth + scheduling + the review board is the durable, already-built moat.

## Considered Options

- **BYO-agent (chosen)** — agent runs on the customer's infra; we receive a **Post-pack**. Inference *and* compute leave our infra.
- **BYOK in-app (the existing Social Copilot)** — customer's key, *our* servers run the agent. Keeps token cost off us but leaves compute, prompt-injection, and abuse on us. Retained as the in-app option, not the product's growth surface.
- **We pay for inference** — rejected; variable per-user COGS is incompatible with a flat ~$49 plan.
- **Fork Paperclip, rename "company" → "marketing agency"** — rejected; it would put us in the agent-orchestration business (against this ADR) and discard the publishing infra that is our moat. We *consume* Paperclip: an **Agency Recipe** is a Paperclip company package that targets the **Agent Interface**.

## Consequences

- **Metering must track infra-proportional axes, not tokens.** Pricing is on connected **Channels** (each adds OAuth refresh, analytics polling, webhook handling) plus scheduled-post volume; seats and media volume are secondary/overage levers.
- **Analytics must be a first-class *readable* tool** on the Agent Interface, not just an internal dashboard — it is the feedback edge that lets an External Agent close the plan → publish → measure → adjust loop.
- We stay in-repo (no new project, no port); extracting the Publishing Hub into its own package is a later, reversible carve-out, not a prerequisite.
