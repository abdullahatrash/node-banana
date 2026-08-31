# THROWAWAY PROTOTYPE — Application Capability catalog v1

This prototype exists only to answer GitHub issue 142:

> Which atomic read, plan, execute, inspect, approve, and schedule
> capabilities must the Content Operations Runtime expose, what are their
> effect and idempotency semantics, and how must CLI, stdio MCP, REST, and the
> Cockpit map onto that single catalog without behavioral drift?

It is not production registry, transport, authorization, or runtime code. It
has no persistence, network calls, credentials, provider adapters, or UI.

## Run it

From the repository root:

```bash
pnpm prototype:capabilities
```

The TUI exposes the entire candidate definition for every capability and its
mapping through each transport.

For non-interactive output:

```bash
pnpm prototype:capabilities -- --validate
pnpm prototype:capabilities -- --dump
```

## Controls

- `j` / down arrow — next capability
- `k` / up arrow — previous capability
- `t` — next transport
- `m` — toggle canonical request and transport mapping
- `q` — quit

## Candidate position being tested

These are deliberately visible decisions, not settled production design:

1. One versioned Application Capability owns input, output, errors, effects,
   idempotency, authorization, approval, and audit semantics.
2. Capability IDs are stable dotted resource/action names. Contract version is
   independent of the name.
3. Each capability declares structured effect semantics: mutation reach,
   visibility, timing, reversibility, and possible provider spend. Transport
   warnings are derived from that declaration.
4. Every capability declares exactly one idempotency policy: queries are
   `retry-safe`, desired-state commands are `intrinsic`, and commands that
   create work are `key-required`.
5. A required key is scoped by Workspace, Principal, Capability Identity, and
   key. Exact canonical-input replay returns the original receipt; different
   input conflicts. Acceptance and receipt persistence are atomic.
6. Provider execution uses a separate runtime-owned Effect Key that remains
   stable across internal attempts and reconciliation.
7. Long-running work returns `accepted` with its authoritative domain resource,
   inspect capability, and initial event cursor. There is no parallel generic
   Job model.
8. `accepted` means authorization evidence, idempotency receipt, domain
   resource, and durable execution intent were persisted atomically. It never
   means execution completed.
9. Every capability declares `none`, `manages-approval`, or
   `required-before-effect`. A missing gate returns a structured next step, but
   no transport confirmation can authorize execution.
10. CLI, MCP, REST, and Cockpit adapters receive the same canonical invocation
   envelope. Each mapping reports the canonical capability ID and version.
11. Failures use one canonical Capability Error with stable codes, safe typed
   recovery details, and an opaque trace reference. Transport statuses and
   presentation are derived.
12. High-level outcomes are versioned Agent Recipes that expose their atomic
    capability steps, approval pauses, partial progress, and recovery. Recipes
    own no hidden runtime behavior or parallel durable state.
13. Collections use one opaque, context-bound cursor page. Resource events use
    one per-resource sequence page; snapshots remain authoritative and every
    read rechecks current authorization.
14. Authorization may expose only a subset of the catalog to a caller.
    Human-only administration remains catalogued and carries explicit
    Principal-kind and scope requirements.
15. CLI, MCP, REST, and Cockpit are generated around one dispatcher and parity
    tested. Authentication resolves Security Context before dispatch; caller
    input cannot supply Principal or Workspace identity.
16. Published capability versions are immutable, digest-pinned, and explicitly
    selected. Versions follow an experimental, active, deprecated, or retired
    lifecycle; there is no executable `latest`.
17. Internal worker dispatch, Provider Adapter calls, Workflow node operations,
    UI gestures, and transport mechanics are outside this catalog.

## Minimum v1 families

1. Discovery and effective identity.
2. Channels, connection handoffs, and safe credential metadata.
3. Workflows, immutable versions, Runs, and Run Events.
4. Artifact import, transfer handoffs, and provenance.
5. Publishing Plans, validations, Approvals, release, and Deliveries.
6. Automations, revisions, occurrences, trigger receipts, controls, and events.
7. Human-only Agent Principal, key, grant, credential, and auto-publish
   administration.
8. Security Event inspection.

The catalog uses explicit lifecycle commands rather than generic update/delete.
The accepted minimum contains 93 definitions: 71 agent-callable and 22
human-only administrative capabilities. Direct provider calls remain internal.

## Deliberate simplifications

- Schema references are symbolic instead of full JSON Schema documents.
- Future product domains may add capabilities without changing this minimum
  contract.
- Transport spellings are candidate mappings only.
- The prototype does not execute a capability. It validates and displays the
  contract and mapping that a real adapter would consume.
- Event retention, pagination limits, rate limits, compatibility windows, and
  concrete error codes remain decisions for this ticket.
