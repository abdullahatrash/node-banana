# THROWAWAY PROTOTYPE — Durable runtime boundary v1

This prototype exists only to answer GitHub issue 144:

> Which durable execution architecture and package boundary should own
> Content Workflow validation, Run persistence, step execution, events,
> retries, provider calls, and Artifacts while remaining callable in-process
> by Next.js, CLI, and stdio MCP?

It compares four candidate shapes against failure scenarios found in the
current codebase. It is not production runtime code and has no persistence,
network calls, provider calls, queue, or Workflow SDK integration.

## Run it

From the repository root:

```bash
pnpm prototype:runtime-boundary
```

Non-interactive:

```bash
pnpm prototype:runtime-boundary -- --matrix
pnpm prototype:runtime-boundary -- --validate
```

## Controls

- `j` / down arrow — next architecture
- `k` / up arrow — previous architecture
- `s` — next failure scenario
- `d` — toggle detailed trace
- `q` — quit

## Current-code facts represented

- Browser execution is owned by the Zustand workflow store. Closing the
  browser loses execution authority.
- Workflow files are persisted through a local filesystem route, while cloud
  generation jobs and social publishing use Postgres.
- Social publishing already uses Workflow SDK durable functions and proves the
  usefulness of durable sleep, isolated steps, and provider adapters.
- Social domain state is separately persisted in Postgres, but Workflow SDK
  history and social resource state are not one canonical Run model.
- CLI and MCP call the social service layer in-process, while REST routes and
  the browser have independently shaped entrypoints.
- The installed Workflow SDK is a 4.x beta. Current upstream documentation
  also offers Vercel, local, and Postgres execution Worlds with different
  deployment constraints.
- The repository is currently one root Next.js package, not a pnpm workspace.

## Candidates

1. **Browser Executor** — preserve Zustand as execution authority.
2. **Workflow SDK Authority** — make Workflow SDK runs and history the public
   runtime model.
3. **Standalone Runtime Service** — deploy a separate service, database, and
   workers now.
4. **Runtime Kernel + Durable Orchestrator Port** — a framework-neutral
   in-process package owns domain semantics and Postgres snapshots; Workflow
   SDK is a replaceable orchestration adapter.

The matrix is intentionally opinionated: it tests the already-agreed
requirements rather than awarding generic architecture points.

## Selected kernel boundary

The failure matrix selected:

- `packages/runtime` (`@node-banana/runtime`) — framework-neutral contracts,
  workflow validation, capability handlers, domain transitions, retry policy,
  event semantics, and narrow ports.
- `capabilities` entrypoint — the only executable surface exposed to Next.js,
  CLI, stdio MCP, REST, and Cockpit adapters.
- `workers` entrypoint — an internal surface used only by the durable
  orchestrator to advance already-authorized work from stable references.
- Host-side Postgres adapter — authoritative snapshots, Attempts, Events,
  idempotency receipts, authorization evidence, transactional execution
  outbox, leases, and fencing.
- Host-side Artifact Store adapter — immutable bytes only; Postgres retains
  canonical Artifact metadata, hashes, references, and lineage.
- Host-side Provider Adapters — one fenced intended external effect per
  runtime Attempt and a normalized `succeeded`, `failed_known`, or
  `outcome_unknown` result.
- Host-side Workflow SDK adapter — schedules and resumes work from stable Run
  references; it never becomes public Run authority.
- Composition root — injects the same adapters for Next.js, CLI, MCP, and
  durable worker entrypoints.

An accepted command transaction writes its domain resource, initial event,
idempotency receipt, authorization and approval evidence, and outbox intent
before returning. An immediate relay and scheduled recovery sweeper start or
resume the durable orchestrator idempotently. Short-lived worker commands use
fenced leases; the orchestrator owns long waits.

Provider failures are caught and recorded as runtime Attempt outcomes. The
orchestrator does not invent semantic retries. Infrastructure re-entry for the
same Attempt uses the same Effect Key; an unknown outcome blocks for
reconciliation rather than blindly publishing or generating again.

Only an immutable, normalized Content Workflow Revision is executable. Mutable
canvas JSON and editor layout never become Run authority.

The first durable adapter is Workflow SDK with a pinned version: Vercel World
for hosted production, Local World for development only, and Postgres World
only for self-hosting with a long-lived worker. SDK IDs and history remain
internal.

## Deferred implementation detail

- The prototype does not decide concrete table layouts.
- It does not specify the migration sequence from canvas JSON; that belongs to
  issue 145.
- It does not define metering, quotas, or diagnostic retention; that belongs to
  issue 147.
