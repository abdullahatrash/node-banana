# Agent Interface Ships REST-First With a Bearer Agent Key; MCP + OAuth Deferred

Status: Superseded for Content Operations Runtime transport sequencing by
[ADR 0013](0013-content-operations-runtime-capability-entrypoint.md). The
stable Workspace-bound Agent Principal and shared-application-layer concerns
remain applicable.

The first build of the **Agent Interface** is a thin REST ingest endpoint authenticated by a static **Agent Key** sent as `Authorization: Bearer <token>` — enough to dogfood the loop by repointing the `flowleap-social-factory` runner at it and watching **Post-packs** land on the review board. The MCP server is a later, thin adapter over the *same* tool layer (ADR [0008](0008-social-copilot-persisted-draft-transport-agnostic-tools.md)); full OAuth 2.1 (authorization server, dynamic client registration, the elicitation-based connect flow from the MCP 2025-11-25 spec) is deferred until there is paying multi-tenant demand. A plain Bearer token is already valid under the MCP authorization spec, so this does not block the "native to any agent" positioning — it only defers the public-distribution machinery.

## Why

The unproven risk is the *loop* (does agent → review → schedule → publish feel good with real content?), not the transport. REST + Bearer validates that in ~a day; MCP + OAuth is positioning that is wasted effort if the loop itself doesn't land. We chose this over MCP-first to avoid paying packaging, distribution, and OAuth-resource-server cost before the product is validated.

## Consequences

- The Bearer key resolves a stable Workspace-bound **Agent Principal**. Capability scopes and explicit resource allow-lists are enforced in the shared application layer; versioned **Auto-publish Grants** belong to the Principal rather than the rotatable key (ADR [0010](0010-external-agent-default-review-opt-in-autonomy.md)).
- "Native to any agent" is honest at REST stage (any harness can `POST` with a Bearer header); MCP makes it *zero-integration*, which is a later upgrade, not a prerequisite.
