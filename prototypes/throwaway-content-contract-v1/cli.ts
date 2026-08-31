/**
 * THROWAWAY PROTOTYPE.
 *
 * Disposable terminal shell for the issue 140 contract/state model.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ArtifactV1Schema,
  PROTOTYPE_OPERATION_REGISTRY,
  WorkflowRunEventV1Schema,
  persistWorkflowVersion,
  validateWorkflow,
} from "./contracts";
import {
  createPrototypeState,
  pageRunEvents,
  reducePrototype,
  validateAtomicTransition,
  type PrototypeAction,
  type PrototypeState,
} from "./machine";

const bold = "\u001b[1m";
const dim = "\u001b[2m";
const reset = "\u001b[0m";

const workflowPath = fileURLToPath(
  new URL("./example-workflow.json", import.meta.url),
);
const candidate: unknown = JSON.parse(readFileSync(workflowPath, "utf8"));
const importedArtifactPath = fileURLToPath(
  new URL("./imported-artifact.json", import.meta.url),
);
const importedArtifact = ArtifactV1Schema.parse(
  JSON.parse(readFileSync(importedArtifactPath, "utf8")),
);
const validation = validateWorkflow(
  candidate,
  PROTOTYPE_OPERATION_REGISTRY,
);

if (!validation.ok || !validation.workflow) {
  console.error("Workflow is invalid:");
  for (const error of validation.errors) console.error(`- ${error}`);
  process.exit(1);
}

const persistedWorkflow = persistWorkflowVersion(validation.workflow);
const prototypeCredentialProfile = {
  profileRef: "credential-profile:local-default",
  profileVersion: 3,
  slots: {
    "generation-provider": {
      capability: "google.generative-ai",
      credentialRef: "credential:google-primary",
      credentialVersion: 7,
    },
  },
};

function initialState(): PrototypeState {
  return createPrototypeState(persistedWorkflow, validation.order, {
    brief:
      "Launch Node Banana as a content-as-code runtime for agent-native operators.",
    referenceImage: {
      artifactId: importedArtifact.id,
    },
  }, prototypeCredentialProfile, [importedArtifact]);
}

function publicState(state: PrototypeState) {
  return {
    lastAction: state.lastAction,
    revision: state.revision,
    workflow: {
      id: state.workflow.id,
      version: state.workflow.version,
      digest: state.workflow.digest,
      authoredSchema: state.workflow.definition.schema,
      persistedSchema: state.workflow.schema,
      order: state.order,
    },
    run: state.run,
    previousRuns: state.previousRuns,
    artifacts: state.artifacts,
    events: state.events,
  };
}

function render(state: PrototypeState): void {
  console.clear();
  console.log(`${bold}THROWAWAY — Content Workflow v1 state model${reset}`);
  console.log(
    `${dim}Question: do these contracts and transitions feel right?${reset}\n`,
  );
  console.log(
    `${bold}Workflow${reset}  ${state.workflow.id}@${state.workflow.version}  ${dim}${state.workflow.digest}${reset}`,
  );
  console.log(
    `${bold}Run${reset}       ${state.run.id}  state=${state.run.state}  revision=${state.run.revision}  event=${state.run.lastEventSequence}`,
  );
  console.log(
    `${bold}Inputs${reset}    ${JSON.stringify(state.run.resolvedInputs)}`,
  );
  console.log(
    `${bold}Credentials${reset} ${JSON.stringify(state.run.resolvedCredentialSlots)}`,
  );
  console.log(
    `${bold}Waiting${reset}   ${state.run.waiting ? JSON.stringify(state.run.waiting) : "—"}`,
  );
  console.log(
    `${bold}Outputs${reset}   ${JSON.stringify(state.run.outputArtifactIds)}`,
  );
  console.log(
    `${bold}Derived${reset}   ${state.run.derivedFrom ? JSON.stringify(state.run.derivedFrom) : "—"}`,
  );
  console.log(
    `${bold}Failure${reset}   ${state.run.failure ? JSON.stringify(state.run.failure) : "—"}`,
  );
  console.log(
    `${bold}Prior runs${reset} ${state.previousRuns.map((run) => `${run.id}:${run.state}@r${run.revision}`).join(", ") || "—"}`,
  );
  console.log(`\n${bold}Steps${reset}`);
  for (const stepId of state.order) {
    const step = state.run.steps[stepId];
    const attempts = step.attempts
      .map(
        (attempt) =>
          `${attempt.number}:${attempt.state}${attempt.retryAfterMs === undefined ? "" : `→${attempt.retryAfterMs}ms`}`,
      )
      .join(", ");
    console.log(
      `  ${stepId.padEnd(18)} ${step.state.padEnd(9)} attempts=[${attempts}] outputs=${JSON.stringify(step.outputArtifactIds)}`,
    );
    if (step.reusedFrom) {
      console.log(`    reused=${JSON.stringify(step.reusedFrom)}`);
    }
  }

  console.log(`\n${bold}Artifacts${reset}`);
  if (state.artifacts.length === 0) console.log("  —");
  for (const artifact of state.artifacts) {
    const origin =
      artifact.origin.type === "workflow-step"
        ? `${artifact.origin.runId}/${artifact.origin.stepId}#${artifact.origin.attempt}.${artifact.origin.outputPort}`
        : `imported by ${artifact.origin.importedBy.ref}`;
    console.log(
      `  ${artifact.id}  ${artifact.kind}/${artifact.mediaType}  origin=${origin}`,
    );
    console.log(
      `    parents=${JSON.stringify(artifact.lineage.parentArtifactIds)} storage=${JSON.stringify(artifact.storage)}`,
    );
  }

  console.log(`\n${bold}Events${reset}`);
  for (const event of state.events.slice(-6)) {
    const subject = event.refs.stepId
      ? ` ${event.refs.stepId}${event.refs.attempt ? `#${event.refs.attempt}` : ""}`
      : "";
    console.log(
      `  ${event.runId.slice(-3)}:${String(event.sequence).padStart(2, "0")} ${event.type}${subject}${event.payload.backoffMs === undefined ? "" : ` ${event.payload.backoffMs}ms`}${event.refs.artifactId ? ` ${event.refs.artifactId}` : ""}`,
    );
  }
  console.log(
    `\n${bold}[s]${reset} ${dim}start${reset}  ` +
      `${bold}[n]${reset} ${dim}complete current step${reset}  ` +
      `${bold}[t]${reset} ${dim}transient failure / auto-retry${reset}  ` +
      `${bold}[e]${reset} ${dim}terminal failure${reset}  ` +
      `${bold}[d]${reset} ${dim}derive manual-retry run${reset}  ` +
      `${bold}[c]${reset} ${dim}cancel${reset}  ` +
      `${bold}[0]${reset} ${dim}reset${reset}  ` +
      `${bold}[q]${reset} ${dim}quit${reset}`,
  );
}

function runValidation(): void {
  const missingConfig = structuredClone(validation.workflow!);
  delete missingConfig.steps[0].config.model;
  const unknownConfig = structuredClone(validation.workflow!);
  unknownConfig.steps[0].config.unexpected = true;
  const missingCredential = structuredClone(validation.workflow!);
  delete missingCredential.steps[0].credentials.provider;
  const secretLikeConfig = structuredClone(validation.workflow!);
  secretLikeConfig.steps[0].config.apiKey = "PROTOTYPE_FORBIDDEN";
  const fakeRunImport = {
    ...structuredClone(importedArtifact),
    runId: "run_fake_forbidden",
  };
  const captureRunInputError = (
    referenceArtifactId: string,
    artifacts: Array<typeof importedArtifact>,
  ) => {
    try {
      createPrototypeState(
        persistedWorkflow,
        validation.order,
        {
          brief: "Run input validation probe",
          referenceImage: { artifactId: referenceArtifactId },
        },
        prototypeCredentialProfile,
        artifacts,
      );
      return "unexpected success";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const crossWorkspaceArtifact = structuredClone(importedArtifact);
  crossWorkspaceArtifact.workspaceId = "workspace_other";
  const wrongKindArtifact = structuredClone(importedArtifact);
  wrongKindArtifact.kind = "audio";
  wrongKindArtifact.mediaType = "audio/mpeg";
  let missingProfileSlot = "unexpected success";
  try {
    createPrototypeState(
      persistedWorkflow,
      validation.order,
      {
        brief: "Credential resolution probe",
        referenceImage: { artifactId: importedArtifact.id },
      },
      {
        profileRef: "credential-profile:incomplete",
        profileVersion: 1,
        slots: {},
      },
      [importedArtifact],
    );
  } catch (error) {
    missingProfileSlot =
      error instanceof Error ? error.message : String(error);
  }
  let lineageState = initialState();
  const atomicTransitionProbes: Array<{
    action: string;
    errors: string[];
  }> = [];
  for (const action of [
    { type: "start" },
    { type: "complete-step" },
    { type: "complete-step" },
  ] satisfies PrototypeAction[]) {
    const previous = lineageState;
    lineageState = reducePrototype(
      lineageState,
      action,
      PROTOTYPE_OPERATION_REGISTRY,
    );
    atomicTransitionProbes.push({
      action: action.type,
      errors: validateAtomicTransition(previous, lineageState),
    });
  }
  const generatedHero = lineageState.artifacts.find(
    (artifact) =>
      artifact.id === lineageState.run.outputArtifactIds.heroImage,
  );
  const firstPage = pageRunEvents(
    lineageState.events,
    lineageState.run.id,
    0,
    3,
  );
  const secondPage = pageRunEvents(
    lineageState.events,
    lineageState.run.id,
    firstPage.nextAfterSequence,
    3,
  );
  const replayedFirstPage = pageRunEvents(
    lineageState.events,
    lineageState.run.id,
    0,
    3,
  );
  const dedupedKeys = new Set(
    [...firstPage.events, ...replayedFirstPage.events].map(
      (event) => `${event.runId}:${event.sequence}`,
    ),
  );
  const minimalEvent = {
    schema: "workflow-run-event/v1",
    runId: "run_redaction_probe",
    sequence: 1,
    type: "step.failed",
    at: "2026-07-24T12:00:00Z",
    refs: {
      stepId: "generate-hero",
      attempt: 1,
    },
    payload: {
      reasonCode: "SAFE_ERROR",
      error: {
        code: "PROVIDER_TIMEOUT",
        safeMessage: "Provider request timed out",
        classification: "transient",
        retryable: true,
      },
    },
  } as const;
  const forbiddenEventFields = Object.fromEntries(
    ["rawProviderResponse", "apiKey", "content"].map((field) => [
      field,
      WorkflowRunEventV1Schema.safeParse({
        ...minimalEvent,
        payload: {
          ...minimalEvent.payload,
          [field]: "PROTOTYPE_FORBIDDEN",
        },
      }).success,
    ]),
  );

  console.log(
    JSON.stringify(
      {
        valid: validation.ok,
        schema: validation.workflow?.schema,
        authoredWorkflow: validation.workflow
          ? {
              id: validation.workflow.id,
              version: validation.workflow.version,
              hasDigest: "digest" in validation.workflow,
            }
          : undefined,
        persistedVersion: {
          schema: persistedWorkflow.schema,
          id: persistedWorkflow.id,
          version: persistedWorkflow.version,
          digest: persistedWorkflow.digest,
        },
        topologicalOrder: validation.order,
        errors: validation.errors,
        rejectionProbes: {
          missingConfig: validateWorkflow(
            missingConfig,
            PROTOTYPE_OPERATION_REGISTRY,
          ).errors,
          unknownConfig: validateWorkflow(
            unknownConfig,
            PROTOTYPE_OPERATION_REGISTRY,
          ).errors,
          missingCredentialBinding: validateWorkflow(
            missingCredential,
            PROTOTYPE_OPERATION_REGISTRY,
          ).errors,
          secretLikeField: validateWorkflow(
            secretLikeConfig,
            PROTOTYPE_OPERATION_REGISTRY,
          ).errors,
        },
        resolvedCredentialAuditSnapshot:
          initialState().run.resolvedCredentialSlots,
        importedArtifact: {
          valid: ArtifactV1Schema.safeParse(importedArtifact).success,
          origin: importedArtifact.origin,
          hasTopLevelRunId: "runId" in importedArtifact,
          workflowInput: initialState().run.resolvedInputs.referenceImage,
        },
        importedArtifactFakeRunFieldsAccepted: ArtifactV1Schema.safeParse(
          fakeRunImport,
        ).success,
        importedArtifactLineageProof: generatedHero
          ? {
              artifactId: generatedHero.id,
              origin: generatedHero.origin,
              parentArtifactIds: generatedHero.lineage.parentArtifactIds,
              includesImportedReference:
                generatedHero.lineage.parentArtifactIds.includes(
                  importedArtifact.id,
                ),
            }
          : "missing generated hero",
        runInputRejectionProbes: {
          missingArtifact: captureRunInputError(
            "art_missing_reference",
            [],
          ),
          crossWorkspaceArtifact: captureRunInputError(
            crossWorkspaceArtifact.id,
            [crossWorkspaceArtifact],
          ),
          kindMismatch: captureRunInputError(
            wrongKindArtifact.id,
            [wrongKindArtifact],
          ),
        },
        eventContractProof: {
          minimalEventAccepted:
            WorkflowRunEventV1Schema.safeParse(minimalEvent).success,
          forbiddenPayloadFieldsAccepted: forbiddenEventFields,
          atomicTransitionInvariant: atomicTransitionProbes,
          paging: {
            firstPage: {
              afterSequence: 0,
              sequences: firstPage.events.map((event) => event.sequence),
              nextAfterSequence: firstPage.nextAfterSequence,
              hasMore: firstPage.hasMore,
            },
            secondPage: {
              afterSequence: firstPage.nextAfterSequence,
              sequences: secondPage.events.map((event) => event.sequence),
              nextAfterSequence: secondPage.nextAfterSequence,
              hasMore: secondPage.hasMore,
            },
            dedupeKeysFromReplayedFirstPage: [...dedupedKeys],
          },
        },
        credentialResolutionProbe: {
          missingProfileSlot,
        },
      },
      null,
      2,
    ),
  );
}

function runDemo(): void {
  let state = initialState();
  const timeline: unknown[] = [];
  const capture = () => {
    timeline.push({
      action: state.lastAction,
      runId: state.run.id,
      runState: state.run.state,
      derivedFrom: state.run.derivedFrom,
      failure: state.run.failure,
      steps: Object.fromEntries(
        Object.entries(state.run.steps).map(([stepId, step]) => [
          stepId,
          {
            state: step.state,
            attempts: step.attempts.map((attempt) => ({
              number: attempt.number,
              state: attempt.state,
              error: attempt.error,
              retryAfterMs: attempt.retryAfterMs,
            })),
            outputArtifactIds: step.outputArtifactIds,
            reusedFrom: step.reusedFrom,
          },
        ]),
      ),
    });
  };
  capture();
  const actions: PrototypeAction[] = [
    { type: "start" },
    { type: "complete-step" },
    {
      type: "fail-step",
      error: {
        code: "PROVIDER_TIMEOUT",
        safeMessage: "Provider timed out",
        classification: "transient",
        retryable: true,
      },
    },
    {
      type: "fail-step",
      error: {
        code: "PROVIDER_TIMEOUT",
        safeMessage: "Provider timed out again",
        classification: "transient",
        retryable: true,
      },
    },
    { type: "manual-retry-derived-run" },
    { type: "start" },
    { type: "complete-step" },
  ];

  for (const action of actions) {
    state = reducePrototype(state, action, PROTOTYPE_OPERATION_REGISTRY);
    capture();
  }

  let terminalState = initialState();
  for (const action of [
    { type: "start" },
    { type: "complete-step" },
    {
      type: "fail-step",
      error: {
        code: "PROMPT_REJECTED",
        safeMessage: "Provider rejected the prompt",
        classification: "terminal",
        retryable: false,
      },
    },
  ] satisfies PrototypeAction[]) {
    terminalState = reducePrototype(
      terminalState,
      action,
      PROTOTYPE_OPERATION_REGISTRY,
    );
  }

  console.log(
    JSON.stringify(
      {
        automaticRetryThenDerivedRun: {
          timeline,
          result: {
            activeRun: state.run,
            preservedOriginalRun: state.previousRuns[0],
            artifacts: state.artifacts,
            events: state.events,
          },
        },
        nonRetryableFailure: {
          run: terminalState.run,
          events: terminalState.events,
        },
      },
      null,
      2,
    ),
  );
}

if (process.argv.includes("--validate")) {
  runValidation();
  process.exit(0);
}

if (process.argv.includes("--demo")) {
  runDemo();
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error("Interactive mode requires a TTY. Use --demo or --validate.");
  process.exit(1);
}

let state = initialState();
render(state);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key: string) => {
  if (key === "q" || key === "\u0003") {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    return;
  }

  const actions: Record<string, PrototypeAction> = {
    s: { type: "start" },
    n: { type: "complete-step" },
    t: {
      type: "fail-step",
      error: {
        code: "PROVIDER_TIMEOUT",
        safeMessage: "Provider timed out",
        classification: "transient",
        retryable: true,
      },
    },
    e: {
      type: "fail-step",
      error: {
        code: "PROMPT_REJECTED",
        safeMessage: "Provider rejected the prompt",
        classification: "terminal",
        retryable: false,
      },
    },
    d: { type: "manual-retry-derived-run" },
    c: { type: "cancel" },
  };

  if (key === "0") {
    state = initialState();
  } else if (actions[key]) {
    state = reducePrototype(
      state,
      actions[key],
      PROTOTYPE_OPERATION_REGISTRY,
    );
  }

  render(state);
});
