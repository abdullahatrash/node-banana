# THROWAWAY PROTOTYPE — Content Workflow v1 contracts

This prototype exists only to answer GitHub issue 140:

> Do the proposed `content-workflow/v1`, `workflow-run/v1`, and
> `artifact/v1` contracts make versioning, typed data flow, lineage, retries,
> and terminal run state understandable enough to specify?

It is not production runtime code. It has no persistence, provider calls,
concurrency, authentication, or publishing behavior.

## Run it

From the repository root:

```bash
pnpm exec tsx prototypes/throwaway-content-contract-v1/cli.ts
```

The TUI shows the complete in-memory Workflow Run and every Artifact after
each action.

For a non-interactive walkthrough:

```bash
pnpm exec tsx prototypes/throwaway-content-contract-v1/cli.ts --demo
```

To validate only the example JSON:

```bash
pnpm exec tsx prototypes/throwaway-content-contract-v1/cli.ts --validate
```

## Files

- `example-workflow.json` — proposed public `content-workflow/v1` document.
- `imported-artifact.json` — an `artifact/v1` import with no fabricated Run.
- `contracts.ts` — strict schemas plus semantic DAG/type validation.
- `machine.ts` — pure, in-memory Workflow Run state machine.
- `cli.ts` — disposable terminal shell around the pure model.

## Contract position being tested

1. An agent authors strict `content-workflow/v1` JSON without a digest.
2. On persistence, the runtime canonicalizes the full authored definition,
   computes its SHA-256 digest, and returns an immutable
   `content-workflow-version/v1` envelope identified by `id + version +
   digest`.
3. Step input bindings are the semantic graph. A second `edges` array is not
   allowed.
4. `uses` points to a versioned operation in the runtime capability registry.
   Each operation owns strict input, output, configuration, and credential-
   requirement schemas; the workflow does not duplicate them.
5. Steps bind an operation's credential requirements to logical Credential
   Slots. Workflow JSON contains no raw keys, tokens, headers, or
   environment-specific credential values.
6. At Run start, the runtime resolves each slot through a selected local or
   hosted credential profile. The Run records only profile and credential
   references plus their versions—never secret material.
7. Canvas positions are optional `ui` metadata and have no execution meaning.
8. A Workflow Run can start only from the persisted `{ id, version, digest }`
   reference and snapshots its resolved inputs.
9. A transient, retryable failure automatically appends another attempt with
   bounded backoff while `maxAttempts` remains. Attempts are never overwritten.
10. A non-retryable failure or exhausted attempt budget makes that Workflow Run
   terminally `failed`; provider failures never put it in `waiting`.
11. An explicit manual retry creates a new derived Workflow Run. It records the
   original Run, begins at the failed step, and references immutable Artifacts
   from successful upstream steps without changing the original Run.
12. `waiting` is reserved for genuine external input or approval.
13. All content uses one immutable `artifact/v1` resource with common
   workspace identity, kind, media type, storage, content hash, and lineage.
   A strict `origin` union distinguishes `workflow-step` from `import`.
14. A `workflow-step` origin records Run, step, attempt, output port, and
   operation. An `import` origin records a non-secret importer reference,
   import time, and optional external source/attribution; it never invents a
   Workflow Run.
15. Imported and generated Artifacts share downstream bindings and publishing
   compatibility. The example imported image feeds the image-generation step,
   and the generated image records it in lineage.
16. At Run creation, every Artifact input reference must exist, belong to the
    Run's Workspace, and match the kind declared by the workflow input. Imported
    Artifacts never gain fake Run fields during resolution.
17. Artifact hashes use strict lowercase `sha256:<64 hex>` form.
18. The canonical state is the `workflow-run/v1` snapshot. Events are an
   append-only observation and audit stream; reconstructing a Run solely from
   events is not required in v1.
19. Every accepted transition atomically updates the Run snapshot and appends
   one or more minimal immutable `workflow-run-event/v1` envelopes. An
   invariant checker rejects snapshot-only or event-only transitions.
20. Agents page retained Run Events with `afterSequence` and deduplicate
   deliveries by `runId + sequence`. The snapshot's `lastEventSequence` always
   matches the retained stream.
21. Events contain only stable references, reason codes, bounded retry data,
   and sanitized structured errors. Strict payload schemas reject generated
   content, raw provider responses, credentials, and arbitrary diagnostic
   fields.
22. Run Events share the Run's retention lifecycle. Verbose provider
   diagnostics are stored separately and expire sooner; the exact diagnostic
   retention duration is intentionally left to a later operations decision.
23. Publishing destinations, schedules, and approvals do not appear in these
   contracts; they belong to a separate Publishing Plan.

## Prototype simplifications

- Execution is serial even when the graph could run steps concurrently.
- Backoff is recorded but not slept; the TUI advances immediately.
- Generated content, hashes, timestamps, and IDs are deterministic placeholders.
- The operation registry contains only the two operations needed by the first
  golden path.
- The credential profile contains only non-secret references. Secret storage,
  encryption, rotation, Agent Principal authorization, and workspace policy
  belong to issue 143 and are not modeled here.
- The importer's `actor-ref` is deliberately opaque. Its eventual Agent
  Principal shape and authorization semantics also belong to issue 143.
- Input-shape policy is intentionally narrow for the first slice: the brief
  stays inline text and media inputs are Artifact
  references. Broader scalar, structured JSON, collection, and optional-input
  shapes remain a later contract detail.
