# Content Operations Runtime Uses One Versioned Capability Entrypoint

Status: Accepted for the Content Operations Runtime scope.

## Context

The agent-native runtime specification in issue #149 makes Node Banana
authoritative for deterministic workflow execution, durable state, provider
effects, Artifacts, Publishing Plans, Approvals, Deliveries, usage evidence,
and policy enforcement. External Agents still supply goals, judgment, and
orchestration, but they need one exact, inspectable application contract rather
than transport-specific business paths.

Earlier decisions were made for a narrower publishing-ingest product:

- ADR 0009 described Node Banana as a destination rather than an agent runtime.
- ADR 0011 sequenced REST before MCP.
- ADR 0012 put the Content Engine exclusively outside Node Banana.

Their useful constraints remain: agents are user-supplied, transport behavior
must be shared, human review is the default, and the Cockpit governs human
actions. Their runtime placement and transport sequencing no longer satisfy
the accepted Content Operations Runtime.

## Decision

For the Content Operations Runtime:

1. A digest-pinned Capability Registry is the only public application
   dispatcher.
2. Every invocation selects an exact immutable Capability Identity such as
   `capabilities.list@1`. Discovery may recommend an active exact version, but
   no executable `latest` alias exists.
3. CLI and stdio MCP ship as the first agent transports. REST is added later as
   a thin adapter over the already-proven dispatcher.
4. Transport adapters own authentication acquisition, framing, and
   presentation only. They never accept caller-supplied Principal or Workspace
   identity and contain no business authorization, approval, idempotency, or
   mutation behavior.
5. Node Banana owns the framework-neutral Runtime Kernel and its canonical
   domain resources. External Agents remain outside the product and call its
   atomic Application Capabilities.
6. Existing social publishing, provider, validation, persistence, and Cockpit
   code is selectively migrated behind the capability boundary. This decision
   does not require a wholesale rewrite or make transport mechanics part of
   the domain contract.

The first production slice publishes only `capabilities.list@1` and
`capabilities.get@1`, including canonical contract digests, lifecycle,
schemas, effects, approval, idempotency, and stable errors. Later capabilities
must use the same registry and dispatcher.

## Supersession Scope

This decision supersedes ADRs 0009, 0011, and 0012 only where they define the
Content Operations Runtime's execution authority, engine placement, or
REST-before-MCP sequencing. They remain historical records and retain their
directionally compatible BYO-agent economics, shared application behavior,
and Cockpit-governance concerns.

ADR 0010 remains active: publishing is human-approval-first unless an exact,
bounded policy grant authorizes otherwise.

## Consequences

- Capability contracts and their canonical digests become release evidence.
- Deprecated versions remain executable with structured warnings until
  retired; retired versions remain inspectable but reject invocation.
- CLI, MCP, future REST, and Cockpit adapters must pass canonical parity tests.
- New runtime business behavior cannot be introduced only in a transport.
- Authentication and Workspace-bound Agent Principal resolution are composed
  before dispatch and cannot be manufactured in capability input.
