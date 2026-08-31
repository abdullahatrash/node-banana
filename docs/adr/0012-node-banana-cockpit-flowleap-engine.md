# node-banana Is the Cockpit; flowleap Is the Content Engine

Status: Superseded for Content Operations Runtime engine placement by
[ADR 0013](0013-content-operations-runtime-capability-entrypoint.md). The
Cockpit's human governance role and versioned artifact-boundary concerns
remain applicable.

The product is a personal AI marketing agency spanning the full lifecycle (`brief → strategy → creative → approval → production → launch → reporting`). That lifecycle is split across two existing codebases: **node-banana is the human-facing Cockpit** (visual creative, approval, multi-platform launch, reporting) and the **flowleap content factory** (`flowleap-migration/tanstack-start`) is the headless, Git-native **Content Engine** (brief → strategy → text creative → quality-gated verify → approval), which already runs in production for GEO answer pages. The two couple via a stable artifact **contract** (the Post-pack / answer-page artifact), not a shared database. We chose this over merging flowleap's loop into node-banana (would rebuild a working production loop — the most expensive path) and over making flowleap the whole agency with node-banana as a called service (leaves the human stages — visual creative, approval, launch, reporting — without a cockpit). The BYO-agent boundary (ADR [0009](0009-agent-native-publishing-byo-agent.md)) holds at this altitude: agents run on the user's side; the product is the circuit, the state, and the gates.

## Consequences

- node-banana's build focus is the **cockpit stages**: Launch (already built) and Reporting — starting with **GEO citation tracking**, the north-star metric.
- The seam between engine and cockpit is the artifact contract, kept versioned and decoupled (see `post-pack/v1`, ADR-adjacent in CONTEXT.md).
- Self-use-first defers pricing, metering, multi-tenant, and MCP-for-strangers. The publishing ingest slices (#95–#99) are the Launch-stage implementation, shelved until the spine reaches them.
