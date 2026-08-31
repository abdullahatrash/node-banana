/**
 * THROWAWAY PROTOTYPE.
 *
 * Pure comparison model for the durable runtime/package boundary.
 */

export const INVARIANTS = [
  "authoritative-domain-snapshot",
  "durable-acceptance",
  "transport-parity",
  "domain-owned-retries",
  "fenced-provider-effects",
  "in-process-callable",
  "replaceable-orchestrator",
] as const;

export type Invariant = (typeof INVARIANTS)[number];

export interface ArchitectureShape {
  id:
    | "browser-executor"
    | "workflow-sdk-authority"
    | "standalone-runtime-service"
    | "runtime-kernel";
  name: string;
  summary: string;
  domainAuthority: string;
  orchestrationAuthority: string;
  callPath: string;
  packageBoundary: string[];
  passes: Invariant[];
  knownCosts: string[];
}

export interface FailureScenario {
  id:
    | "browser-disappears"
    | "dispatch-crash"
    | "provider-outcome-unknown"
    | "deployment-change"
    | "transport-equivalence"
    | "orchestrator-replacement";
  name: string;
  stimulus: string;
  requiredOutcome: string;
}

export interface ScenarioEvaluation {
  architecture: ArchitectureShape;
  scenario: FailureScenario;
  trace: string[];
  invariantResults: Array<{
    invariant: Invariant;
    passed: boolean;
    reason: string;
  }>;
  verdict: "survives" | "survives-with-caveat" | "fails";
}

export const AGREED_RUNTIME_BOUNDARY = {
  package: "packages/runtime",
  executableEntrypoints: ["capabilities", "workers"],
  canonicalPersistence: "postgres-domain-snapshots",
  acceptanceTransaction: [
    "domain-transition",
    "initial-event",
    "idempotency-receipt",
    "authorization-and-approval-evidence",
    "execution-outbox-intent",
  ],
  executableWorkflow: "immutable-normalized-workflow-revision",
  artifactBytes: "artifact-store-port",
  providerOutcomes: ["succeeded", "failed_known", "outcome_unknown"],
  durableAdapter: {
    implementation: "workflow-sdk",
    hosted: "vercel-world",
    development: "local-world",
    selfHosted: "postgres-world-with-long-lived-worker",
  },
  recovery: [
    "immediate-outbox-relay",
    "scheduled-outbox-sweeper",
    "short-lived-reentrant-workers",
    "fenced-execution-leases",
  ],
  forbiddenKernelDependencies: [
    "next.js",
    "transport-framing",
    "workflow-sdk",
    "database-driver",
    "object-storage-sdk",
    "concrete-provider-adapter",
  ],
} as const;

export const ARCHITECTURES: ArchitectureShape[] = [
  {
    id: "browser-executor",
    name: "Browser Executor",
    summary: "Keep Zustand and the canvas tab as execution authority.",
    domainAuthority: "Browser memory plus mutable canvas JSON",
    orchestrationAuthority: "The active browser tab",
    callPath: "Cockpit → Zustand → API routes; headless callers diverge",
    packageBoundary: [
      "src/store/workflowStore.ts owns orchestration and state",
      "src/store/execution owns browser-shaped node executors",
      "API routes own provider request behavior",
    ],
    passes: [],
    knownCosts: [
      "Execution dies with the tab or device",
      "No durable Run snapshot or Attempt ledger",
      "CLI/MCP cannot invoke the same executor safely",
    ],
  },
  {
    id: "workflow-sdk-authority",
    name: "Workflow SDK Authority",
    summary:
      "Expose Workflow SDK runs, history, steps, and retries as the product runtime.",
    domainAuthority: "Workflow SDK World event log",
    orchestrationAuthority: "Workflow SDK workflow and step functions",
    callPath: "All transports start or inspect Workflow SDK runs",
    packageBoundary: [
      "workflows/ owns orchestration and product state",
      "Workflow SDK run IDs become public Workflow Run IDs",
      "Step retry behavior defines product retry behavior",
    ],
    passes: [
      "durable-acceptance",
      "transport-parity",
      "in-process-callable",
    ],
    knownCosts: [
      "Public contracts inherit one orchestrator's data model and lifecycle",
      "Domain Approval, Artifact, Attempt, and Event semantics split across stores",
      "SDK retry/replay semantics can drift from agreed runtime semantics",
    ],
  },
  {
    id: "standalone-runtime-service",
    name: "Standalone Runtime Service",
    summary:
      "Deploy a separate service, database boundary, API, queue, and workers now.",
    domainAuthority: "Standalone runtime Postgres schema",
    orchestrationAuthority: "Standalone queue and worker fleet",
    callPath: "Next.js, CLI, and MCP call a network service",
    packageBoundary: [
      "Separate deployable runtime repository or workspace service",
      "Network API is the only supported application boundary",
      "Dedicated workers own provider execution",
    ],
    passes: [
      "authoritative-domain-snapshot",
      "durable-acceptance",
      "transport-parity",
      "domain-owned-retries",
      "fenced-provider-effects",
      "replaceable-orchestrator",
    ],
    knownCosts: [
      "Violates the explicit in-process-callable requirement",
      "Adds service deployment, local orchestration, auth, and version skew now",
      "Duplicates composition and infrastructure before product boundaries settle",
    ],
  },
  {
    id: "runtime-kernel",
    name: "Runtime Kernel + Durable Orchestrator Port",
    summary:
      "A framework-neutral in-process package owns domain truth; a durable adapter drives it by stable references.",
    domainAuthority: "Postgres runtime snapshots, Attempts, Events, and receipts",
    orchestrationAuthority:
      "Runtime state machine; Workflow SDK only schedules/resumes calls",
    callPath:
      "Next.js/CLI/MCP → one composition root → capability dispatcher → runtime kernel",
    packageBoundary: [
      "packages/runtime: framework-neutral contracts, handlers, transitions, ports",
      "capabilities entrypoint: authenticated public application operations",
      "workers entrypoint: internal advancement from persisted authorized intent",
      "Postgres adapter: snapshots, event append, outbox, leases, fencing",
      "Artifact Store adapter: immutable bytes; metadata remains in Postgres",
      "Provider adapters: one fenced effect and one normalized outcome",
      "Workflow SDK adapter: pinned, internal durable scheduling and resumption",
      "Composition root: builds the same Runtime for every entrypoint",
    ],
    passes: [...INVARIANTS],
    knownCosts: [
      "Requires a transactional outbox and recovery relay",
      "Requires strict import boundaries and adapter conformance",
      "Maintains domain events separately from orchestrator diagnostics",
    ],
  },
];

export const SCENARIOS: FailureScenario[] = [
  {
    id: "browser-disappears",
    name: "Browser disappears mid-generation",
    stimulus: "The Cockpit tab closes after a provider Attempt begins.",
    requiredOutcome:
      "The Run remains inspectable and continues or reaches a recorded failure.",
  },
  {
    id: "dispatch-crash",
    name: "Process dies after acceptance",
    stimulus:
      "The accepting process commits a Run, then dies before starting orchestration.",
    requiredOutcome:
      "Durable intent is recovered without creating a second Run.",
  },
  {
    id: "provider-outcome-unknown",
    name: "Provider outcome is unknown",
    stimulus:
      "The provider may have accepted an effect, but the response is lost.",
    requiredOutcome:
      "No blind duplicate; the exact Attempt blocks for reconciliation.",
  },
  {
    id: "deployment-change",
    name: "Deployment changes during a wait",
    stimulus: "New runtime code deploys while an old Run waits for input.",
    requiredOutcome:
      "The Run remains bound to its immutable Workflow and compatible executor.",
  },
  {
    id: "transport-equivalence",
    name: "CLI and Cockpit submit the same command",
    stimulus:
      "Equivalent exact-version invocations arrive through two transports.",
    requiredOutcome:
      "Both reach the same handler, policy, transaction, and result envelope.",
  },
  {
    id: "orchestrator-replacement",
    name: "Durable backend must change",
    stimulus:
      "A self-hosted deployment cannot use the currently selected managed World.",
    requiredOutcome:
      "Public Run, Event, Attempt, and Artifact contracts remain unchanged.",
  },
];

const scenarioTraces: Record<
  ArchitectureShape["id"],
  Record<FailureScenario["id"], string[]>
> = {
  "browser-executor": {
    "browser-disappears": [
      "Zustand and AbortController disappear with the tab.",
      "Provider request may continue remotely.",
      "No durable Attempt can establish the outcome.",
    ],
    "dispatch-crash": [
      "There is no durable acceptance transaction.",
      "The caller cannot distinguish accepted work from lost work.",
    ],
    "provider-outcome-unknown": [
      "The browser sees a rejected fetch.",
      "Retrying the node can duplicate the provider effect.",
    ],
    "deployment-change": [
      "The tab either retains stale client code or reloads and loses execution.",
    ],
    "transport-equivalence": [
      "Cockpit invokes Zustand; CLI/MCP invoke unrelated service functions.",
    ],
    "orchestrator-replacement": [
      "There is no durable orchestrator to replace, and no public Run contract.",
    ],
  },
  "workflow-sdk-authority": {
    "browser-disappears": [
      "Workflow SDK continues the run independently of the tab.",
      "SDK history is durable, but product snapshot semantics depend on SDK data.",
    ],
    "dispatch-crash": [
      "Workflow SDK start can be durable.",
      "Application idempotency and SDK run creation still need one acceptance boundary.",
    ],
    "provider-outcome-unknown": [
      "A thrown step is automatically retried by SDK policy.",
      "Without a separate Effect Key ledger, an external effect can duplicate.",
    ],
    "deployment-change": [
      "Managed Workflow SDK pins the run to its deployment.",
      "That deployment identity becomes part of the product's compatibility story.",
    ],
    "transport-equivalence": [
      "All transports can call start/getRun through one adapter.",
      "Application authorization and Approval still need a shared layer around it.",
    ],
    "orchestrator-replacement": [
      "Public Run and Event semantics are coupled to SDK history and identifiers.",
    ],
  },
  "standalone-runtime-service": {
    "browser-disappears": [
      "Service workers continue and persist Run state.",
    ],
    "dispatch-crash": [
      "Service database and queue can implement atomic durable intent.",
    ],
    "provider-outcome-unknown": [
      "Dedicated Attempt ledger and Effect Keys block unsafe retry.",
    ],
    "deployment-change": [
      "Service versions can preserve compatible worker code.",
    ],
    "transport-equivalence": [
      "All clients can call one network API.",
      "CLI/MCP lose the required in-process path and require service availability.",
    ],
    "orchestrator-replacement": [
      "Service-owned ports can isolate the queue implementation.",
    ],
  },
  "runtime-kernel": {
    "browser-disappears": [
      "Cockpit received Durable Acceptance before the tab closed.",
      "Postgres Run snapshot and outbox intent remain authoritative.",
      "Durable adapter continues driving the Run by ID.",
    ],
    "dispatch-crash": [
      "Acceptance transaction commits Run, initial Event, receipt, and outbox.",
      "A relay claims the unconsumed outbox record after restart.",
      "The same Run ID is dispatched once logically; duplicate relay delivery is safe.",
    ],
    "provider-outcome-unknown": [
      "Worker claims one runtime Attempt and stable Effect Key.",
      "Provider response loss records outcome_unknown instead of throwing for blind retry.",
      "Run blocks until a reconciliation capability resolves the effect.",
    ],
    "deployment-change": [
      "Run stays bound to immutable Workflow version and operation versions.",
      "Orchestrator deployment pinning is useful but not the public compatibility model.",
      "Runtime worker rejects an unavailable operation version explicitly.",
    ],
    "transport-equivalence": [
      "Each adapter resolves Security Context, then calls the same composition root.",
      "Dispatcher runs the same capability handler and transaction.",
      "Canonical Result or Error is mapped back without domain behavior in transport.",
    ],
    "orchestrator-replacement": [
      "Postgres snapshots, Attempts, Events, and Artifacts remain unchanged.",
      "Only the Durable Orchestrator port and deployment adapter change.",
    ],
  },
};

function invariantReason(
  architecture: ArchitectureShape,
  invariant: Invariant,
): string {
  const reasons: Record<Invariant, string> = {
    "authoritative-domain-snapshot":
      "Canonical Run state is an application-owned snapshot.",
    "durable-acceptance":
      "Acceptance survives process loss and can recover dispatch.",
    "transport-parity":
      "Every entrypoint reaches one application handler.",
    "domain-owned-retries":
      "Runtime Attempt and retry policy remain product semantics.",
    "fenced-provider-effects":
      "External effects retain a stable Effect Key and unknown-outcome path.",
    "in-process-callable":
      "Next.js, CLI, and stdio MCP can invoke the same module directly.",
    "replaceable-orchestrator":
      "Changing durable infrastructure does not change public domain contracts.",
  };
  return architecture.passes.includes(invariant)
    ? reasons[invariant]
    : `Missing: ${reasons[invariant]}`;
}

export function evaluateScenario(
  architecture: ArchitectureShape,
  scenario: FailureScenario,
): ScenarioEvaluation {
  const invariantResults = INVARIANTS.map((invariant) => ({
    invariant,
    passed: architecture.passes.includes(invariant),
    reason: invariantReason(architecture, invariant),
  }));
  const passCount = invariantResults.filter((result) => result.passed).length;
  return {
    architecture,
    scenario,
    trace: scenarioTraces[architecture.id][scenario.id],
    invariantResults,
    verdict:
      passCount === INVARIANTS.length
        ? "survives"
        : passCount >= INVARIANTS.length - 1
          ? "survives-with-caveat"
          : "fails",
  };
}

export function comparisonMatrix() {
  return ARCHITECTURES.map((architecture) => ({
    id: architecture.id,
    name: architecture.name,
    invariantPasses: architecture.passes.length,
    invariantTotal: INVARIANTS.length,
    scenarios: SCENARIOS.map((scenario) => ({
      id: scenario.id,
      verdict: evaluateScenario(architecture, scenario).verdict,
    })),
    knownCosts: architecture.knownCosts,
  }));
}

export function validateModel(): string[] {
  const errors: string[] = [];
  for (const architecture of ARCHITECTURES) {
    for (const scenario of SCENARIOS) {
      const evaluation = evaluateScenario(architecture, scenario);
      if (evaluation.trace.length === 0) {
        errors.push(`${architecture.id}/${scenario.id}: missing trace`);
      }
      if (evaluation.invariantResults.length !== INVARIANTS.length) {
        errors.push(`${architecture.id}/${scenario.id}: incomplete invariants`);
      }
    }
  }
  const kernel = ARCHITECTURES.find(
    (architecture) => architecture.id === "runtime-kernel",
  );
  if (!kernel || kernel.passes.length !== INVARIANTS.length) {
    errors.push("runtime-kernel must demonstrate every agreed invariant");
  }
  if (
    AGREED_RUNTIME_BOUNDARY.executableEntrypoints.join(",") !==
    "capabilities,workers"
  ) {
    errors.push("runtime-kernel must expose only capabilities and workers");
  }
  if (
    !AGREED_RUNTIME_BOUNDARY.acceptanceTransaction.includes(
      "execution-outbox-intent",
    )
  ) {
    errors.push("durable acceptance must include transactional execution intent");
  }
  if (
    !AGREED_RUNTIME_BOUNDARY.providerOutcomes.includes("outcome_unknown")
  ) {
    errors.push("provider boundary must preserve unknown outcomes");
  }
  return errors;
}
