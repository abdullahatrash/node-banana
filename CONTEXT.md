# Node Banana

Node Banana includes a Social Hub for planning, composing, and publishing generated media and written posts to external social platforms.

## Language

**Channel**:
A connected social publishing destination inside a workspace, backed by one platform account, page, or channel and its auth credentials.
_Avoid_: Integration, social account, provider account

**Platform**:
An external social network or publishing surface, such as YouTube, TikTok, Reddit, Instagram, X, or LinkedIn.
_Avoid_: Provider

**Provider Adapter**:
The effect-only code module that knows how to authenticate, validate, and perform one fenced external operation for a model service or **Platform**. It receives a Runtime Kernel-prepared request and stable **Effect Key**, performs at most one intended external effect, and returns only `succeeded`, `failed_known`, or `outcome_unknown` with sanitized metadata. Protocol-required polling may observe that same effect but cannot create another effect. The adapter never owns retry, domain persistence, Artifact creation, scheduling, or Run Events.
_Avoid_: Integration

**Publishing Settings**:
Platform-specific options that modify how a post is validated, previewed, or published for a selected **Channel**.
_Avoid_: Provider settings, platform settings, post settings

**Publish Validation**:
A point-in-time assessment of whether content can be sent through a **Channel** with its selected media, **Publishing Settings**, timing, and current runtime policy. It is retained as evidence but never acts as permanent authorization; the runtime reassesses readiness before release and immediately before provider publishing.
_Avoid_: Form validation, provider validation

**Safe Defaults**:
Initial **Publishing Settings** values that avoid unintended public publishing while still letting creators move quickly.
_Avoid_: Postiz defaults, platform defaults

**Publishing Readiness**:
The per-**Channel** state that tells a creator whether a **Post** has all required content, media, and **Publishing Settings** needed to schedule or publish.
_Avoid_: Form status, validation status

**Normalized Publishing Settings**:
Stored **Publishing Settings** that use stable canonical field names and primitive values rather than UI widget shapes.
_Avoid_: Raw form values

**Instance Registration**:
A stored OAuth app credential set for a federated **Platform** instance (e.g., a specific Mastodon server). One registration is shared by all **Channels** on that instance within the system.
_Avoid_: App registration, server config

**Facet**:
A byte-range annotation on post text that marks a link, @mention, or #hashtag for platforms that require explicit rich-text markup (e.g., Bluesky via AT Protocol).
_Avoid_: Entity, annotation, rich text node

**App Password Auth**:
An authentication method where the user provides a platform-generated credential directly, instead of an OAuth redirect flow. Used by Bluesky.
_Avoid_: API key auth, basic auth, direct login

**Content Warning**:
An optional spoiler or sensitivity label on a Mastodon post that collapses the main content behind a "Show more" button. A **Publishing Setting** specific to Mastodon **Channels**.
_Avoid_: CW, spoiler text, sensitive flag

**Post Visibility**:
A **Publishing Setting** that controls the audience reach of a post on federated platforms. Mastodon supports public, unlisted, private, and direct.
_Avoid_: Privacy setting, audience

**Social Copilot**:
A human-in-the-loop conversational assistant inside the Social Hub that helps a creator draft and rewrite post content, generate and attach media, select **Channels**, run **Publish Validation**, and create a scheduled draft **Post**. It proposes actions and edits drafts, but never schedules or publishes without explicit creator confirmation. Distinct from **Automation** (the rules-and-tasks engine on the existing `/social/agents` page).
_Avoid_: Agent, AI agent, copilot bot, assistant, bot

**External Agent**:
A BYO-agent harness running on the customer's own machine/infra (e.g., Claude Code, Codex, OpenClaw, Hermes) that supplies goals, judgment, and orchestration through the **Agent Interface**. It can define, validate, start, inspect, and resume content workflows and manage publishing work; durable execution belongs to the **Content Operations Runtime**. Distinct from **Social Copilot** (in-app, BYOK, runs server-side) and from **Automation** (trigger and policy rules).
_Avoid_: AI agent, bot, copilot, the agent

**Principal**:
The authenticated actor identity supplied to every Content Operations Runtime command together with its Workspace context. It is explicitly either a **Human Principal** or an **Agent Principal**; transports never authorize commands from caller-supplied user or Workspace IDs alone.
_Avoid_: user context, auth object, session user, caller

**Human Principal**:
A **Principal** representing a real signed-in person whose identity and Workspace membership come from the human authentication system.
_Avoid_: user ID, session, approver (unless making an Approval)

**Agent Principal**:
A distinct, Workspace-bound **Principal** representing one External Agent installation or operational identity. An owner or administrator creates it with an accountable human sponsor. It is `active`, reversibly `suspended`, or terminally `revoked`; sponsor loss automatically suspends it until an Owner reassigns accountability and reviews its grants. Audit evidence distinguishes the acting Agent Principal from that sponsor; the Agent never impersonates the human.
_Avoid_: service user, bot user, API user, human-on-behalf-of

**Agent Interface**:
The authenticated CLI + MCP + REST surface an **External Agent** uses to operate the **Content Operations Runtime**, including reading state, managing workflow definitions and runs, handling artifacts and approvals, and creating or scheduling publishing work. Every transport exposes the same application capabilities and policy checks.
_Avoid_: API, the MCP, integration

**Application Capability**:
One versioned, transport-neutral business query or command callable by an authorized **Human Principal** or **Agent Principal**. It owns the public input, output, error, effect, idempotency, authorization, approval, and audit contract that CLI, MCP, REST, and Cockpit adapters expose. UI gestures, transport mechanics, internal worker dispatch, Provider Adapter calls, and Workflow node operations are not Application Capabilities.
_Avoid_: tool, endpoint, route, UI action, service function

**Capability Identity**:
The stable dotted lower-snake-case resource/action name and independent positive contract version that identify an **Application Capability**, such as `workflow_runs.start@1`. The name remains transport-neutral; a breaking input, output, error, effect, idempotency, authorization, approval, or audit change increments the version instead of renaming the capability. CLI commands, MCP tool names, REST routes, and Cockpit actions are adapter mappings, not Capability Identities.
_Avoid_: tool name, endpoint name, route version, command name

**Capability Effect**:
The structured effect declaration owned by an **Application Capability**. It states the furthest mutation reach (`none`, `runtime-state`, or `external-system`), visibility (`private` or `publicly-visible`), timing (`immediate`, `durable-async`, or `future-trigger`), reversibility (`reversible`, `conditional`, or `irreversible`), and whether invocation may consume provider budget. Authorization and approval policy use this declaration; transport warnings such as MCP annotations, CLI prompts, and Cockpit affordances are derived from it and carry no independent authority.
_Avoid_: destructive flag, side-effect boolean, MCP hint, confirmation level

**Capability Idempotency**:
The retry contract owned by an **Application Capability**: `retry-safe` for queries that accept no key, `intrinsic` for desired-state commands whose target and outcome naturally deduplicate retries, or `key-required` for creates, starts, releases, retries, and other commands that can create new work. A required key is scoped by Workspace, Principal, Capability Identity, and key; exact canonical-input replay returns the original receipt or resource, while different input returns `IDEMPOTENCY_CONFLICT`. Command acceptance atomically records its receipt with the state transition or enqueue; validation and authorization rejection before acceptance do not consume the key.
_Avoid_: best-effort dedupe, request ID, retry token, provider idempotency

**Effect Key**:
A runtime-owned stable identifier for one intended provider effect. It is distinct from caller **Capability Idempotency**, remains unchanged across internal attempts, retries, and reconciliation, and is forwarded to a Provider Adapter when the provider supports native deduplication.
_Avoid_: idempotency key (unqualified), request ID, attempt ID

**Usage Ledger**:
The immutable Workspace-scoped collection of **Usage Records** for provider effects and runtime resources. It is the source of usage and cost evidence; Run, Principal, provider, operation, and Artifact totals are derived projections rather than mutable counters.
_Avoid_: cost counter, billing table, usage total, spend tracker

**Usage Record**:
An immutable metering fact bound to one provider-facing Workflow Step Attempt and Effect Key. It identifies the provider, exact model or operation version, time interval, normalized and provider-native quantities, safe evidence references, and whether each quantity is reported, measured, estimated, or unknown; corrections append records rather than rewriting one.
_Avoid_: usage event, cost row, provider response, metrics blob

**Usage Dimension**:
A versioned typed quantity name, unit, and applicability rule used by Usage Records, such as uncached input tokens, output megapixels, provider execution seconds, or Artifact bytes written. Unsupported dimensions are absent, while an applicable dimension that a provider fails to report is explicitly unknown.
_Avoid_: metric, counter, usage field, arbitrary tag

**Usage Dimension Registry**:
The canonical versioned catalog of normalized Usage Dimensions and bounded namespaced provider extensions. It permits cross-provider aggregation without accepting arbitrary JSON metric blobs or pretending unlike units are interchangeable.
_Avoid_: metrics schema, provider metadata, telemetry catalog, billing dimensions

**Pricing Snapshot**:
The immutable currency, unit rates, tiers, source, effective time, and calculation rules used to value exact Usage Records. It preserves historical valuation when a model price changes and never converts unknown usage or pricing into zero cost.
_Avoid_: price table, current pricing, model cost, billing config

**FX Snapshot**:
The immutable source, effective time, currency pair, and exact decimal exchange rate used to compare a Cost Valuation with a Budget Policy in another currency. Without one, cross-currency spend remains unknown to that policy.
_Avoid_: exchange rate, currency conversion, current FX, converted cost

**Workspace Pricing Override**:
An immutable audited human-authored rate or credit conversion for an exact provider, operation, model or version, and service tier in one Workspace. It supersedes the built-in pricing catalog for new snapshots only and never changes historical Runs.
_Avoid_: custom price, billing override, model price setting, manual cost

**Cost Valuation**:
The immutable monetary interpretation of one or more Usage Records under an exact **Pricing Snapshot**. Its basis is provider-reported, runtime-calculated, or unknown, and later reconciliation appends a superseding valuation while preserving the earlier evidence.
_Avoid_: total cost, estimated price, charge, invoice line

**Direct Usage Attribution**:
The explicit share of a Usage Record assigned to an Artifact directly created or imported by that effect. It is exact when provider evidence or the operation contract defines a defensible allocation; otherwise the Artifact references shared unallocated usage rather than inventing a split.
_Avoid_: artifact cost, cost allocation, inherited usage, generated price

**Lineage Cost Context**:
The read-only view of upstream Usage Records and Cost Valuations that contributed to an Artifact through lineage. It explains provenance but creates no new charge and is never safe to sum across sibling or descendant Artifacts.
_Avoid_: cumulative artifact cost, inherited charge, rolled-up cost, total asset value

**Budget Policy**:
An immutable Workspace or Agent Principal spending guardrail with one currency, accounting window, warning thresholds, hard limit, and explicit treatment of unknown-priced operations. Agent Principal policy narrows the Workspace policy; both attribute the same Usage Records without double-counting spend.
_Avoid_: billing plan, wallet, quota, cost alert

**Budget Period**:
The fixed calendar day, week, month, or lifetime interval in an explicit IANA timezone against which one Budget Reservation is admitted. A Run remains assigned to the period active at Durable Acceptance even when its effects settle after that period ends.
_Avoid_: billing cycle, rolling window, invoice period, reset date

**Run Cost Ceiling**:
The conservative maximum monetary exposure of one Workflow Run under its immutable Revision, resolved operations, automatic retry limits, and Pricing Snapshots. The ceiling is established before Durable Acceptance and bounds all provider effects of that Run.
_Avoid_: estimated cost, predicted total, budget, maximum tokens

**Run Admission Preview**:
The non-binding evaluation of a proposed Workflow Run against current Pricing Snapshots, Credential Spend Grants, Budget Policies, Quota Policies, and operation limits. It exposes the proposed Run Cost Ceiling, uncertainty, required reservations, and current admissibility, while Run start always re-evaluates transactionally.
_Avoid_: dry run, quote, cost estimate, preauthorization

**Budget Reservation**:
A durable hold against applicable Budget Policies for the unspent portion of an accepted Run Cost Ceiling or one child provider effect. Settlement converts known usage into Cost Valuation and releases unused capacity, while an outcome-unknown effect retains its hold until reconciliation.
_Avoid_: authorization hold, reserved credits, pending charge, spend lock

**Usage Settlement**:
The atomic post-effect transition that records a Workflow Step Attempt outcome, safe provider evidence, Usage Records, Cost Valuations, reservation changes, resulting Artifact metadata, Run snapshot, and ordered Run Events. If the provider outcome is unknown, settlement remains incomplete and the reservations stay held until reconciliation.
_Avoid_: cost update, billing reconciliation, usage flush, metrics emission

**Emergency Spend Suspension**:
An explicit Owner-controlled Workspace policy state that prevents new provider effects, including effects covered by earlier Budget Reservations. It blocks accepted Runs at their next provider boundary without erasing Durable Acceptance, Usage Records, or reservations.
_Avoid_: pause billing, disable provider, lower budget, cancel runs

**Quota Policy**:
An immutable non-monetary Workspace or Agent Principal guardrail for one Usage Dimension, window or capacity, warning thresholds, hard limit, reservation rule, and exhaustion behavior. Agent Principal quotas narrow Workspace quotas and remain distinct from monetary Budget Policies.
_Avoid_: budget, billing limit, plan check, rate limiter

**Quota Reservation**:
A durable claim on finite quota capacity for an accepted resource or future operation, such as an active Run slot or maximum Artifact output bytes. It is acquired atomically at the applicable admission boundary and released or settled from canonical resource transitions.
_Avoid_: counter increment, lease, capacity lock, provisional usage

**Quota Wait**:
The non-terminal state of an accepted Workflow Run whose renewable concurrency or rate capacity is temporarily unavailable. It records the exhausted Usage Dimension and exact eligibility condition; the runtime resumes it without an agent retry when capacity becomes available.
_Avoid_: retry later, rate-limit error, queued job, paused run

**Capability Result**:
The transport-neutral response envelope of an **Application Capability**. It identifies the Capability Identity and request and has status `completed` or `accepted`. `completed` contains the final immediate result. `accepted` proves that authorization, idempotency receipt, domain-resource creation, and durable execution intent succeeded atomically; it contains the current domain resource reference, its canonical inspect capability, and an initial event cursor when that resource has an event stream.
_Avoid_: tool result, HTTP response, job response, task result

**Durable Acceptance**:
The `accepted` **Capability Result** for asynchronous work. It is returned only after one Postgres transaction has persisted the canonical domain resource or transition, initial ordered event, idempotency receipt, required authorization and approval evidence, and an **Execution Outbox Intent**. A Durable Acceptance never claims the work completed and never creates a parallel generic Job resource: Workflow execution returns a **Workflow Run**, publishing release returns **Publishing Deliveries**, and Automation invocation returns an **Automation Occurrence**. Domain resource state remains authoritative; wait, polling, and live-update conveniences compose its canonical inspect and event capabilities.
_Avoid_: background job, async task, pending response, fire-and-forget

**Execution Outbox Intent**:
A transactional record that stable domain work is ready for durable scheduling. An idempotent relay delivers it to the configured **Durable Orchestrator** after acceptance; repeated delivery starts or resumes the same domain work rather than creating another Run, Delivery, Occurrence, Attempt, or provider effect.
_Avoid_: job, queue message, workflow run, fire-and-forget event

**Execution Lease**:
A short-lived fenced claim that permits one worker invocation to advance a specific mutable execution transition. Redelivery may reacquire an expired lease and resume the same stable domain work, but a stale holder cannot commit after a newer fence exists. A lease is operational coordination, not Workflow Run or Attempt identity.
_Avoid_: lock, worker ownership, attempt, orchestrator run

**Capability Approval Contract**:
The approval behavior declared by an **Application Capability**: `none`, `manages-approval` for requesting, observing, deciding, or revoking durable Approval resources, or `required-before-effect` for commands that must receive and validate an exact durable Approval reference before acceptance. Missing or invalid evidence returns `APPROVAL_REQUIRED` or `APPROVAL_INVALID` with the canonical request capability and safe prefilled context. Approval is enforced inside the capability and never grants missing authorization scope; transport confirmations and hints are guidance only.
_Avoid_: approval flag, confirmation prompt, MCP approval, approved boolean

**Capability Error**:
The transport-neutral failure envelope of an **Application Capability**. It identifies the Capability Identity and request, then provides a stable machine-readable code and category, safe message, retryability and optional delay, typed field or conflict details, safe remediation through canonical capabilities, and an opaque operator trace reference. REST status, CLI exit code, MCP error shape, and Cockpit presentation are derived mappings; raw provider responses, secrets, stack traces, and cross-Workspace existence never appear.
_Avoid_: HTTP error, tool error, exception response, provider error

**Agent Recipe**:
A versioned, non-authoritative orchestration guide that helps an **External Agent**, CLI convenience command, skill, or Cockpit wizard achieve a goal by invoking atomic **Application Capabilities** and referencing Content Workflows or Automations. It exposes its ordered steps, branches, approval pauses, partial progress, and recovery actions but owns no hidden business behavior or parallel durable state. If composition needs its own durable execution, atomicity, idempotency, approval, or authorization boundary, it becomes a domain resource and Application Capability instead.
_Avoid_: mega-tool, convenience endpoint, agent workflow (unqualified), hidden orchestration

**Capability Page**:
The standard collection result of an **Application Capability**, containing `items` and an optional opaque `nextCursor`. The cursor is bound to the Workspace, Principal, Capability Identity, normalized filters, and stable sort; every page read rechecks current authorization. A total count is optional and never implied.
_Avoid_: list response, offset page, REST pagination, MCP pagination

**Capability Event Page**:
The standard ordered observation result for one durable domain resource. The query accepts `afterSequence` and returns `events`, `nextSequence`, and `latestSequence`; sequence is monotonic within the resource. The canonical snapshot remains authoritative, while CLI wait, MCP polling, REST streaming, and Cockpit subscriptions project the same retained event records.
_Avoid_: event stream (unqualified), websocket event, SSE payload, notification feed

**Capability Registry**:
The single runtime source of truth for every versioned **Application Capability** definition and handler binding. It generates JSON Schema, CLI help, MCP tool definitions, REST/OpenAPI descriptions, typed Cockpit SDK bindings, and effect warnings. It never accepts caller-supplied Principal or Workspace identity; each transport authenticates first and the shared dispatcher invokes the registered handler with one resolved Security Context.
_Avoid_: tool registry, route registry, MCP server, API schema

**Transport Parity Contract**:
The rule that CLI, stdio MCP, REST, and Cockpit normalize into the same **Capability Registry** dispatcher and return the same Capability Result or Capability Error. Adapters own authentication acquisition, framing, streaming, and presentation only. Golden parity tests submit equivalent invocations through every adapter and compare authorization, approval, idempotency, effects, results, and errors.
_Avoid_: API parity, similar behavior, shared types only

**Capability Lifecycle**:
The publication state of one immutable **Capability Identity** version: `experimental`, `active`, `deprecated`, or `retired`. Invocation always selects an exact version; discovery may identify a recommended version but no executable `latest` alias exists. A canonical digest covers the immutable contract, multiple versions may coexist, deprecated definitions name replacement and sunset metadata, and retired versions remain inspectable for audit but reject invocation with `CAPABILITY_VERSION_RETIRED`.
_Avoid_: API version, latest version, tool revision, rolling schema

**Agent Key**:
A high-entropy opaque credential an **External Agent** uses to authenticate an exact **Agent Principal** to one **Workspace** through the **Agent Interface**. Plaintext is shown only at creation; the runtime retains a lookup prefix and cryptographic hash. Keys are named, may expire, support overlapping rotation and revocation, and retain creation and last-used metadata. CLI, stdio MCP, and hosted REST resolve the same identity from this credential.
_Avoid_: API key (unqualified), token, secret

**Agent Pairing**:
The human-confirmed local flow that creates an **Agent Principal** and its initial **Agent Key**. A short-lived single-use challenge opens the Cockpit, where a signed-in human selects the Workspace and reviews the Agent's grants before confirmation. The resulting plaintext credential is returned once to the CLI and stored in an OS credential manager or a permission-restricted local profile.
_Avoid_: agent login, OAuth, device authorization, copy a user ID

**Principal Grant Set**:
The deny-by-default set of capability scopes and explicit resource allow-lists assigned to a **Principal** in one Workspace. Agent grants may name allowed Channels, Credential Profiles, Workflows, and Automations; adding a new Workspace resource never silently expands authority. Effective Agent authority is the intersection of the active Principal, active Agent Key, Principal Grant Set, key scopes, resource constraints, Workspace policy, and current resource state. A key may narrow but never expand its Principal's authority.
_Avoid_: role, permissions object, API-key access, superadmin

**Approval Authority**:
An explicit human-only grant to decide **Publishing Approvals** for bounded Channels and publishing actions. Workspace Owners receive it by default; other Human Principals require an explicit grant. It is distinct from `publishing:release`, which only permits invoking release after valid Approval.
_Avoid_: publish permission, approver role, admin approval

**Authorization Decision**:
Durable evidence of an authorization evaluation at command admission or immediately before an external or irreversible effect. It records the requesting Principal, non-secret Agent Key identity when applicable, required scope, resource constraints, policy versions, result, reason, and time. Runtime workers act from persisted authorized intent without holding the caller's key or impersonating that Principal.
_Avoid_: permission check, middleware result, auth log

**Security Event**:
An immutable, access-controlled audit event for Principal, authentication, Agent Key, grant, Credential Profile, policy, authorization, or Approval activity. It identifies the Workspace, acting Principal, affected non-secret references, action, result, structured reason, time, and correlation/idempotency reference without retaining secret material. Exact retention belongs to Workspace telemetry policy.
_Avoid_: application log, auth log, analytics event

**Durable Contract Evidence**:
The canonical non-content facts required to inspect, authorize, meter, audit, reconcile, or reproduce a domain resource, including safe identities, state, events, effect evidence, Usage Records, policy decisions, and provenance. It follows the owning resource's retention and is never reconstructed from operational telemetry.
_Avoid_: audit log, telemetry, trace, debug metadata

**Operational Metric**:
A non-authoritative low-cardinality aggregate of runtime health or demand, such as latency, queue depth, throughput, structured error counts, retry rate, quota pressure, storage growth, or projected spend. It contains no prompt, generated content, secret, signed URL, or raw resource payload.
_Avoid_: usage record, business event, analytics event, diagnostic log

**Diagnostic Trace**:
A short-lived operator-only correlation of sanitized logs and spans for one runtime path. It may retain timing, component and version, allowlisted status metadata, retry decisions, and stack traces, but never credentials, authorization material, prompts, generated content, media bytes, signed URLs, arbitrary headers, or raw provider bodies.
_Avoid_: Run Event, provider log, request dump, audit trail

**Operator Trace Reference**:
An opaque non-secret identifier returned in safe Capability Errors and events so an authorized operator can locate a Diagnostic Trace. It reveals no diagnostic content or cross-Workspace resource existence to the caller.
_Avoid_: request ID, stack trace, log URL, provider request ID

**Support Bundle**:
An explicitly consented, user-selected, access-controlled diagnostic export that may include chosen canonical content for a bounded support purpose. It is never captured automatically and has its own short expiry and audit evidence.
_Avoid_: debug dump, automatic capture, trace archive, support logs

**Agent Usage View**:
The access-controlled projection of Usage Records, Cost Valuations, active reservations, and effective Budget and Quota capacity attributable to one Agent Principal and its authorized resources. It exposes enough price certainty and admissibility evidence for planning without granting Workspace billing administration or Diagnostic Trace access.
_Avoid_: billing dashboard, usage API, agent telemetry, cost report

**Metering Event**:
A minimal immutable Workspace-scoped event referencing an accepted usage, valuation, reservation, policy, warning, block, wait, resume, correction, or release transition. It supports cursor-based agent observation and audit while canonical resources and projections remain authoritative.
_Avoid_: metric, billing event, alert, log message

**Telemetry Operator Grant**:
A time-bounded human-only Workspace grant to inspect authorized Diagnostic Traces and consented Support Bundles for operational support. Every use creates a Security Event and never expands access to another Workspace.
_Avoid_: support role, admin access, observability permission, debug mode

**Workspace Retention Policy**:
The immutable versioned durations and expiry rules for canonical resources, Durable Contract Evidence, Operational Metrics, Diagnostic Traces, orchestrator history, Support Bundles, and acceptance evidence in one Workspace. It may shorten inactive history but never remove evidence required by active safety, idempotency, approval, delivery, reservation, or reconciliation obligations.
_Avoid_: log retention, cleanup schedule, data lifecycle config, TTL settings

**Retention Tombstone**:
The minimal non-content identity, digest, terminal state, and idempotency evidence preserved after an eligible canonical resource expires or is deleted. It prevents identity reuse and duplicate effects without retaining prompts, generated content, Artifact bytes, diagnostics, or secrets.
_Avoid_: soft delete, archived resource, deletion marker, audit copy

**Security Context**:
The normalized, non-secret command context containing the resolved Workspace, **Principal**, authentication reference, effective grants, and correlation identity. Every transport and durable worker supplies this same shape to application capabilities; raw sessions, headers, environment IDs, and bearer plaintext never enter domain commands.
_Avoid_: request context, user context, auth headers, session

**Security Contract v1**:
The strict public document family `agent-principal/v1`, `agent-key-metadata/v1`, `agent-pairing-challenge/v1`, `principal-grant-set/v1`, `credential-profile/v1`, `credential-version-ref/v1`, `auto-publish-grant/v1`, `authorization-decision/v1`, and `security-event/v1`. Unknown fields and cross-Workspace references are rejected; policy and grant revisions are immutable and runtime-digested. Secret-bearing creation and handoff inputs are write-only and never appear in these documents.
_Avoid_: auth payload, permissions JSON, API-key schema, security metadata

**Post-pack**:
The submission payload an **External Agent** sends through the **Agent Interface**: post content, media references, target **Channels**, **Publishing Settings**, and optional provenance (grounding sources, scorecard, editor decision). A versioned, strict public contract (`post-pack/v1`) mapped onto the internal **Post** model at the boundary — not a mirror of it — so internals stay refactorable while the contract stays stable for **Agency Recipes**. Unknown fields are rejected. It becomes a draft **Post**.
_Avoid_: payload, submission, content blob

**Agency Recipe**:
A distributable agent-company package (e.g., a Paperclip `COMPANY.md`) defining a team of **External Agents** and their goals, configured to target a Node Banana **Workspace** through the **Agent Interface**. This is what a customer means by "a marketing agency" — the importable recipe, not Node Banana itself and not the harness that runs it.
_Avoid_: company, marketing agency (for the hub), template

**Auto-publish Grant**:
A versioned, expiring Workspace policy grant bound to an exact **Agent Principal**, exact **Channels**, publishing actions, and safety limits including rolling volume and scheduling horizon. Evaluation occurs per Target against an exact **Publishing Plan Revision** and returns allow, review, or deny with durable evidence. Allow creates a policy-based **Publishing Approval** and uses standard release; review requires human Approval; deny creates no Approval or Delivery. Rotating an Agent Key does not change this grant.
_Avoid_: Auto-publish Scope, auto-post, trusted key, full access

**Agency Lifecycle**:
The end-to-end stages the product orchestrates: brief → strategy → creative → approval → production → launch → reporting → repeat. The "agency" is this lifecycle, run with the user's own agents as the brain at each stage (see ADR 0009, 0012).
_Avoid_: pipeline, funnel, the loop (unqualified)

**Cockpit**:
The human-facing surface adjacent to the **Content Operations Runtime**. It lets people author and inspect workflows visually, observe and replay runs, review artifacts, approve gated actions, launch to **Channels**, and read reporting. It is one client of the runtime, not the place where workflow execution lives.
_Avoid_: dashboard, the app, frontend

**Content Operations Runtime**:
Node Banana's headless, durable execution core. It owns versioned workflow definitions, workflow runs, artifacts, approval gates, publishing plans, and scheduling. The **Agent Interface** and **Cockpit** are equal clients of this runtime; an **External Agent** supplies intent and judgment but does not replace the runtime.
_Avoid_: Content Engine, backend, workflow UI, the engine

**Runtime Kernel**:
The framework-neutral, in-process application boundary of the **Content Operations Runtime**, enforced as the `packages/runtime` workspace package. It owns Application Capability dispatch, Content Workflow validation, canonical Workflow Run and Attempt transitions, Run Events, retry semantics, Artifact metadata, and provider-effect fencing through explicit ports. Its Postgres-backed domain snapshots are authoritative; it has no dependency on Next.js, a transport, a Provider Adapter implementation, or a durable-orchestration SDK.
_Avoid_: workflow service, browser executor, Workflow SDK runtime, orchestration service

**Capability Entrypoint**:
The Runtime Kernel's authenticated executable surface for Application Capability commands and queries. Next.js, CLI, stdio MCP, REST, and Cockpit adapters all normalize requests into this same entrypoint; it performs authorization, approval, idempotency, and Durable Acceptance before invoking domain behavior.
_Avoid_: API handler, route service, MCP dispatcher, public worker

**Worker Entrypoint**:
The Runtime Kernel's internal executable surface for advancing already-authorized durable work from stable persisted references. Only a configured Durable Orchestrator adapter may invoke it; agent-facing and human-facing transports cannot use it to bypass the Capability Entrypoint.
_Avoid_: internal API, admin tool, background endpoint, capability

**Durable Orchestrator**:
A replaceable infrastructure adapter that durably schedules and resumes Runtime Kernel worker commands using stable domain references. Its history is operational evidence rather than canonical Workflow Run state, and it cannot create domain attempts, reinterpret retry policy, or call providers outside the Runtime Kernel's fenced effect protocol.
_Avoid_: workflow authority, run database, domain runtime, job owner

**Workflow SDK Adapter**:
The initial **Durable Orchestrator** implementation. It uses Vercel World for hosted production, Local World for development only, and Postgres World only for a self-hosted deployment with its required long-lived worker. Its exact SDK version is pinned, all SDK imports remain outside `packages/runtime`, and its run identifiers, deployment history, and event history never enter public Node Banana contracts.
_Avoid_: Workflow Run, Runtime Kernel, canonical scheduler, product event log

**Content Workflow**:
A stable Workspace-scoped identity for a typed directed acyclic graph that generates or transforms content. Its mutable authoring state may include Cockpit layout metadata, but only an immutable validated **Content Workflow Revision** is executable. It does not contain publishing destinations, approval state, or recurring trigger policy.
_Avoid_: AI workflow, canvas JSON, pipeline, automation

**Workflow Draft**:
The mutable authoring state of a **Content Workflow**, edited through an agent or the Cockpit and not executable. Validation and normalization create an immutable Content Workflow Revision without changing previously published Revisions.
_Avoid_: workflow version, saved workflow, executable JSON, current revision

**Content Workflow Revision**:
An immutable, content-addressed executable definition created by strictly parsing and normalizing one Content Workflow draft. Validation fixes the public contract version, operation versions, typed ports, graph acyclicity, required inputs, limits, and Credential Slots; editor layout and other presentation metadata are excluded from its digest. A Workflow Run binds to exactly one Revision and a resolved input snapshot, so later authoring changes cannot alter active or historical execution.
_Avoid_: saved canvas, workflow JSON, current workflow, draft graph

**Legacy Canvas Document**:
A pre-runtime Node Banana canvas snapshot that combines authored graph configuration, editor presentation, asset references, and transient execution outputs. It is preserved as import evidence but is never a Content Workflow Revision and cannot be started by the Runtime Kernel.
_Avoid_: Content Workflow, Workflow Revision, executable workflow, canonical JSON

**Legacy Workflow Import**:
The versioned, one-way conversion of one **Legacy Canvas Document** into a Workflow Draft and honestly originated imported Artifacts. It preserves the original document and source digest, ingests required source media into the managed Artifact Store, strips transient execution state, and never invents historical Workflow Runs.
_Avoid_: migration in place, legacy execution, workflow upgrade, round-trip conversion

**Workflow Import Report**:
The durable result of a **Legacy Workflow Import**, listing each mapped, rewritten, dropped, and unsupported element and whether the resulting Workflow Draft can be validated. It explains compatibility without silently changing or claiming full support for the source document.
_Avoid_: migration log, validation error, import warning

**Workflow Export**:
A portable, versioned representation of a canonical Workflow Draft or Content Workflow Revision with safe presentation metadata and Artifact references. It is an interchange or backup document rather than live Workflow authority, and importing it creates a new Draft with source provenance instead of overwriting state by file path.
_Avoid_: project save file, database dump, Legacy Canvas Document, live workflow JSON

**Workflow Compatibility Class**:
The declared import treatment of a Legacy Canvas Document element: `direct-mapping` to an equivalent runtime contract, `presentation-projection` to a non-executable Cockpit view, `replacement-required` until a canonical server operation exists, or `unsupported`. Replacement-required and unsupported executable elements block Runtime Promotion.
_Avoid_: best-effort support, mostly compatible, fallback node, ignored field

**Workflow Execution Authority**:
The explicit per-Workflow choice of which execution model owns all of its Runs: temporary legacy browser execution for an unconverted canvas project, or the Runtime Kernel for a validated Content Workflow. A Workflow never mixes authorities within one graph or silently falls back between them.
_Avoid_: execution mode flag, hybrid workflow, node fallback, preferred executor

**Runtime Promotion**:
The one-way publication of an imported or newly authored Workflow Draft as a validated Content Workflow Revision under Runtime Kernel authority. The source Legacy Canvas Document remains a separate preserved resource for reference; promotion does not rewrite it or reuse its identity.
_Avoid_: migration in place, executor switch, automatic upgrade, legacy overwrite

**Legacy Maintenance Window**:
The bounded period after the **Golden Workflow Slice** becomes available in which existing Legacy Canvas Documents may still use browser execution. The legacy path receives only security, data-loss, and critical compatibility fixes; all new workflow operations, providers, retry behavior, and agent capabilities belong exclusively to the Runtime Kernel.
_Avoid_: dual development, compatibility mode, long-term legacy support, feature parity period

**Runtime Admission Policy**:
The Workspace-scoped rollout policy that controls whether new runtime-native authoring, promotion, and execution may be accepted for a cohort. Changing it affects only admission of new work; it never moves accepted Runs to legacy execution, rewrites canonical state, or prevents existing work from remaining inspectable.
_Avoid_: migration toggle, executor fallback, rollback conversion, global feature flag

**Legacy Execution Retirement**:
The gated removal of browser execution after new legacy creation is disabled, every retained Legacy Canvas Document has an Import Report, active operation use is resolved or explicitly unsupported, active Workspaces record no legacy execution for sixty consecutive days, and runtime conformance remains green. Retirement preserves read-only inspection, download, and Legacy Workflow Import.
_Avoid_: deleting legacy workflows, migration deadline, forced conversion, legacy purge

**Golden Workflow Slice**:
The first runtime-native end-to-end Content Workflow: accepted text and reference-Artifact inputs produce generated copy and image Artifacts through one immutable Revision and durable Workflow Run, callable equivalently by an External Agent and the Cockpit. Its output may be attached to the existing publishing path without making publishing part of the Content Workflow.
_Avoid_: demo workflow, migration test, full node parity, publishing workflow

**Golden Path Acceptance Run**:
A controlled execution of the versioned dogfood protocol against one exact build, Capability Registry digest, runtime environment, and clean Workspace fixture. An External Agent performs every non-human step through CLI or stdio MCP, while the Cockpit is limited to declared human actions such as deciding a Publishing Approval. It passes only when every mandatory stage and failure probe produces the required machine-verifiable evidence without manual database edits, hidden UI calls, copied resource identifiers, or log-derived state.
_Avoid_: demo, happy-path walkthrough, QA session, acceptance video

**Golden Path Acceptance Protocol**:
The immutable versioned specification executed by a **Golden Path Acceptance Run**. It defines the ordered primitive capability invocations, lane-specific fixtures, human boundary, mandatory assertions and failure probes, evidence schema, and pass verdict for validating the Golden Workflow Slice through scheduled LinkedIn delivery.
_Avoid_: agent recipe, test script, demo checklist, UI flow

**Acceptance Harness**:
The external agent-operated conformance runner that executes and independently verifies the **Golden Path Acceptance Protocol** only through declared CLI, stdio MCP, and human Cockpit boundaries. It emits the content-addressed Acceptance Evidence Bundle and verdict; the Content Operations Runtime supplies canonical resources and evidence but never certifies itself.
_Avoid_: runtime test mode, internal admin endpoint, self-test, Cockpit wizard

**Acceptance Evidence Bundle**:
The immutable content-addressed `golden-path-evidence/v1` result of one **Golden Path Acceptance Run**, emitted by the external **Acceptance Harness**. It records safe build and environment identity, exact capability versions and digests, canonical resource references, event cursor ranges, Artifact hashes, Approval evidence, Publishing Delivery outcome, failure-probe results, redaction audit, and a secret-redacted agent transcript. Missing, unknown, or skipped mandatory assertions produce `fail`; screenshots and a human-readable report may accompany it but are never authoritative acceptance evidence.
_Avoid_: screenshot folder, console log, test report, demo recording

**Deterministic Conformance Lane**:
The mandatory local lane of the golden-path dogfood protocol. It uses real Postgres persistence, Artifact storage, Runtime Kernel workers, transports, and Cockpit boundaries with deterministic Provider Adapters and controlled fault injection so transport parity, durability, idempotency, recovery, approval enforcement, and outcome-unknown behavior can be reproduced without provider cost or public effects.
_Avoid_: unit test, mock-only test, local demo, happy-path test

**Live Dogfood Lane**:
The mandatory staging lane of the golden-path dogfood protocol. It uses real generation-provider credentials and a controlled LinkedIn Channel, reaches an approved future-scheduled Publishing Delivery through External Agent commands and the human Cockpit decision, captures its canonical scheduled evidence, and cancels it before provider publishing begins.
_Avoid_: production publish, provider sandbox test, manual staging test, live demo

**Provider Smoke Test**:
A separately authorized, non-routine test that permits an exact Publishing Delivery to perform a real public provider effect against a controlled Channel. It requires its own explicit Approval and is not part of routine Golden Path acceptance.
_Avoid_: dogfood run, staging acceptance, automatic test post

**Acceptance Readiness Check**:
The machine-readable precondition check that begins a **Golden Path Acceptance Run** only after the exact build and Capability Registry are reachable, the Workspace fixture is clean, an Agent Principal is paired, required Credential Profiles are usable, the controlled LinkedIn Channel is ready, and a Human Principal holds applicable Approval Authority. It exposes only safe readiness and discoverable references, never secret material.
_Avoid_: setup checklist, operator handoff, environment notes, copied IDs

**Golden Path Fixture**:
The immutable non-sensitive `golden-path-fixture/v1` inputs and assertions used by the Golden Path Acceptance Protocol. It contains the launch brief, reference-image content hash, Content Workflow candidate, required output types, and structural policy assertions; deterministic lanes additionally declare exact expected output hashes.
_Avoid_: seed data, demo project, test account, example workflow

**Acceptance Scope**:
The unique correlation boundary allocated to one Golden Path Acceptance Run within its Workspace. Every authored Revision, Run, Artifact, Plan, Approval, Delivery, event range, and idempotency key belongs to that scope so retained history from another run cannot satisfy an assertion.
_Avoid_: test prefix, campaign name, cleanup namespace, session ID

**Acceptance Failure Matrix**:
The mandatory set of deterministic fault and abuse probes within the **Golden Path Acceptance Protocol**. Each probe begins from declared canonical state, injects one bounded failure or prohibited action, and asserts the resulting resource state, events, effects, errors, and recovery evidence; any missing or failed probe makes the acceptance verdict fail.
_Avoid_: edge-case checklist, chaos test, optional QA, manual failure demo

**Release Acceptance Gate**:
The promotion rule requiring current passing Deterministic Conformance and Live Dogfood Acceptance Evidence Bundles for the exact release-candidate build and Capability Registry digest. A required failed, missing, stale, or invalidated bundle blocks promotion and is never hidden by an automatic rerun.
_Avoid_: CI check, release checklist, flaky-test retry, deployment approval

**Acceptance Deadline Budget**:
The exact versioned set of deadlines and polling rules declared by a Golden Path Acceptance Protocol for readiness, synchronous results, Durable Acceptance, domain completion, human Approval, scheduling, cancellation, recovery, and reconciliation. Every wait is bounded and a missed deadline fails; changing a calibrated deadline changes the protocol version rather than silently weakening acceptance.
_Avoid_: test timeout, arbitrary sleep, CI timeout, best-effort wait

**Structured Progress Observation**:
The transport-neutral acceptance contract for watching asynchronous domain work through authoritative resource snapshots and retained cursor-paged events. Each Durable Acceptance supplies the resource reference, exact inspect and event capabilities, and initial cursor; immutable per-resource event sequences can be resumed after agent-process loss without logs, database access, or mandatory live streaming.
_Avoid_: log tailing, WebSocket contract, progress spinner, polling internal tables

**Cross-Transport Continuation**:
The operation of one canonical resource chain by the same Agent Principal across CLI and stdio MCP without export, import, duplicated client state, resource recreation, or human-supplied identifiers. Authorization, Capability Idempotency, snapshots, event cursors, errors, and effects remain properties of the shared Capability Entrypoint rather than either transport session.
_Avoid_: transport migration, CLI fallback, MCP session resume, state synchronization

**Historical Run Replay**:
The read-only reconstruction of an existing immutable **Workflow Run** from its authoritative snapshot, retained Run Events, Workflow Step Attempts, and Artifact provenance. It performs no workflow step, creates no Artifact or provider effect, and never changes the Run.
_Avoid_: rerun, retry, resume execution, regenerate

**Derived Run Retry**:
The explicit creation of a new **Workflow Run** from an eligible failed Run through `workflow_runs.retry`. The new Run records its source Run, has its own identity, events, attempts, effects, and idempotency receipt, while the original Run remains immutable.
_Avoid_: replay run, reopen run, continue failed run, reset run

**Workflow Run**:
The durable execution record of one immutable **Content Workflow Revision**. Its snapshot is the canonical current state and records resolved inputs, non-secret credential references, step attempts, produced **Artifacts**, terminal outcome, and any derivation from an earlier Run.
_Avoid_: job, execution log, workflow state in the UI

**Workflow Step Attempt**:
An immutable record of one semantic try of a Content Workflow step inside a **Workflow Run**. The Runtime Kernel creates it before provider execution and records bounded timing, retry policy, stable **Effect Key**, sanitized outcome, and whether the provider result is known. Infrastructure re-entry resumes the same Attempt; only a known-safe retry decision creates the next Attempt. An unknown provider outcome blocks the Run for explicit reconciliation and is never retried blindly.
_Avoid_: Workflow SDK retry, worker invocation, retry count, provider log

**Run Event**:
A minimal immutable event appended atomically with an accepted **Workflow Run** transition. Events are ordered by a per-Run sequence, retained with the Run, and used for observation, cursors, and audit—not as the sole source from which Run state must be rebuilt. They contain stable references and structured errors, never secrets, generated content, or raw provider responses.
_Avoid_: log line, event-sourcing record, provider log

**Credential Slot**:
A logical, non-secret credential name used by a **Content Workflow** to satisfy a versioned operation's declared credential requirement. The **Content Operations Runtime** resolves it to an operator-configured credential when a run starts and records only a non-secret reference and version for auditability. Workflows, runs, artifacts, and tool output never contain the underlying secret.
_Avoid_: API key, secret, provider header, credential ID

**Credential Profile**:
A stable, Workspace-scoped, human-managed identity for provider access whose secret versions live in the runtime **Credential Vault**. Model-provider profiles satisfy Workflow Credential Slots; social connection profiles belong to Channels. Authorized Agent Principals may exercise a profile through runtime operations but can never read, export, or modify its secret material.
_Avoid_: API key, environment variable, provider setting, secret record

**BYOK Provider Execution**:
A provider effect performed with a credential supplied and owned by the Workspace operator through a Credential Profile. The external provider bills the operator's account directly; Node Banana meters and constrains execution but does not buy, resell, or mark up inference.
_Avoid_: managed inference, platform credits, included AI, Node Banana billing

**External Provider Spend**:
The provider usage cost attributable to BYOK Provider Execution under provider evidence or a Pricing Snapshot. It is an operational estimate or reported external charge for guardrails and analysis, never a Node Banana invoice, wallet debit, or promise of the provider's final bill.
_Avoid_: platform charge, inference revenue, credits, customer billing

**Credential Spend Grant**:
The explicit human decision allowing one Agent Principal to cause BYOK Provider Execution through one Credential Profile in bounded or deliberately unbounded mode. A bounded grant names applicable per-Run and calendar-period Budget Policies; absence of a grant permits inspection but no provider effect.
_Avoid_: provider permission, billing access, API-key scope, spend setting

**Credential Vault**:
The runtime boundary that stores provider secret material as encrypted, versioned envelopes and returns it only to authorized provider operations. Its local master key is protected by the operating-system credential manager when possible; a hosted implementation may use KMS without changing Credential Profile semantics. Plaintext never appears in browser storage, authored resources, request metadata, logs, events, or tool output.
_Avoid_: secrets table, `.env`, localStorage, key store

**Credential Version**:
An immutable encrypted secret version inside a **Credential Profile**. Workflow Runs snapshot the exact active model-provider version at start; normal rotation preserves it for a bounded grace period, while emergency revocation blocks future effects immediately. Channel operations instead resolve the current active connection version at each provider boundary because OAuth refresh is live operational state.
_Avoid_: rotated key, current secret, token refresh row

**Credential Handoff**:
A human-action flow through which a model key, OAuth consent, account selection, or app password enters the **Credential Vault** without passing through an External Agent. An Agent may initiate the request and observe safe status, but only a Human Principal with credential-management authority or the provider callback supplies secret material.
_Avoid_: agent-provided key, credential tool argument, OAuth tool

**Artifact**:
An immutable, typed content resource produced by a **Content Workflow** step or imported from outside Node Banana. Postgres is authoritative for its Workspace ownership, media type, content hash, immutable storage reference, explicit origin, and lineage; the bytes live behind the **Artifact Store** port. Imported Artifacts record import provenance and never invent a Workflow Run; generated Artifacts record the Run, step, attempt, and output port that produced them.
_Avoid_: output blob, generated file, media item, fake run output

**Artifact Store**:
The replaceable Runtime Kernel port that stores and retrieves immutable Artifact bytes by stable storage reference and verified content hash. A local adapter may use the filesystem and a hosted adapter may use object storage without changing Artifact or capability contracts. It never owns Artifact identity, lineage, authorization, or lifecycle.
_Avoid_: media database, artifact registry, upload API, blob field

**Legacy Publishing Post**:
An existing mutable Social Hub Post created before the canonical Publishing Plan model. It remains authoritative only for its own legacy publishing lifecycle and is never reinterpreted as a Publishing Plan, Revision, Approval, Target, or Delivery.
_Avoid_: Publishing Plan, migrated Plan, implicit Approval, canonical post

**Legacy Publishing Import**:
The optional one-way conversion of an eligible draft **Legacy Publishing Post** into a new Publishing Plan with explicit provenance. Scheduled, publishing, terminal, or otherwise externally committed legacy Posts remain historical legacy records and are never imported.
_Avoid_: state mirror, publishing migration in place, Plan wrapper, bidirectional sync

**Publishing Plan**:
A durable resource that assigns generated artifacts or authored content to **Channels**, including **Publishing Settings** and concrete one-time timing. It can be prepared independently of execution and must pass runtime policy before scheduling or publishing. Recurring trigger rules belong to **Automation**.
_Avoid_: schedule, campaign JSON, post workflow

**Publishing Plan Revision**:
An immutable, content-addressed snapshot of a **Publishing Plan**. Every accepted edit creates a new revision and digest; approvals and released publishing work remain bound to the exact revision they evaluated.
_Avoid_: draft version, mutable schedule, latest plan

**Publishing Target**:
The per-**Channel** unit inside a **Publishing Plan Revision**. It selects exactly one Channel and owns that destination's content variant, Artifact references, **Publishing Settings**, timing, **Publishing Readiness**, Approval coverage, and eventual **Publishing Delivery** outcome. Targets may reuse the same immutable Artifacts without sharing destination-specific state.
_Avoid_: channel list, multi-channel post, destination config

**Publishing Approval**:
A durable, bounded-lifetime, single-use decision that authorizes a specific scheduling or publishing action against one exact **Publishing Plan Revision**. Its decision basis is either the real human approver or an exact policy version and evaluation; policy authorization never impersonates a human. It may be revoked, expire, or be superseded by a newer Plan Revision before release. Releasing the approved work consumes the decision while atomically creating the corresponding **Publishing Deliveries**; a consumed Approval remains immutable audit history and never expires or becomes superseded retroactively. Repeating the same release returns the existing Deliveries, and retries never consume approval again. Approval never transfers to a later revision, even when the edit appears minor.
_Avoid_: approval flag, confirmation prompt, approved post

**Publishing Delivery**:
A durable per-target record of scheduled and provider-facing publishing work created from one consumed **Publishing Approval**. It retains the exact approved **Publishing Plan Revision** and owns scheduling, cancellation, blocking, dispatch, retries, and provider outcome for one **Channel**. Readiness drift before provider publishing makes it blocked with a structured reason; restoring external readiness may resume the same Delivery without new Approval. It may be cancelled before provider publishing begins; afterward cancellation is not guaranteed.
_Avoid_: post status, publish job, approval result

**Publishing Attempt**:
An immutable record of one provider-facing try inside a **Publishing Delivery**. It records bounded timing, sanitized failure, and whether the outcome is known; later retries append Attempts rather than overwriting them.
_Avoid_: retry count, provider log, dispatch try

**Automation**:
An optional, stable-identity trigger-and-policy resource that starts a **Content Workflow** or advances a **Publishing Plan** because of a time, event, or explicit command. Its accepted edits create immutable **Automation Revisions**. It coordinates durable resources but does not duplicate their content-generation or publishing definitions.
_Avoid_: AI workflow, cron job, agent, pipeline, automation rule

**Automation Revision**:
An immutable snapshot of an **Automation** definition. It owns the trigger and occurrence policy plus references to the exact **Content Workflow** or publishing action it may invoke; already-created **Automation Occurrences** retain their original revision when the Automation changes.
_Avoid_: mutable rule, current automation config, task template

**Automation Occurrence**:
The durable execution record created when one time, event, or explicit-command trigger is accepted for an exact **Automation Revision**. It retains the trigger identity and input, **Source Occurrence Key**, lifecycle, and references to the **Workflow Run** or concrete **Publishing Plan** work it materializes.
_Avoid_: automation task, run counter, cron tick, job

**Source Occurrence Key**:
A stable, kind-specific idempotency identity for one trigger, unique within the stable **Automation** across all of its revisions. A time trigger derives it from its canonical scheduled occurrence, an event trigger from the connector and external event identity or cursor position, and an explicit command receives it as a caller-supplied idempotency key. Reusing a key with identical input returns the existing **Automation Occurrence**; reusing it with different input is a conflict.
_Avoid_: task key, run index, request ID

**Trigger Receipt**:
A durable record that an external trigger source event was observed and either accepted, ignored, or rejected. For an accepted event, its Receipt, **Automation Occurrence**, and opaque source-cursor advance are committed atomically. A downstream execution failure never rewinds the cursor; a failed ingestion transaction persists none of them.
_Avoid_: webhook log, automation event, processed flag

**Local-time Schedule**:
A recurring time trigger defined with an IANA timezone and explicit daylight-saving policy. A nonexistent wall-clock time shifts forward by the transition gap by default or may be skipped; a repeated wall-clock time fires once at the earlier offset by default or may select the later offset. Firing at both offsets is not supported in v1. Every materialized occurrence freezes its local time, timezone, resolved UTC instant, and UTC offset.
_Avoid_: UTC cron, server-time schedule, repeat interval

**Catch-up Policy**:
The bounded rule a **Local-time Schedule** applies to occurrences missed during downtime or pause: `skip` (the default), `latest`, or `all`. `all` materializes missed occurrences oldest-first only within explicit maximum-count and maximum-age bounds capped by Workspace policy. A catch-up occurrence retains its original scheduled instant; omitted or truncated slots remain visible in Automation audit state.
_Avoid_: backfill script, run immediately, retry missed jobs

**Overlap Policy**:
The rule governing accepted **Automation Occurrences** while another Occurrence is active: `queue` (the FIFO, one-at-a-time default), `skip`, or bounded `parallel`. `skip` retains a terminal `skipped_overlap` Occurrence; `parallel` requires a maximum concurrency capped by Workspace policy and queues overflow. Replacing or cancelling active work is not supported in v1.
_Avoid_: worker count, task lock, run simultaneously

**Automation Control State**:
The stable **Automation** lifecycle control: `active`, `paused`, or terminal `retired`. Pausing preserves queued and active work but prevents new work from starting; resume releases queued work and applies schedule catch-up. Retirement rejects future triggers while preserving all revisions, occurrences, and audit history.
_Avoid_: enabled flag, deleted rule, task status

**Automation Action**:
The narrow, typed orchestration contract of an **Automation Revision**. It may start one exact immutable **Content Workflow** version, materialize one concrete one-time **Publishing Plan** from an exact source Plan Revision, or perform both in that order. It owns only trigger/constants/Artifact input bindings, named Workflow-output-to-Plan bindings, occurrence-relative target timing, and provenance—not arbitrary steps, generation logic, Channel settings, or approval decisions.
_Avoid_: action graph, workflow steps, embedded post template, create-social-post config

**Automation Approval Mode**:
The publishing-action instruction that selects `request_human` (the default) or `evaluate_policy`. Human mode runs Publish Validation and creates a pending Approval. Policy mode invokes an exact policy version: `allow` creates a policy-based Approval and uses standard release, `review` creates a pending human Approval, and `deny` creates neither Approval nor Delivery while retaining the materialized Plan and decision evidence.
_Avoid_: auto-publish flag, trusted automation, skip approval

**Automation Stage Attempt**:
An immutable record of one try of an Automation-owned orchestration stage such as Plan materialization, Approval request, or release. Each stage uses a stable effect key derived from the Occurrence and stage, so bounded retry cannot recreate a successful durable effect. Workflow step attempts and Publishing Attempts remain owned by their respective resources.
_Avoid_: retry count, workflow attempt, publishing attempt

**Automation Trigger**:
The single declared automatic-source contract in an **Automation Revision**: explicit-command only, a schedule, or a versioned external event connector and filter. Schedule recurrence is structured local-calendar data rather than a raw cron string. Event types and filters are validated against the connector's exact versioned schema. Any active Automation may also be invoked manually with a caller idempotency key.
_Avoid_: trigger source string, cron string, webhook payload, trigger list

**Automation Revision Activation**:
The atomic cutover that makes one validated **Automation Revision** live for future trigger acceptance. Activation revalidates all referenced immutable resources, connector and policy versions, permissions, and Workspace limits; records its activation instant; and initializes or continues the trigger watermark/cursor. Creating a Revision alone never changes live behavior.
_Avoid_: save rule, enable revision, edit active automation

**Automation Event**:
A minimal immutable event appended atomically with an accepted Automation, Revision, Occurrence, or Receipt transition. Events are ordered by a per-Automation sequence and support resumable observation, while canonical resource snapshots remain authoritative. They contain stable references, reason codes, bounded retry data, and sanitized errors—never content, secrets, or raw connector payloads.
_Avoid_: log line, event-sourcing record, webhook payload

**Automation Contract v1**:
The strict public document family `automation/v1`, `automation-revision-input/v1`, `automation-revision/v1`, `automation-occurrence/v1`, `trigger-receipt/v1`, `automation-stage-attempt/v1`, and `automation-event/v1`. Authored revision input omits a digest; the runtime validates and canonicalizes it, computes SHA-256, and persists the immutable revision identity. Unknown fields, secrets, invalid cross-Workspace references, and mismatched referenced versions or digests are rejected.
_Avoid_: automation JSON, rule payload, task schema

**GEO (AI Discovery)**:
Optimizing to be cited or recommended by LLMs (ChatGPT, Claude, Perplexity, Gemini) as a discovery channel, as opposed to human search/social. A **Content Workflow** can produce GEO-oriented answer pages; the **Cockpit** measures results via **Citation Tracking**.
_Avoid_: SEO, AEO, LLM SEO

**Citation Tracking**:
Measuring how often the product's domain is mentioned or cited in LLM answers to category questions, over time and relative to competitors. Citation frequency / share-of-voice is the north-star reporting metric of the Agency Lifecycle.
_Avoid_: rank tracking, brand monitoring, mentions

## Relationships

- A **Workspace** has zero or more **Channels**.
- A **Channel** belongs to exactly one **Platform**.
- A **Provider Adapter** supports exactly one **Platform**.
- A **Post** has **Publishing Settings** for each selected **Channel** when that platform needs extra publishing choices.
- A **Platform** defines the shape of **Publishing Settings**, but the saved values belong to a specific selected **Channel** for a **Post**.
- **Publishing Settings** are stored as **Normalized Publishing Settings**.
- **Publishing Settings** must affect the resulting platform publish request when the corresponding **Platform** supports the option.
- **Publish Validation** applies to the combination of **Post**, **Channel**, media, and **Publishing Settings**.
- Stored **Publish Validation** is a point-in-time readiness snapshot, not permanent authorization.
- The runtime repeats **Publish Validation** before consuming a **Publishing Approval** and again immediately before a **Publishing Delivery** begins provider publishing.
- When release-time validation fails, no Delivery is created and the Approval remains unconsumed until it is retried, revoked, or expires.
- When pre-publish validation fails after release, the **Publishing Delivery** becomes blocked and records the reason without calling the Platform.
- A blocked **Publishing Delivery** may resume without new Approval when remediation only restores external readiness; changing approved intent requires a new Plan Revision and Approval.
- Known-safe transient publishing failures retry with bounded backoff inside the same **Publishing Delivery**, appending a **Publishing Attempt** each time.
- An ambiguous provider outcome blocks the Delivery for reconciliation and is never retried blindly.
- A non-retryable or exhausted Delivery becomes terminally failed; manual retry requires fresh Approval and creates a new Delivery for the unchanged Plan Revision.
- A draft **Post** may have incomplete **Publishing Settings**; a scheduled or publishing **Post** must pass **Publish Validation**.
- **Safe Defaults** should be applied when a **Channel** is selected, except where the creator must make an explicit destination choice such as a Reddit subreddit or Pinterest board.
- **Publishing Readiness** is shown separately for each selected **Channel**.
- A **Post** sent through a Reddit **Channel** targets one subreddit destination at a time.
- During a compose session, deselecting a **Channel** preserves its unsaved **Publishing Settings** in case the creator reselects it; saving a **Post** only persists settings for selected **Channels**.
- When editing an older draft **Post** that has missing **Publishing Settings**, the composer hydrates **Safe Defaults** for display without changing the saved **Post** until the creator saves, schedules, or publishes.
- A federated **Platform** (e.g., Mastodon) may have many instances, each with its own **Instance Registration**.
- Multiple **Channels** on the same federated instance share one **Instance Registration**.
- A Bluesky **Channel** uses **App Password Auth** instead of an OAuth redirect flow.
- A Mastodon **Channel** has **Post Visibility** and optional **Content Warning** as **Publishing Settings**.
- **Facets** are computed at publish time by the Bluesky **Provider Adapter**, not stored on the **Post**.
- The **Content Operations Runtime** owns durable workflow and publishing execution.
- The **Agent Interface** and **Cockpit** operate the same **Content Operations Runtime** capabilities and policy checks.
- CLI, MCP, REST, and Cockpit adapters invoke the same **Application Capability** definitions rather than implementing domain behavior.
- Every Application Capability has one stable **Capability Identity** consisting of a dotted lower-snake-case resource/action name and an independent positive contract version.
- Breaking capability-contract changes increment the Capability Identity version; transport-specific spelling never defines or versions the capability.
- Every successful result and structured error identifies the canonical Capability Identity that produced it.
- Every Application Capability owns one structured **Capability Effect** covering mutation reach, visibility, timing, reversibility, and potential provider spend.
- Capability authorization and approval policy evaluate the canonical Capability Effect; transport-specific warnings are derived, non-authoritative projections.
- Every Application Capability declares exactly one **Capability Idempotency** policy: `retry-safe`, `intrinsic`, or `key-required`.
- A required idempotency key is scoped by Workspace, Principal, Capability Identity, and key; identical canonical input replays the original accepted result, while different input is an idempotency conflict.
- Capability acceptance records the idempotency receipt atomically with its mutation or enqueue; pre-acceptance validation and authorization failures never consume the key.
- Provider execution uses a separate stable **Effect Key** across attempts and reconciliation, so transport retries and provider retries are never conflated.
- Every provider-facing Workflow Step Attempt contributes immutable **Usage Records** to the Workspace's **Usage Ledger**, including failed or outcome-unknown effects when they may have consumed provider resources.
- A Usage Record preserves normalized quantities and bounded provider-native dimensions with certainty `reported`, `measured`, `estimated`, or `unknown`; raw prompts, generated content, credentials, and provider response bodies are never metering data.
- Every Usage Record identifies its Workspace, Agent Principal, Workflow Run, step, Attempt, Effect Key, provider, operation, exact model or version, service tier, Credential Profile reference, accepted/started/finished times, outcome, possible billability, provider-request count, and produced Artifact references.
- The **Usage Dimension Registry** normalizes applicable text token and tool usage; image count and megapixels; video or audio duration and resolution; hosted compute time; Artifact storage and transfer bytes; publishing target attempts; and generic request or externally billable-operation counts.
- Queue, provider, and total duration remain separately observable and are never conflated with a provider's billable execution quantity.
- Provider-specific quantities use versioned namespaced Usage Dimensions such as `replicate.predict_seconds`; arbitrary JSON metric blobs are rejected.
- An unsupported Usage Dimension is absent, while an expected but unreported quantity is explicitly unknown.
- **Cost Valuation** remains separate from usage facts and identifies its provider-reported, runtime-calculated, or unknown basis.
- Monetary authority descends from an exact provider-reported billed amount, to runtime valuation of provider-reported usage, to runtime valuation of measured or conservative estimated usage, and finally to explicit unknown.
- Every runtime-calculated Cost Valuation binds to the exact **Pricing Snapshot** used; later pricing changes never rewrite historical usage or valuation.
- Pricing Snapshots use exact decimal rates, an ISO currency, source reference, effective time, exact model or operation version, service tier, and applicable unit rules.
- A Workflow Run pins its Pricing Snapshots when its Run Cost Ceiling is reserved; pricing updates affect only new reservations.
- Node Banana's built-in provider-pricing catalog is versioned, source-referenced, and updated only by a product release or signed catalog update, never by scraping a pricing page during execution.
- Monetary precedence is exact provider-reported cost, then **Workspace Pricing Override**, then built-in catalog valuation, then explicit unknown.
- A Workspace Pricing Override is an immutable audited human revision for an exact provider, operation, model or version, service tier, or credit conversion and affects new Run previews and reservations only.
- Human-only `pricing_overrides.get/list/create/revoke@1` capabilities manage Workspace Pricing Overrides through the shared Capability Entrypoint.
- A legacy UI `pricing.amount` becomes runtime authority only when it resolves to a trusted catalog revision; an arbitrary numeric field remains a planning hint.
- Provider credits become monetary only under an explicit credit-to-currency rate in the Pricing Snapshot.
- Cross-currency Budget evaluation requires an exact **FX Snapshot**; without one, the operation remains unknown-priced for that Budget Policy.
- A later exact provider-reported charge appends a superseding Cost Valuation and explicit variance without deleting the earlier estimate.
- Actual provider spend above the reserved ceiling remains honestly recorded, releases no fictional capacity, and blocks subsequent effects even though the runtime cannot undo the external charge.
- Runtime v1 uses **BYOK Provider Execution** only: the Workspace operator supplies each model-provider credential and the provider bills that external account directly.
- **External Provider Spend** is recorded for transparency, planning, and enforcement guardrails; it never creates a Node Banana invoice, credit balance, markup, or billing obligation.
- A Budget Reservation reserves internal authorization to cause bounded External Provider Spend and never reserves funds or credits with the provider.
- The provider's billing system remains final invoice authority; when exact billed cost is unavailable, Node Banana retains a clearly labeled valuation rather than claiming an actual charge.
- Hosted storage, bandwidth, and concurrency capacity remain Quota dimensions and are not disguised as BYOK inference spend.
- Managed inference, bundled credits, resale, or markup are outside runtime v1 and require a separate future contract.
- Granting an Agent Principal visibility of a Credential Profile never implies permission to cause External Provider Spend.
- Before an Agent Principal may use a Credential Profile for a provider effect, a human administrator creates a **Credential Spend Grant** in bounded or explicitly unbounded mode.
- A bounded Credential Spend Grant applies both a maximum Run Cost Ceiling and a calendar-period Budget Policy; an unbounded grant still records complete usage and remains subject to Quota Policies and Emergency Spend Suspension.
- Without a Credential Spend Grant, the Agent Principal may inspect authorized non-secret profile metadata but every provider effect is denied before acceptance.
- `workflow_runs.preview@1` returns a **Run Admission Preview** for the same proposed input accepted by Run start; it creates no reservation and never guarantees later admission.
- `workflow_runs.start@1` re-evaluates price, policy, grants, and capacity transactionally and remains the only authoritative Run admission.
- Agent-safe metering capabilities include `usage_records.get/list@1`, `cost_valuations.get/list@1`, `usage_summaries.get@1`, `pricing_snapshots.get@1`, `budget_policies.get_effective@1`, `quota_policies.get_effective@1`, `budget_reservations.list@1`, and `quota_reservations.list@1`.
- Human-only spend administration includes `credential_spend_grants.get/list/create/revoke@1`, `budget_policies.get/list@1`, `budget_policy_revisions.create@1`, and `spend_controls.get/suspend/resume@1`.
- Human-only quota and retention administration includes `quota_policies.get/list@1`, `quota_policy_revisions.create@1`, `retention_policies.get@1`, and `retention_policy_revisions.create@1`.
- Human operations and support capabilities include `operational_metrics.query@1`, `diagnostic_traces.get@1`, and `support_bundles.create/get/revoke@1`.
- Every metering, policy, diagnostics, and support capability uses the shared Capability Entrypoint and Transport Parity Contract; no Cockpit-only administration or internal diagnostic route is authoritative.
- Reconciliation and correction append superseding Usage Records or Cost Valuations instead of mutating prior evidence.
- Workflow Run, Workspace, Agent Principal, provider, operation, and Artifact usage or cost totals are projections over the Usage Ledger, not canonical counters.
- Workflow Run, Workflow Step Attempt, provider, and operation projections count each Usage Record exactly once.
- An Artifact receives **Direct Usage Attribution** only for the effect that directly created or imported it.
- A single-output effect may allocate its Usage Record entirely to that Artifact; a multi-output effect uses provider-reported per-output usage or an allocation rule declared by the operation contract.
- When no defensible multi-output allocation exists, every output references shared unallocated usage and the runtime never assumes an equal split.
- Derived Artifacts record only their own transformation, storage, and transfer usage; **Lineage Cost Context** exposes upstream generation evidence without charging it again.
- Imported Artifacts record import, storage, and transfer usage and never receive fabricated generation cost.
- Summing Artifact views is non-authoritative because shared and lineage context may overlap; only Usage Ledger projections produce spend totals.
- Existing browser cost estimates and localStorage totals are planning hints only and never become runtime usage, budget, or billing authority.
- Unknown usage or pricing remains explicitly unknown and is never represented as zero usage or zero cost.
- A **Budget Policy** may constrain a Workspace or one Agent Principal; effective execution must satisfy both, while each Usage Record is charged once and attributed to every applicable scope.
- `workflow_runs.start` computes a conservative **Run Cost Ceiling** covering every reachable provider effect and configured automatic retry under exact Pricing Snapshots.
- Durable Acceptance atomically persists Budget Reservations against the Workspace and Agent Principal policies for the Run Cost Ceiling; insufficient capacity rejects Run creation before acceptance.
- Budget Policy v1 supports calendar day, week, month, or lifetime **Budget Periods** in an explicit IANA timezone and has no carryover.
- A Run Cost Ceiling and its Budget Reservations remain assigned to the Budget Period active at Durable Acceptance even when execution or settlement crosses the period boundary.
- Actual Usage Records retain their provider-effect timestamps independently from the Budget Period used for enforcement.
- Automatic retries draw from the original Run reservation, while a Derived Run Retry creates a new reservation in the Budget Period active at its own acceptance.
- Cancelling a Workflow Run releases every unspent Budget Reservation, while active and outcome-unknown reservations never expire silently.
- Unknown-priced operations are rejected unless Workspace policy supplies an explicit fixed maximum-spend allowance from which the Run Cost Ceiling can be reserved.
- Before each provider boundary, the Workflow Step Attempt receives a child Budget Reservation from the Run envelope.
- Before a provider call, one canonical transition persists the Workflow Step Attempt, stable Effect Key, child Budget and Quota Reservations, and authorized execution intent.
- After an adapter returns, one **Usage Settlement** atomically persists the Attempt outcome, safe provider reference and usage evidence, Usage Records, Cost Valuations, reservation settlement, resulting Artifact metadata and lineage, Run snapshot transition, and ordered Run Events.
- A crash after provider contact but before Usage Settlement produces `outcome_unknown`; reservations remain held and reconciliation appends the missing usage or explicit unknown evidence before settlement.
- Infrastructure redelivery of the same Effect Key cannot create another Usage Record or Cost Valuation.
- A known-safe semantic retry creates a new Workflow Step Attempt with separately attributable usage, while validation failure before the provider boundary creates no External Provider Spend record.
- Known actual usage settles its reservation and releases unused capacity; a failed call is valued when evidence says it consumed billable resources.
- An outcome-unknown effect retains its Budget Reservation until reconciliation.
- If settled usage exhausts the Run Cost Ceiling before another provider effect, the accepted Workflow Run becomes `blocked_budget` and creates no further provider effect.
- Reducing a Budget Policy never revokes already reserved work; only an explicit **Emergency Spend Suspension** blocks accepted Runs at their next provider boundary.
- `blocked_budget` and non-renewable `blocked_quota` are non-terminal Workflow Run states that expose their exact shortfall, blocking policy revision, and `workflow_runs.resume@1` recovery capability.
- A human may revise the applicable Budget Policy, Quota Policy, Credential Spend Grant, or Emergency Spend Suspension; policy change alone never resumes provider execution.
- `workflow_runs.resume@1` re-evaluates current authorization, Pricing Snapshots, policies, and capacity and atomically adds any required reservations before scheduling the same Run.
- Resume never changes the immutable Workflow Revision, resolved inputs, completed Attempts, existing Usage Records, or original Run identity.
- A still-ineligible resume returns a structured non-mutating Capability Error, while renewable Quota Waits resume automatically without this capability.
- `workflow_runs.resume@1`, `workflow_runs.submit_input@1`, and `workflow_runs.reconcile@1` remain distinct recovery contracts for policy/capacity, declared external input, and provider outcome respectively.
- **Quota Policies** govern non-monetary admission, concurrency, rate, storage, publishing, and integration capacity independently from Budget Policies.
- Predictable admission-quota exhaustion rejects Run start, Artifact import, Publishing Target creation, Channel connection, or webhook creation before Durable Acceptance.
- Renewable concurrency exhaustion may durably accept a Workflow Run into **Quota Wait** with state `queued_quota`; renewable rate exhaustion moves an accepted Run to `waiting_quota` with an exact `eligibleAt`.
- The Runtime Kernel resumes a Quota Wait when its eligibility condition holds; an External Agent never retries the accepted command to compete for capacity.
- Artifact imports acquire byte Quota Reservations before acceptance, while Workflow Run acceptance reserves each reachable operation's declared maximum output bytes.
- Agent Principal subquotas may narrow Run, provider-request, publishing, and attributed storage capacity but never expand Workspace quota.
- Every quota evaluation identifies the exact Usage Dimension, current and reserved quantities, limit, reset or eligibility time when applicable, and safe recovery capability.
- `QUOTA_EXCEEDED` is a canonical cross-transport Capability Error for rejected admission; a Quota Wait is successful Durable Acceptance followed by a non-terminal resource state.
- Existing social plan limits and Workspace storage quota become projections into the unified Quota Policy model rather than parallel execution authorities.
- **Durable Contract Evidence** includes canonical Run and Attempt state, retained domain events, Artifact metadata and lineage, safe provider and model identity, Effect Keys, safe provider request references, structured outcomes, Usage Records, Cost Valuations, Budget and Quota decisions, Approval evidence, and Security Events.
- Durable Contract Evidence follows its owning domain resource's retention and remains authoritative independently of metrics, traces, or orchestrator history.
- **Operational Metrics** aggregate latency, queue depth, throughput, structured errors, retry rates, quota pressure, storage growth, and projected spend without high-cardinality content or resource payloads.
- **Diagnostic Traces** are operator-only and may contain correlation, component/version, timing, allowlisted provider status metadata, retry decisions, and stack traces.
- Automatic telemetry never contains Credential material, authorization headers, prompts, generated text, media bytes, signed URLs, arbitrary headers, or raw provider request/response bodies.
- Capability Errors and safe domain events expose only an **Operator Trace Reference**, not Diagnostic Trace content.
- Authorized users inspect prompts and generated content through canonical Run inputs and Artifacts rather than diagnostic storage.
- Content enters support diagnostics only through an explicitly consented, user-selected **Support Bundle** with separate audit evidence and short expiry.
- Every Agent Principal may inspect an **Agent Usage View** for its own Runs and effects, including price certainty, Run Cost Ceiling basis, reservations, settled valuation, and effective remaining Budget and Quota capacity.
- Workflow Run Events reference Run Cost Ceiling reservation, Usage Settlement, correction, threshold, blocking, Quota Wait, resume, and reservation-release transitions through safe summaries and canonical record identities.
- **Metering Events** provide the Workspace-scoped retained cursor stream exposed by `usage_events.list@1` for authorized usage, Budget, Quota, pricing, and retention observation.
- A warning threshold emits once per policy revision, Budget or Quota Period, threshold, and scope.
- Canonical Metering Event types include `run_cost_ceiling_reserved`, `usage_settled`, `usage_corrected`, `budget_threshold_crossed`, `quota_threshold_crossed`, `run_blocked_budget`, `run_waiting_quota`, `run_usage_resumed`, `reservation_released`, and `emergency_spend_suspended`.
- Metering Events remain observation and audit evidence; current Run, policy, reservation, Usage Record, and Cost Valuation resources remain authoritative.
- Capability discovery exposes whether an operation is known-priced and currently admissible without revealing another Principal's usage or confidential Workspace totals.
- Workspace-wide usage requires an explicit `usage:read_workspace` grant; Budget and Quota policy administration remains human-only.
- Agents without administrative read scope see only the effective Budget and Quota constraints relevant to their own authority, not unrelated policy revisions.
- Diagnostic Trace access is human-operator-only by default; an Agent Principal receives only the safe Capability Error, recovery capability, and Operator Trace Reference.
- A **Telemetry Operator Grant** is time-bounded, Workspace-specific, and required to inspect Diagnostic Traces or Support Bundles; every access creates a Security Event.
- Every usage, policy, metric, trace, and Support Bundle query re-evaluates current authorization and returns a non-leaking cross-Workspace denial.
- The default **Workspace Retention Policy** keeps canonical Runs, Events, Artifact metadata, provenance, and publishing resources until explicit user deletion or policy expiry.
- Usage Records, Cost Valuations, Budget and Quota decisions, reservations, and Security Events remain for thirteen months after terminal state or content deletion.
- Effect and reconciliation evidence never expires while its outcome is unresolved and remains for thirteen months after resolution.
- Successful Diagnostic Traces expire after seven days; failed, blocked, or cancelled traces after thirty days; outcome-unknown traces remain until reconciliation and then expire after thirty days.
- Durable Orchestrator operational history expires thirty days after terminal state and never substitutes for canonical Run history.
- High-resolution Operational Metrics expire after ninety days, while content-free daily aggregates remain for thirteen months.
- Support Bundles expire within seven days and may be revoked immediately by the consenting user.
- Golden Path Acceptance evidence remains for the supported lifetime of its release plus thirteen months.
- Retention never removes evidence required by an active Workflow Run, Budget or Quota Reservation, Publishing Approval, Publishing Delivery, idempotency obligation, or unresolved reconciliation.
- Eligible deletion leaves only a **Retention Tombstone** sufficient to preserve identity, terminal outcome, digest, idempotency, and non-duplication guarantees.
- Local and self-hosted operators may select different durations, but a shorter policy never retroactively violates active safety obligations.
- Every Application Capability returns the same transport-neutral **Capability Result** envelope with status `completed` or `accepted`.
- A **Durable Acceptance** atomically persists authorization and approval evidence, idempotency receipt, authoritative domain state, initial ordered event, and one **Execution Outbox Intent** before reporting success.
- The outbox relay may deliver an **Execution Outbox Intent** more than once; the **Durable Orchestrator** and Runtime Kernel deduplicate it using stable domain identity.
- The accepting process makes a best-effort immediate outbox delivery after commit, while a server-owned scheduled sweeper republishes undelivered or stale Execution Outbox Intents.
- Asynchronous capabilities return Workflow Runs, Publishing Deliveries, Automation Occurrences, or another owning domain resource; the runtime has no parallel generic Job model.
- CLI wait mode, MCP polling, REST streaming, and Cockpit live updates compose the canonical inspect and event capabilities and never alter the accepted command's semantics.
- Every Application Capability declares one **Capability Approval Contract**: `none`, `manages-approval`, or `required-before-effect`.
- Required Approval is validated inside the capability before any partial work or provider effect; transport confirmation cannot substitute for durable Approval.
- Human and eligible policy decisions create the same durable Approval resource, while authorization remains an independent mandatory check.
- Approval errors identify the canonical request capability and safe subject/action context an authorized caller can use to continue.
- Every Application Capability failure returns one canonical **Capability Error**; transports only map its presentation and status.
- Capability Error codes such as `IDEMPOTENCY_CONFLICT`, `APPROVAL_REQUIRED`, and `REVISION_MISMATCH` remain stable across transports and versions until an explicit breaking contract version.
- Capability Errors expose typed, safe recovery information and an opaque operator trace reference but never raw provider diagnostics, secrets, stack traces, or cross-Workspace existence.
- Application Capabilities remain atomic at one clear transaction or durable domain-resource boundary.
- High-level outcomes are expressed as inspectable **Agent Recipes**, Content Workflows, or Automations that compose atomic capabilities without hiding new business behavior.
- Agent Recipes own no parallel durable state; partial progress remains visible through the domain resources returned by each capability.
- A composite that requires its own durable execution, atomicity, idempotency, approval, or authorization contract must become an explicit domain resource and Application Capability.
- External Agents always retain direct access to every atomic capability allowed by their Principal Grant Set for recovery and custom orchestration.
- Collection capabilities return a **Capability Page** with opaque, context-bound cursor pagination and recheck current authorization on every read.
- Resource event capabilities return a **Capability Event Page** ordered by per-resource sequence; canonical resource snapshots remain authoritative.
- CLI wait, MCP polling, REST streaming, and Cockpit subscriptions expose the same retained event records and never define transport-only events.
- One **Capability Registry** owns capability schemas, handler bindings, policy metadata, and generated transport artifacts.
- CLI invokes `<capability-id>@<version>`, MCP exposes a derived `nb__<id>__v<version>` tool, REST uses `/api/capabilities/<id>/versions/<version>/invoke`, and Cockpit uses the generated typed SDK.
- Every adapter follows the **Transport Parity Contract** and may implement authentication acquisition, framing, streaming, and presentation only.
- Transports resolve one Security Context before dispatch; caller input can never supply or override Principal or Workspace identity.
- Golden parity tests execute equivalent invocations through CLI, MCP, REST, and Cockpit adapters and compare canonical authorization, approval, idempotency, effects, results, and errors.
- Capability discovery returns only definitions allowed by the caller's current Security Context.
- Every published Capability Identity version is immutable, has a canonical contract digest, and follows the **Capability Lifecycle**.
- Capability invocation, Agent Recipes, accepted-result continuations, and error remediations always pin an exact version; no executable `latest` alias exists.
- Any input, output, error, effect, idempotency, authorization, approval, or audit-contract change publishes a new integer version.
- Deprecated and replacement versions may coexist during migration; retired versions remain inspectable but cannot be invoked.
- The minimum v1 Capability Registry covers eight families: discovery and identity; Channels and credential handoffs; Workflows, versions, Runs, and Run Events; Artifact transfer and provenance; Publishing Plans, validations, Approvals, release, and Deliveries; Automations, occurrences, trigger receipts, controls, and events; human-only security administration; and Security Event inspection.
- The accepted minimum v1 catalog contains 93 atomic definitions: 71 callable by eligible Agent Principals and 22 restricted to eligible Human Principals; authorized discovery prevents callers from receiving irrelevant definitions.
- Capability families expose explicit domain lifecycle commands such as validate, create revision, activate, start, pause, cancel, retry, resume, reconcile, and revoke instead of generic update or delete.
- Direct provider calls remain internal Provider Adapter operations, while future product domains add new versioned capabilities without changing existing contracts.
- Human-only business operations remain Application Capabilities with explicit Principal-kind and scope requirements; they are not hidden Cockpit-only callbacks.
- Internal worker dispatch, provider effects, and Workflow node operations use separate runtime interfaces and never appear in the Application Capability catalog.
- An **External Agent** supplies goals, judgment, and orchestration; the **Content Operations Runtime** records and executes durable work.
- Every runtime command receives one resolved **Principal** and Workspace context regardless of transport.
- A Cockpit request resolves a **Human Principal** from the human authentication system; a headless Agent Interface request resolves an **Agent Principal**.
- An **Agent Principal** is never authorized by caller-supplied user or Workspace IDs and never impersonates its accountable human sponsor.
- Every production-capable Agent Interface request authenticates with an **Agent Key**; local CLI and stdio MCP do not rely on ambient machine trust.
- Agent Key plaintext is never retained by the runtime after creation, and revoking one key does not delete its Agent Principal or audit history.
- **Agent Pairing** requires an authenticated human confirmation and never derives authority from the local operating-system user alone.
- A local Agent Key is stored in an OS credential manager when available or in a `0600` credential file under a `0700` configuration directory; it is never automatically written into a project repository.
- Human Workspace roles and Agent grants map into one capability-scope vocabulary enforced inside application capabilities.
- Agent capability scopes cover Workflow, Artifact, Publishing, Automation, Channel, and credential-use actions; Principal, credential, and policy management remain human-admin authority.
- Agent resource access is explicitly allow-listed for Channels and Credential Profiles and may be narrowed to exact Workflows or Automations; newly added Workspace resources are not implicitly granted.
- Resource listings expose only permitted resources and safe metadata.
- `publishing:release` permits invoking release but never substitutes for a valid **Publishing Approval**.
- An **Agent Principal** cannot receive human `approval:decide` authority.
- An **Auto-publish Grant** belongs to an Agent Principal rather than an Agent Key; key rotation never changes the Principal's publishing policy.
- An Auto-publish Grant is evaluated server-side against the exact Plan Revision, Channels, action, limits, and current Workspace policy, and records an exact policy version and evaluation.
- Disabling or revoking an Auto-publish Grant prevents new policy Approvals; an unconsumed policy Approval is rechecked against current policy at release.
- Every Auto-publish Grant names exact Channels and actions, has bounded expiry, rolling Target-volume limits, and a maximum scheduling horizon; v1 has no Workspace-wide Channel wildcard or unlimited grant.
- Auto-publish evaluation is per **Publishing Target**, so covered Targets may advance by policy while uncovered Targets require human review.
- Workspace Owners hold Principal, credential, and policy management authority by default; Admins may manage Agent Principals, Agent Keys, and ordinary scopes but Auto-publish Grants require Owner authority in v1.
- A **Human Principal** must hold applicable **Approval Authority** to decide a Publishing Approval; releasing approved work does not itself confer that authority.
- No Principal may grant authority broader than its own effective authority, and Agent Principals can never manage Principals, credentials, policies, or human Approval Authority.
- Every grant, change, revocation, Approval decision, and policy evaluation records the acting Principal and resulting authority.
- Authorization is evaluated both at command admission and immediately before every external or irreversible effect, producing an **Authorization Decision**.
- Revoking an Agent Key prevents new requests but does not reinterpret admitted work; suspending its Agent Principal or changing grants, resource constraints, credentials, or Workspace policy may block future effects.
- Completed effects are never rolled back by later authorization changes; blocked durable work retains a structured reason and requires restoration, cancellation, or a newly authorized derived action.
- Runtime workers execute persisted authorized intent and record both the requesting Principal and runtime execution identity without possessing the original Agent Key.
- Requesting a **Publishing Approval** returns its durable identity and a human review location; Agent Principals may observe but never decide it.
- Deciding a Publishing Approval requires a live **Human Principal** with applicable **Approval Authority**, or an exact eligible policy evaluation for a policy-based decision.
- Publishing release requires the exact Approval identity and atomically rechecks its Plan Revision and digest, Target set, action, state, lifetime, supersession, revocation, current authorization, and fresh Publish Validation.
- Transport hints and prompts such as MCP destructive annotations, AI SDK approval gates, and CLI confirmations carry no authorization authority.
- An Agent request's Workspace comes only from its **Agent Key** binding and cannot be overridden by caller input.
- A Human Principal requires an explicitly selected active Workspace and current membership; the runtime never silently chooses the first available membership.
- All resource lookups are constrained by the resolved Workspace, and cross-Workspace identifiers do not reveal whether a resource exists.
- Durable workers resolve Workspace identity from the persisted resource they execute, never from ambient request headers or environment variables.
- Suspending an **Agent Principal** blocks new commands and future external effects while preserving keys, grants, and history; terminal revocation invalidates all of its keys and grants.
- If an Agent Principal's accountable sponsor loses applicable Workspace membership or authority, the Principal is automatically suspended.
- Reassigning sponsorship requires Owner action and grant review and never changes past Approval attribution.
- Referenced Agent Principals are archived rather than hard-deleted so durable resource and audit history remains attributable.
- A **Content Workflow** produces versioned **Artifacts** without deciding where or when they are published.
- A **Content Workflow** may bind a versioned operation's credential requirement to a **Credential Slot**, but never stores the underlying secret.
- A **Credential Slot** resolves to an allowed **Credential Profile**, and the runtime records only non-secret profile and version references in the Workflow Run.
- Provider secrets live only inside the **Credential Vault**; Agent Principals with credential-use authority can invoke allowed operations but can never read or manage those secrets.
- Model-provider Credential Profiles are selected through Workflow bindings, while social connection profiles are used only through their associated Channels.
- A Workflow Run snapshots one exact model-provider **Credential Version**; normal rotation affects new Runs while a bounded grace period lets existing Runs finish.
- Emergency Credential Profile or Version revocation blocks future provider effects immediately, even for an existing Run, and records a structured credential-unavailable reason.
- A Publishing Delivery resolves the Channel's current active Credential Version immediately before provider work and records the version used.
- Provider secret material enters the Credential Vault only through a **Credential Handoff** controlled by a Human Principal or provider callback.
- Agent Principals may initiate Credential Handoffs and observe safe profile and connection metadata but never receive provider consent, API keys, app passwords, OAuth tokens, or refresh tokens.
- Security-relevant identity, authentication, key, grant, credential, policy, authorization, and Approval transitions append immutable **Security Events**.
- Security Events are operator-readable and exportable but never include bearer plaintext, provider secret material, generated content, or raw provider responses.
- REST, CLI, MCP, Cockpit, Automation, and runtime workers normalize identity into one **Security Context** before invoking application capabilities.
- **Security Contract v1** documents are strict and versioned; immutable grant and policy revisions receive runtime-computed digests.
- Agent Key plaintext and provider credential input exist only in one-time or write-only secret-bearing responses and handoffs and never appear in Security Contract metadata.
- A **Workflow Run** references exactly one immutable **Content Workflow Revision** and one resolved input snapshot.
- Mutable canvas JSON and editor layout are never executable authority; the Runtime Kernel validates and normalizes them before creating a Content Workflow Revision.
- A **Legacy Canvas Document** enters the new runtime only through a versioned **Legacy Workflow Import** and is never accepted by a Workflow Run start capability.
- Legacy Workflow Import preserves the source document and digest, creates a new Workflow Draft, and returns a **Workflow Import Report** without mutating the source.
- Every imported element receives an explicit **Workflow Compatibility Class**; the importer never simulates behavior, treats stored output as newly generated, or silently omits an executable element.
- Presentation-only legacy elements may become Cockpit projections over canonical Artifacts, while replacement-required and unsupported executable elements block Runtime Promotion.
- Legacy group position, color, and membership may become presentation metadata, but a group whose lock state changes execution blocks Runtime Promotion until the user explicitly unlocks it or removes its steps.
- A legacy paused edge is replacement-required until it is removed or replaced by a defined runtime checkpoint or wait operation.
- Legacy switch configuration maps directly only when its routing behavior is completely representable and deterministic.
- Imported media becomes honestly originated Artifacts; legacy execution status, generated outputs, histories, errors, and other transient state do not become executable configuration or invented Workflow Run history.
- Legacy media bytes are ingested into the managed Artifact Store and verified by content hash; arbitrary source filesystem paths never remain live canonical execution references.
- A missing, inaccessible, changed, or hash-mismatched legacy file is recorded in the Workflow Import Report and blocks Runtime Promotion only when required by an executable input.
- Canonical Workflow Drafts and Content Workflow Revisions are never exported back into the Legacy Canvas Document format.
- Postgres is the sole live authority for runtime-native Workflow Drafts, Revisions, and Runs in both local and hosted deployments.
- Filesystem JSON is accepted only through explicit import and **Workflow Export** boundaries; auto-save never maintains a second writable copy of canonical Workflow state.
- Re-importing a Workflow Export creates a new Workflow Draft with source provenance rather than overwriting a Workflow by local path.
- Every Workflow has exactly one **Workflow Execution Authority**; legacy and Runtime Kernel execution never mix within a graph or share one Run.
- A runtime validation or execution failure is surfaced as a canonical error and never triggers silent browser fallback.
- **Runtime Promotion** creates or advances the runtime-native Content Workflow while preserving the Legacy Canvas Document under a separate identity for reference and rollback of the user's migration choice.
- Migration first proves the **Golden Workflow Slice** through CLI or stdio MCP, then invokes the same Revision and capabilities from the Cockpit before expanding node compatibility.
- The Golden Workflow Slice is accepted only by a passing **Golden Path Acceptance Run**; a guided demo, successful UI walkthrough, or happy-path provider call is insufficient.
- A Golden Path Acceptance Run binds all evidence to one exact build, Capability Registry digest, runtime environment, and clean Workspace fixture.
- During a Golden Path Acceptance Run, the External Agent discovers and carries canonical resource references itself; humans never copy identifiers or results between protocol stages.
- The Cockpit contributes only explicitly declared human actions during a Golden Path Acceptance Run, while every non-human action uses CLI or stdio MCP through the shared Capability Entrypoint.
- The **Acceptance Evidence Bundle** is authoritative for the acceptance verdict; screenshots, recordings, and prose summaries are supplemental.
- Golden Path acceptance requires both the **Deterministic Conformance Lane** and **Live Dogfood Lane** to pass against the release candidate.
- The Deterministic Conformance Lane uses deterministic Provider Adapters only at external-effect boundaries; canonical persistence, authorization, approval, outbox, worker, Artifact, transport, and Cockpit paths remain real.
- The Live Dogfood Lane uses real provider credentials and a controlled LinkedIn Channel, verifies a future-scheduled Publishing Delivery, then cancels it before provider publishing begins.
- A real public provider effect belongs only to a separately authorized **Provider Smoke Test** and is never an implicit consequence of routine acceptance.
- A **Golden Path Acceptance Run** starts only after its **Acceptance Readiness Check** passes; agent pairing, Credential Profile provisioning, Channel connection, and human Approval Authority are setup prerequisites rather than in-run assistance.
- The External Agent discovers usable Credential Profiles and Channels through capabilities; acceptance scripts contain no prefilled resource identifiers and humans never copy them into the run.
- The only permitted human mutation during a Golden Path Acceptance Run is deciding the exact Publishing Approval in the Cockpit; human observation does not authorize any other Cockpit mutation.
- Pairing, Credential Handoff, Channel connection, and secret-isolation behavior are verified by separate security conformance scenarios and remain prerequisites to the golden path.
- The **Golden Path Acceptance Protocol** discovers exact capability versions and digests through `capabilities.list`, `capabilities.get`, and `identity.get_current` rather than executing an unversioned alias.
- The protocol discovers a usable generation Credential Profile and controlled LinkedIn Channel, verifies Channel capabilities, and imports the reference image as an Artifact.
- The protocol invokes `workflow_versions.validate` and `workflow_versions.create`, then starts the immutable Revision through `workflow_runs.start` with an idempotency key.
- The External Agent pages `workflow_run_events.list` by cursor and uses `workflow_runs.get` as the authoritative snapshot until the Run reaches a terminal state.
- The protocol retrieves the generated copy and hero-image Artifacts through Artifact capabilities and verifies each content hash and Run, step, Attempt, and output-port provenance.
- The protocol invokes `publishing_plan_revisions.validate`, `publishing_plan_revisions.create`, and `publishing_validations.create` for an exact future-scheduled LinkedIn Target referencing those Artifacts.
- The protocol invokes `publishing_approvals.request`; the Human Principal decides the exact Approval in the Cockpit and the External Agent observes that durable decision through `publishing_approvals.get`.
- The External Agent invokes `publishing.release`, pages `publishing_delivery_events.list`, and inspects `publishing_deliveries.get` until the Delivery is canonically scheduled.
- The External Agent re-inspects the retained Run-to-Delivery resource chain without logs or UI-only state; in the Live Dogfood Lane it then invokes `publishing_deliveries.cancel` before provider publishing begins.
- An Agent Recipe may guide the protocol's orchestration but never substitutes for primitive capability evidence or owns hidden durable state.
- **Structured Progress Observation** is the normative asynchronous observation path for the Golden Path Acceptance Protocol; WebSocket, SSE, and Cockpit live updates are optional projections.
- Every asynchronous `accepted` Capability Result supplies the canonical resource reference, exact inspect capability, exact event capability, and initial event cursor.
- Cursor-paged events have immutable per-resource sequence numbers with no gaps or rewrites, and repeating the same page request yields stable retained results.
- The protocol terminates the External Agent process after saving a cursor, reconnects through the same transport, and resumes observation without logs or database access.
- Workflow Run events expose structured acceptance, step and Attempt progress, Artifact availability, blocking or retry state, and terminal outcome; Approval and Delivery events expose their corresponding lifecycle transitions.
- The authoritative resource snapshot and latest retained event must agree at every protocol assertion point.
- Events contain safe metadata and resource references only, never Credential material, generated content, binary payloads, or raw provider responses.
- Event history required by the protocol remains queryable after the resource reaches a terminal state.
- The protocol proves **Historical Run Replay** by reconstructing the completed Run and its Artifact lineage from retained capabilities without executing new work.
- Repeating `workflow_runs.start` with the same Capability Idempotency key and identical canonical input returns the original receipt and same Run without creating another Attempt or provider effect; different canonical input returns `IDEMPOTENCY_CONFLICT`.
- The Deterministic Conformance Lane creates an eligible failed Run and proves that `workflow_runs.retry` performs a **Derived Run Retry** rather than mutating or re-executing the original Run.
- Repeating `publishing.release` with the same key and identical canonical input returns the original Deliveries and cannot consume the Publishing Approval twice or create another provider effect.
- Every probe in the **Acceptance Failure Matrix** is release-blocking and contributes structured assertions to the Acceptance Evidence Bundle.
- The matrix terminates the External Agent immediately after Durable Acceptance, restarts the host or worker before outbox delivery and during step execution, and proves the same Run continues without duplicate Attempts, Artifacts, or provider effects.
- A deterministic known-transient provider failure creates only the bounded next Workflow Step Attempt and may then succeed.
- A deterministic provider `outcome_unknown` blocks the Workflow Run without blind retry; the required `workflow_runs.reconcile@1` Application Capability resolves the blocked Attempt from provider evidence while preserving its Effect Key.
- The capability catalog must expose `workflow_runs.reconcile@1` before Golden Path acceptance can pass; `workflow_runs.submit_input` is not a substitute for provider-effect reconciliation.
- The matrix proves identical and conflicting Capability Idempotency replays for `workflow_runs.start` and `publishing.release`.
- Release before Approval returns a structured Approval-required error, and an Agent Principal attempting `publishing_approvals.decide` receives a structured authorization error without changing the Approval.
- Editing a Publishing Plan after Approval creates a new Revision that cannot consume the older Revision's Approval.
- Revoking required credential or Channel readiness before an external boundary blocks work safely and creates no unauthorized provider effect.
- Cross-Workspace inspection returns a non-leaking denial and exposes no resource-existence detail.
- Artifact byte retrieval is verified against the canonical content hash, and any mismatch fails acceptance.
- Cancelling the future Publishing Delivery reaches a canonical cancelled state and the deterministic effect ledger proves that no public provider effect occurred.
- The Deterministic Conformance Lane executes the complete Golden Path Acceptance Protocol on isolated fixtures through CLI and through stdio MCP.
- CLI and MCP results are compared as canonical projections that ignore expected identifiers and timestamps but require equivalent authorization, approval, idempotency, state transitions, structured errors, effects, and evidence shape.
- The Live Dogfood Lane executes generation and initial observation through stdio MCP, then proves **Cross-Transport Continuation** by operating the same canonical resource chain through CLI.
- Cross-Transport Continuation requires no export, import, resource recreation, transport-owned session state, or human-supplied resource identifier.
- Readiness, inspection, Historical Run Replay, recovery, release, and cancellation remain callable through either agent transport.
- REST and Cockpit adapter parity remain mandatory in the wider Capability Registry conformance suite; during the Golden Path Acceptance Protocol, the Cockpit's only mutation is the Human Principal's Approval decision.
- The **Acceptance Harness** is outside the Content Operations Runtime and may use only declared product boundaries; no internal endpoint, database query, log scrape, or test-mode mutation may contribute to a passing verdict.
- The Acceptance Evidence Bundle records protocol version, build commit or image digest, Capability Registry digest, lane, runtime topology, timestamps, and every readiness assertion.
- For each invocation it records the Capability Identity, transport, canonical request digest, result status, canonical resource reference, and applicable event cursor range without retaining secret input.
- Its resource graph connects the Workflow Run, Workflow Step Attempts, generated Artifacts, Publishing Plan Revision, Publishing Validation, Publishing Approval, and Publishing Delivery.
- Artifact content hashes and provenance, revision-bound human Approval evidence, failure-probe errors, Capability Idempotency outcomes, Effect Keys, scheduled and cancelled Delivery states, and deterministic no-public-effect evidence are mandatory assertions.
- A redaction audit and overall `pass` or `fail` are part of the content-addressed evidence; any missing, unknown, or skipped mandatory assertion fails closed.
- Failed Acceptance Evidence Bundles remain retained and are never replaced by a later successful bundle.
- A release candidate passes only when both acceptance lanes have successful bundles for the exact same build and Capability Registry digest; any implementation or capability-contract change invalidates that verdict.
- The Deterministic Conformance Lane runs for every change to runtime contracts, capability adapters, security, persistence, orchestration, Artifact handling, or publishing behavior, and runs nightly against the integration branch.
- The Live Dogfood Lane runs for every release candidate after deterministic conformance passes and runs weekly against staging to detect credential, provider, OAuth, or Channel drift.
- The **Release Acceptance Gate** blocks promotion when a required bundle is failed, missing, stale, or invalidated.
- A failed run notifies maintainers with its Acceptance Evidence Bundle reference and first failed assertion; automatic reruns never convert the failed verdict into an implicit pass.
- A Provider Smoke Test runs only after a material Provider Adapter or Channel integration change or an explicit human request, and retains its separate Approval evidence.
- Every Golden Path Acceptance Protocol declares an **Acceptance Deadline Budget**; no readiness, execution, Approval, observation, recovery, reconciliation, scheduling, or cancellation wait is unbounded.
- Missing a declared deadline produces `fail`, while the human-Approval interval is reported separately from runtime execution latency.
- The future scheduled instant preserves a safety margin greater than the Approval, release, and cancellation deadlines plus the protocol's clock-skew allowance.
- Polling follows a server retry hint or the protocol's declared bounded backoff and never relies on an arbitrary sleep.
- Initial deadline values are calibrated against the first real staging harness execution and frozen in protocol v1; changing them requires a new protocol version.
- The **Golden Path Fixture** is immutable, versioned, and non-sensitive; it supplies the exact launch brief, reference-image hash, Content Workflow candidate, required output types, and structural policy assertions.
- Deterministic Conformance provisions an isolated Workspace per protocol run, while Live Dogfood uses a dedicated staging Workspace with persistent real Credential Profiles and controlled LinkedIn Channel connection.
- Every run allocates a unique **Acceptance Scope** and creates new Workflow, Run, Artifact, Publishing Plan, Approval, and Delivery resources; resources retained from another scope can never satisfy an assertion.
- The controlled LinkedIn Channel is discovered through declared safe metadata rather than a hardcoded identifier.
- Deterministic generated outputs must match exact fixture hashes; live generated outputs must satisfy type, non-empty content, content-hash integrity, provenance, and policy assertions without requiring identical prose or pixels.
- Cancelling the live Delivery does not delete its canonical resource chain, and successful and failed run resources and evidence remain retained under the applicable audit policy.
- Availability of the Golden Workflow Slice starts the **Legacy Maintenance Window**: existing legacy projects remain usable, but new workflow behavior is never added to the legacy executor.
- Runtime-native authoring becomes the default; creating a new legacy project may remain only as an explicitly deprecated temporary escape hatch for a replacement-required operation.
- No product feature is implemented in both execution authorities.
- **Runtime Admission Policy** advances from internal canary to opt-in beta to the default for new Workflows; rollout remains scoped per Workspace.
- Shadow analysis may parse, classify, and validate a Legacy Canvas Document without mutation, but it never executes a provider effect or writes parallel canonical domain state.
- Disabling runtime admission stops new acceptance only; existing Workflow Runs continue under Runtime Kernel authority or remain canonically inspectable.
- Rollback never dual-writes, mirrors, or converts canonical resources back into legacy storage.
- **Legacy Execution Retirement** occurs only after new legacy creation is disabled, all retained documents have Import Reports, active operation use is resolved or explicit, active Workspaces show sixty consecutive days without legacy execution, and supported runtime operations pass failure and transport-parity conformance.
- Legacy Execution Retirement removes only browser execution; read-only inspection, original download, and Legacy Workflow Import remain available.
- Golden Workflow Slice Artifacts attach to the existing publishing domain through its normal capabilities; Content Workflow execution never absorbs Publishing Plan, Approval, or Delivery behavior.
- Existing social persistence, validation, Provider Adapters, dispatch recovery, and durable publishing remain authoritative during migration and are exposed through the shared Capability Entrypoint rather than rewritten.
- A **Legacy Publishing Post** and canonical Publishing Plan resources never mirror state or represent the same publishing action.
- New agent capabilities create and operate canonical Publishing Plans, Approvals, and Deliveries only.
- Proven publishing settings, validation, media processing, credential refresh, Provider Adapter, and dispatch-recovery behavior may be reused beneath both lifecycles without sharing their domain records.
- A **Legacy Publishing Import** may create a new Publishing Plan only from an eligible draft; scheduled, publishing, published, failed-after-effect, and otherwise externally committed legacy Posts remain legacy history.
- CLI, stdio MCP, REST, Cockpit, and durable workers invoke the same in-process **Runtime Kernel**; transport and worker adapters do not own alternate business behavior.
- `packages/runtime` may depend only on framework-neutral domain libraries and declared ports; Next.js, CLI/MCP framing, Workflow SDK, database-driver, object-storage, and concrete Provider Adapter dependencies stay in host-side adapters and composition roots.
- `packages/runtime` exposes only the **Capability Entrypoint**, **Worker Entrypoint**, and their versioned contracts; domain internals and concrete ports are not public entrypoints.
- Agent and human transports may invoke only the Capability Entrypoint; the Durable Orchestrator adapter may invoke only the Worker Entrypoint with stable references to persisted authorized intent.
- Storage, transaction, outbox, Artifact bytes, credential resolution, authorization policy, provider effects, clocks, identifiers, and durable orchestration enter the Runtime Kernel through narrow injected ports.
- Postgres-backed Runtime Kernel snapshots are canonical product state; a **Durable Orchestrator** stores only the operational history needed to schedule and resume work.
- The **Workflow SDK Adapter** is the first Durable Orchestrator implementation and is replaceable without migrating Capability, Workflow Run, Attempt, Event, or Artifact contracts.
- Hosted production uses Vercel World, local development uses Local World, and self-hosted deployment may use Postgres World only with a long-lived worker; Local World is never a production backend.
- The Workflow SDK dependency is pinned and isolated outside `packages/runtime`; SDK run identifiers and histories remain internal operational references.
- A **Durable Orchestrator** drives Runtime Kernel worker commands by stable Run, step, Attempt, and Effect Key references and remains replaceable without changing public Run semantics.
- Worker commands are short-lived and re-entrant; long waits belong to the Durable Orchestrator, while Runtime Kernel transitions use fenced **Execution Leases** so stale workers cannot commit.
- Browser closure, process restart, failed initial outbox delivery, worker crash, and deployment replacement never revoke Durable Acceptance; relay and sweep recovery resume the same stable domain work.
- The Runtime Kernel creates every **Workflow Step Attempt** and owns its retry classification, limit, backoff, and terminal transition; a **Durable Orchestrator** may only redeliver the same worker command.
- Each provider-facing Workflow Step Attempt uses one stable **Effect Key** across infrastructure re-entry and reconciliation.
- A **Provider Adapter** performs one fenced intended effect and normalizes its outcome; the Runtime Kernel alone translates that outcome into Workflow Step Attempt, Artifact, Run Event, retry, or reconciliation state.
- Provider Adapters never retry semantic work, mutate domain tables, schedule durable work, or emit domain events.
- A known-safe transient failure may append a bounded next Workflow Step Attempt; an unknown provider outcome blocks the Workflow Run for explicit reconciliation and is never retried blindly.
- Postgres owns canonical Artifact metadata and lineage; the **Artifact Store** owns immutable bytes only.
- Workflow Runs, Run Events, and capability results reference Artifact IDs and safe metadata rather than embedding binary data, base64 payloads, or raw provider responses.
- Every accepted **Workflow Run** transition updates its canonical snapshot and appends one or more ordered **Run Events** atomically.
- A **Publishing Plan** references content or **Artifacts** and decides their **Channels**, **Publishing Settings**, timing, validation, and approval state.
- A **Publishing Target** has one concrete timing intent: publish now or at an exact instant. An originating timezone may be retained for display but has no execution meaning.
- Recurring timing belongs to **Automation**, which materializes concrete publishing work for each occurrence.
- Every accepted **Publishing Plan** edit creates a new immutable **Publishing Plan Revision** with a new digest.
- A **Publishing Plan Revision** contains one or more **Publishing Targets**.
- A **Publishing Target** selects exactly one **Channel**; publishing equivalent content to multiple Channels uses multiple Targets.
- Multiple **Publishing Targets** may reference the same immutable **Artifacts**, but each owns its destination-specific content, settings, timing, readiness, Approval coverage, and Delivery outcome.
- Ready **Publishing Targets** may be approved and released independently while other Targets in the same Plan remain unready or unreleased.
- A **Publishing Approval** may cover one or more exact ready Targets that share the same scheduling or publishing action.
- Human review and policy-based auto-publish create the same **Publishing Approval** resource and follow the same release path, while recording different decision bases.
- Failure or cancellation of one **Publishing Delivery** does not roll back Deliveries for other Targets; overall Plan progress is derived from per-Target state.
- A **Publishing Approval** authorizes only the exact **Publishing Plan Revision** it evaluated; a later edit requires a new Approval.
- A **Publishing Approval** is consumed exactly once when its **Publishing Deliveries** are created; execution retries belong to those Deliveries.
- Every unconsumed **Publishing Approval** must expire within a maximum set by Workspace policy; an expired decision cannot be renewed and must be replaced.
- A new **Publishing Plan Revision** supersedes every pending or approved but unconsumed Approval for an older revision.
- Expiry never cancels **Publishing Deliveries** already created from a consumed Approval.
- A pending or approved **Publishing Approval** may be revoked; after consumption, cancellation belongs to each **Publishing Delivery**.
- A **Publishing Delivery** may be cancelled before provider publishing begins, but cancellation is not guaranteed after that point.
- A **Publishing Delivery** retains its **Publishing Plan Revision** snapshot even if the Plan is edited later.
- An **Automation** starts a **Content Workflow** or advances a **Publishing Plan** in response to a time, event, or explicit command.
- Every accepted **Automation** edit creates an immutable **Automation Revision**.
- Every accepted trigger creates a durable **Automation Occurrence** bound to the exact **Automation Revision** that handled it.
- Editing an **Automation** never changes an existing **Automation Occurrence** or the durable work that Occurrence materialized.
- A **Source Occurrence Key** is unique within the stable **Automation**, not merely within one Automation Revision, so a delayed retry cannot create new work after the Automation changes.
- Each observed external source event creates a durable **Trigger Receipt** even when it is ignored or rejected.
- An accepted external event's Trigger Receipt, **Automation Occurrence**, and opaque cursor advance are atomic; downstream failure never rewinds the cursor.
- Cursor reset and historical replay are explicit operator actions, not side effects of editing an **Automation**.
- Every recurring local-time trigger uses a **Local-time Schedule** with an IANA timezone and explicit daylight-saving policy.
- A materialized time-triggered **Automation Occurrence** freezes its local date and time, timezone, resolved UTC instant, and UTC offset; later timezone-database changes cannot move it.
- Every **Local-time Schedule** declares a bounded **Catch-up Policy**; `skip` is the safe default.
- Catch-up never rewrites an occurrence's intended time to the current instant, and skipped or truncated schedule slots remain auditable.
- Every **Automation Revision** declares an **Overlap Policy**; `queue` is the default.
- A Workflow-starting Occurrence occupies its concurrency slot until the referenced **Workflow Run** is terminal.
- A publishing-only Occurrence releases its concurrency slot when the concrete Plan, Approval, or Delivery work is durably materialized; subsequent **Publishing Delivery** execution is independent.
- A paused **Automation** does not start queued Occurrences; active work continues unless separately cancelled.
- Scheduled slots during pause follow the **Catch-up Policy** on resume; external events observed during pause create ignored Trigger Receipts and advance their source cursor.
- An explicit command against a paused **Automation** returns a state conflict without consuming its caller-supplied **Source Occurrence Key**.
- Cancelling a queued **Automation Occurrence** is immediate; cancelling a Workflow-backed active Occurrence requests cancellation of its **Workflow Run** without promising rollback.
- Once publishing work has been materialized, cancellation belongs to the resulting **Publishing Deliveries**, not to the completed Occurrence.
- An **Automation Action** references exact immutable Workflow and source Plan revisions; it never embeds or mutates their definitions.
- One **Automation Occurrence** starts at most one idempotent **Workflow Run** and materializes at most one new one-time **Publishing Plan**.
- A materialized Plan records the source Plan Revision, Automation Occurrence, and any Workflow Run provenance; target timing resolves to the Occurrence instant plus declared per-target offsets.
- Every publishing **Automation Action** declares an **Automation Approval Mode**; `request_human` is the default.
- Automation invokes the same Publish Validation, Approval, and release commands as the **Agent Interface** and **Cockpit**; it cannot directly set Approval state or bypass release-time validation.
- A policy `allow` records the exact policy version and evaluation as the Approval decision basis; Automation never impersonates a human approver.
- An **Automation Occurrence** moves through `queued`, `running`, or genuine external-input `waiting`, then terminates as `succeeded`, `failed`, `cancelled`, or `skipped`; a separate stage identifies the current action boundary.
- Every Automation-owned retry appends an **Automation Stage Attempt** and reuses the stage's stable effect key.
- Workflow retry remains owned by the **Workflow Run**, and Delivery retry remains owned by the **Publishing Delivery**; Automation never silently creates a replacement child resource.
- Manual retry creates a new derived **Automation Occurrence** and preserves the original terminal Occurrence.
- A derived Occurrence may reuse verified Workflow outputs or an already-materialized Plan, but never recreates a durable effect whose stable key already succeeded.
- A pending human **Publishing Approval** is a successful Automation materialization outcome, not an active or waiting Occurrence.
- Every **Automation Revision** declares exactly one **Automation Trigger**; separate automatic sources use separate Automations that may reuse the same Workflow and source Plan revisions.
- Automation v1 schedule triggers support an exact instant or structured daily, weekly, or monthly local-calendar recurrence with explicit interval, bounds, timezone, daylight-saving, and catch-up semantics.
- External event trigger types and filters are strict and connector-versioned; unknown fields are rejected.
- An **Automation Revision** affects live triggering only after **Automation Revision Activation**.
- Trigger acceptance and active-revision selection are atomic; existing or queued Occurrences remain bound to their original Revision.
- A newly activated schedule never materializes slots before its activation instant without explicit replay.
- Activation continues the existing cursor only when the event stream identity is unchanged; changing connector or stream identity requires an explicit starting position and defaults safely to `latest`.
- Revisions may be created or activated while an Automation is paused, but no queued or new work starts until resume.
- Automation mutations are idempotent application commands shared by REST, CLI, MCP, and Cockpit adapters; transport handlers never implement separate Automation behavior.
- Canonical Automation resource snapshots are authoritative, while ordered **Automation Events** provide resumable observation through a per-Automation `afterSequence` cursor.
- Automation Events are deduplicated by Automation ID and sequence and exclude content, secrets, and raw connector payloads.
- **Automation Contract v1** snapshots are strict and versioned; the runtime, not the caller, computes the immutable Automation Revision digest.
- Automation creation and activation validate Workspace ownership, exact referenced versions and digests, typed bindings, connector schemas, and policy references.

## Example Dialogue

> **Dev:** "When a user connects YouTube, are they adding an integration or an account?"
> **Domain expert:** "They are adding a **Channel**. YouTube is the **Platform**, and the YouTube **Provider Adapter** handles OAuth and publishing."
>
> **Dev:** "Where do YouTube privacy and Reddit subreddit choices belong?"
> **Domain expert:** "Those are **Publishing Settings** for the selected **Channel**, not global post content."
>
> **Dev:** "If I publish the same post to two YouTube channels, do they share one privacy setting?"
> **Domain expert:** "No. The YouTube **Platform** defines the privacy field, but each selected **Channel** stores its own **Publishing Settings** value for that post."
>
> **Dev:** "Can this post be scheduled if TikTok has no media attached?"
> **Domain expert:** "No. **Publish Validation** should catch that before the post is sent through the TikTok **Channel**."
>
> **Dev:** "Can a creator save a YouTube draft before choosing privacy or title?"
> **Domain expert:** "Yes. A draft **Post** can be incomplete, but scheduling or publishing it must pass **Publish Validation**."
>
> **Dev:** "Should YouTube default to public because Postiz does?"
> **Domain expert:** "No. Node Banana uses **Safe Defaults** so generated or experimental work is not published publicly by accident."
>
> **Dev:** "If a post targets YouTube and Reddit, can one readiness state cover both?"
> **Domain expert:** "No. Each selected **Channel** has its own **Publishing Readiness** because each may require different **Publishing Settings**."
>
> **Dev:** "Can one Reddit **Channel** publish the same post to five subreddits at once?"
> **Domain expert:** "No. A Reddit **Channel** post targets one subreddit destination at a time; creators can duplicate or create separate posts for multiple subreddits."

## Flagged Ambiguities

- "integration" was used to mean a connected publishing destination; resolved: use **Channel** for the destination and reserve "integration" for broader third-party product integrations.
- "settings" was used broadly; resolved: use **Publishing Settings** for platform-specific options attached to publishing a **Post** through a **Channel**.
- Existing code and database fields may still use `socialAccountId` and `platformSettings`; resolved: keep those implementation names for now while using **Channel** and **Publishing Settings** in product/domain language and new domain-facing code.
- Node Banana was previously described as only a **Cockpit** backed by a separate Flowleap **Content Engine**; resolved: Node Banana owns the **Content Operations Runtime**, while the **Cockpit** and **Agent Interface** are clients of it.
