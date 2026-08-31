# THROWAWAY PROTOTYPE — Publishing Plan v1

This prototype exists only to answer GitHub issue 141:

> Does a revision-bound Publishing Plan, per-target readiness, durable
> Approval, and separate Delivery lifecycle make scheduling and publishing
> safe and understandable for both agents and humans?

It is not production runtime code. It has no persistence, authentication,
provider calls, background scheduler, retries, or UI.

## Run it

From the repository root:

```bash
pnpm exec tsx prototypes/throwaway-publishing-plan-v1/cli.ts
```

To validate only the strict example contract:

```bash
pnpm exec tsx prototypes/throwaway-publishing-plan-v1/cli.ts --validate
```

The walkthrough prints every immutable Plan revision, validation result,
Approval, Delivery, rejected unsafe transition, and the complete in-memory
state.

## Files

- `example-plan.json` — proposed strict public `publishing-plan/v1` document.
- `contracts.ts` — versioned Plan, validation, Approval, and Delivery shapes.
- `machine.ts` — pure in-memory state machine and safety invariants.
- `cli.ts` — disposable executable walkthrough.

## Contract position being tested

1. An agent authors strict `publishing-plan/v1` JSON without a revision or
   digest.
2. Each accepted save creates an immutable
   `publishing-plan-revision/v1` envelope with a runtime-computed canonical
   SHA-256 digest. The logical Plan points to the latest revision.
3. One target means one exact Channel, content selection, set of Publishing
   Settings, and timing intent. Per-target modeling keeps readiness and
   delivery outcomes independent across Channels.
4. Target content may contain authored text, immutable Artifact bindings, or
   both. Artifact hashes pin the reviewed bytes.
5. `now` and `at` are distinct timing modes. An `at` value is an ISO-8601
   instant; the scheduler never interprets an ambiguous local time. An
   optional valid IANA timezone is display context only and has no execution
   meaning.
6. Publish Validation is a durable result bound to the exact Plan id,
   revision, and digest. Readiness is recorded separately for every target.
7. An Approval is a separate durable resource, not a boolean on a Post or an
   ephemeral tool prompt.
8. An Approval starts `pending` and can become `approved`, `revoked`, or
   `expired`. Release atomically transitions an approved decision to
   `consumed`. Only pending or approved decisions can be revoked; consumed
   Approval is immutable audit history.
9. Every Approval is bound to the exact Plan revision/digest, action
   (`schedule` or `publish-now`), and complete target set. It records requester,
   decision basis, decision time, expiry, and any revocation without embedding
   credentials.
10. Only the current Plan revision can request Approval or create new
    Deliveries. Editing Plan content, settings, Channel, Artifact hash, or
    timing creates a new revision that old Approval cannot authorize.
11. Previously created Deliveries keep their original revision snapshot after
    a new Plan revision is created. Editing does not silently mutate or cancel
    already released work.
12. Release rechecks readiness and Approval against the exact revision and
    target set. One Approval can create only one release: it is consumed
    atomically with creation of exactly one Delivery per approved target.
13. Repeating the same release idempotency key returns those existing
    Deliveries. A different release command cannot reuse a consumed Approval.
    Provider retries continue inside the original Delivery and never consume
    Approval again.
14. A successful release creates one Delivery per target. Approval state and
    provider execution state are never overloaded into one field.
15. Scheduled and immediate targets begin at `scheduled` and `queued`
    respectively. Delivery transitions are:
    `scheduled → queued → publishing → published|failed`. A pre-publish gate
    may move scheduled or queued work to `blocked`; remediated work returns to
    `queued`. Cancellation is allowed before provider publishing begins.
16. After release, cancellation belongs to each Delivery rather than its
    consumed Approval. Scheduled or queued Delivery can be cancelled. Once
    provider publishing begins, cancellation is rejected because the external
    side effect may already be underway.
17. Changing content, Artifact bindings, Channel, Publishing Settings, or
    timing never mutates released work. The caller cancels eligible old
    Deliveries, creates a new Plan revision, validates it, and obtains new
    Approval.
18. A published Delivery requires a stable provider post reference. A failed
    Delivery requires a sanitized structured error.
19. Overall Plan progress is derived from its revision-bound validations,
    Approvals, and per-target Deliveries instead of a single ambiguous Post
    status.
20. A multi-Channel Plan advances target-by-target. Any non-empty exact subset
    of ready Targets that shares one action can be approved and released
    together while unready Targets remain untouched.
21. Delivery failure or cancellation on one Channel never rolls back a
    successful Delivery on another Channel. V1 provides no cross-platform
    all-or-nothing transaction.
22. Publish Validation is a durable point-in-time result with an explicit
    trigger: direct request, release gate, or pre-publish gate. It is evidence,
    not permanent authorization.
23. Release always records fresh readiness before consuming Approval. If live
    Channel state, Artifact availability, timing, or policy blocks a Target,
    no Delivery is created and the Approval remains approved until fixed,
    revoked, or expired.
24. A Delivery validates again immediately before entering provider
    publishing. Readiness drift never permits a stale validation result to
    authorize an external side effect.
25. Failed pre-publish readiness moves the Delivery to durable `blocked` with
    a structured reason and validation reference. No provider call occurs.
26. Restoring external readiness—such as reconnecting the same Channel or
    restoring the same Artifact—may resume the same Delivery without new
    Approval. Changing approved content, settings, Channel, Artifact binding,
    or timing still requires cancellation and a new Plan revision.
27. Every pending or approved Approval has a required expiry bounded by
    Workspace policy. A caller may choose a shorter lifetime but never extend
    beyond the policy maximum or request an indefinite decision.
28. Expiry is terminal for an unconsumed Approval and requires a new decision.
    Consumed Approval remains immutable history, and its expiry never cancels
    Deliveries already created from it.
29. Human review and policy-based auto-publish produce the same Approval
    resource and use the same release path. A strict decision union records
    either the real human approver or the exact policy, version, and evaluation
    reference; policy approval never fabricates a human actor.
30. Publishing Plan v1 contains only concrete one-time `now` or `at` timing.
    Recurring rules are rejected by the strict contract and belong to
    Automation, which materializes concrete publishing work for each
    occurrence.
31. Every provider-facing try is an immutable Attempt inside one Delivery.
    Attempts record their number, start, finish, sanitized error, and outcome;
    later retries never overwrite earlier evidence.
32. A known-safe transient failure schedules bounded backoff and retries inside
    the same Delivery without consuming more Approval.
33. If request bytes may have reached the Platform but the response is lost,
    the Attempt becomes `outcome_unknown` and the Delivery becomes blocked.
    It cannot resume through normal readiness remediation; provider
    reconciliation must first establish whether the post exists.
34. A non-retryable failure or exhausted attempt budget makes the Delivery
    terminally failed.
35. Manual retry of a terminally failed Delivery requires fresh Approval and
    creates a new Delivery for the unchanged Plan revision. This preserves the
    single-use Approval invariant and makes duplicate-post risk explicit.
36. Creating a new Plan revision automatically makes every pending or approved
    but unconsumed Approval for an older revision terminally `superseded`.
    Supersession records the replacing revision and time. Consumed Approvals
    and their Deliveries remain untouched history.

## Deliberate boundaries

- The prototype uses a tiny fake Channel registry for YouTube and Reddit.
  Production validation remains owned by versioned Platform capabilities and
  Provider Adapters.
- Actor references are opaque strings. Agent Principal identity, scopes,
  workspace authorization, human roles, policy evaluation, and auto-publish
  authority belong to issue 143.
- The prototype's 24-hour maximum Approval lifetime is illustrative. The
  production maximum and narrower per-action limits belong to Workspace policy
  in issue 143.
- Every release requires a durable Approval. The prototype demonstrates both a
  human decision and a policy decision; the exact principals, policy scopes,
  and evaluation rules remain in issue 143.
- Approval events, retention, audit transport, quota checks, retries, and
  provider diagnostics belong to the runtime and operations tickets.
- Recurring schedules belong to Automation. A Publishing Plan contains only
  concrete one-time timing intents.
