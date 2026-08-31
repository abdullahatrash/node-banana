/**
 * THROWAWAY PROTOTYPE.
 *
 * Pure state transitions for automatic attempts and derived manual-retry Runs.
 * The surrounding CLI owns terminal I/O; this module only accepts state and
 * actions.
 */

import {
  type ArtifactV1,
  type ContentKind,
  type ContentWorkflowVersionV1,
  type OperationRegistry,
  type WorkflowRunEventV1,
  type WorkflowRunV1,
  ArtifactV1Schema,
  WorkflowRunEventV1Schema,
  WorkflowRunV1Schema,
} from "./contracts";
import { createHash } from "node:crypto";

export type RunError =
  | {
      code: string;
      safeMessage: string;
      classification: "transient";
      retryable: true;
    }
  | {
      code: string;
      safeMessage: string;
      classification: "terminal";
      retryable: false;
    };

export interface PrototypeCredentialProfile {
  profileRef: string;
  profileVersion: number;
  slots: Record<
    string,
    {
      capability: string;
      credentialRef: string;
      credentialVersion: number;
    }
  >;
}

export interface PrototypeState {
  workflow: ContentWorkflowVersionV1;
  order: string[];
  run: WorkflowRunV1;
  previousRuns: WorkflowRunV1[];
  artifacts: ArtifactV1[];
  events: WorkflowRunEventV1[];
  revision: number;
  lastAction: string;
}

export type PrototypeAction =
  | { type: "start" }
  | { type: "complete-step" }
  | { type: "fail-step"; error: RunError }
  | { type: "manual-retry-derived-run" }
  | { type: "cancel" };

function timestamp(revision: number): string {
  return `2026-07-24T12:00:${String(revision).padStart(2, "0")}Z`;
}

function appendEvent(
  state: PrototypeState,
  event: {
    type: WorkflowRunEventV1["type"];
    refs?: WorkflowRunEventV1["refs"];
    payload?: WorkflowRunEventV1["payload"];
  },
): void {
  const next = WorkflowRunEventV1Schema.parse({
    schema: "workflow-run-event/v1",
    runId: state.run.id,
    sequence:
      state.events.filter((candidate) => candidate.runId === state.run.id)
        .length + 1,
    at: timestamp(state.revision),
    ...event,
  });
  state.events.push(next);
  state.run.lastEventSequence = next.sequence;
}

function currentStepId(state: PrototypeState): string | undefined {
  return state.order.find(
    (stepId) => state.run.steps[stepId]?.state === "running",
  );
}

function parentArtifactIds(
  workflow: ContentWorkflowVersionV1,
  stepId: string,
  run: WorkflowRunV1,
): string[] {
  const step = workflow.definition.steps.find(
    (candidate) => candidate.id === stepId,
  );
  if (!step) return [];

  return Object.values(step.inputs).flatMap((binding) => {
    if (binding.from === "workflow-input") {
      const resolved = run.resolvedInputs[binding.input];
      if (
        resolved &&
        typeof resolved === "object" &&
        "artifactId" in resolved &&
        typeof resolved.artifactId === "string"
      ) {
        return [resolved.artifactId];
      }
      return [];
    }
    const artifactId =
      run.steps[binding.step]?.outputArtifactIds[binding.output];
    return artifactId ? [artifactId] : [];
  });
}

function readyStepId(state: PrototypeState): string | undefined {
  return state.order.find((stepId) => {
    if (state.run.steps[stepId]?.state !== "pending") return false;
    const step = state.workflow.definition.steps.find(
      (candidate) => candidate.id === stepId,
    );
    if (!step) return false;

    return Object.values(step.inputs).every((binding) => {
      if (binding.from === "workflow-input") return true;
      const dependencyState = state.run.steps[binding.step]?.state;
      return dependencyState === "succeeded" || dependencyState === "reused";
    });
  });
}

function makeArtifact(
  state: PrototypeState,
  stepId: string,
  attempt: number,
  port: string,
  kind: ContentKind,
): ArtifactV1 {
  const suffix = `${state.run.id}-${state.run.revision}-${stepId}-${port}`;
  const contentHash = createHash("sha256")
    .update(`prototype-artifact:${suffix}`)
    .digest("hex");
  const mediaType: Record<ContentKind, string> = {
    text: "text/plain",
    image: "image/png",
    audio: "audio/mpeg",
    video: "video/mp4",
    json: "application/json",
  };
  const operation = state.workflow.definition.steps.find(
    (step) => step.id === stepId,
  )?.uses;

  return ArtifactV1Schema.parse({
    schema: "artifact/v1",
    id: `art_${suffix}`,
    workspaceId: state.run.workspaceId,
    kind,
    mediaType: mediaType[kind],
    storage:
      kind === "text" || kind === "json"
        ? {
            type: "inline",
            value:
              kind === "text"
                ? `Prototype ${port} from ${stepId}`
                : { prototype: true, stepId, port },
          }
        : {
            type: "asset",
            assetId: `asset_${suffix}`,
          },
    contentHash: `sha256:${contentHash}`,
    origin: {
      type: "workflow-step",
      runId: state.run.id,
      stepId,
      attempt,
      outputPort: port,
      operation: operation ?? "unknown/v1",
    },
    lineage: {
      parentArtifactIds: parentArtifactIds(
        state.workflow,
        stepId,
        state.run,
      ),
    },
    createdAt: timestamp(state.revision),
  });
}

function runningAttempt(run: WorkflowRunV1, stepId: string) {
  return run.steps[stepId]?.attempts.findLast(
    (attempt) => attempt.state === "running",
  );
}

function backoffMs(
  attempt: number,
  retry: ContentWorkflowVersionV1["definition"]["steps"][number]["retry"],
): number {
  return Math.min(
    retry.backoff.maxMs,
    Math.round(
      retry.backoff.initialMs *
        retry.backoff.multiplier ** Math.max(0, attempt - 1),
    ),
  );
}

function assertState(state: PrototypeState): PrototypeState {
  WorkflowRunV1Schema.parse(state.run);
  for (const run of state.previousRuns) WorkflowRunV1Schema.parse(run);
  for (const artifact of state.artifacts) ArtifactV1Schema.parse(artifact);
  for (const event of state.events) WorkflowRunEventV1Schema.parse(event);
  return state;
}

export function pageRunEvents(
  events: WorkflowRunEventV1[],
  runId: string,
  afterSequence = 0,
  limit = 50,
) {
  const remaining = events
    .filter(
      (event) => event.runId === runId && event.sequence > afterSequence,
    )
    .sort((left, right) => left.sequence - right.sequence);
  const page = remaining.slice(0, limit);
  return {
    events: page,
    nextAfterSequence:
      page.at(-1)?.sequence ?? afterSequence,
    hasMore: remaining.length > page.length,
  };
}

export function validateAtomicTransition(
  previous: PrototypeState,
  next: PrototypeState,
): string[] {
  if (previous === next) return [];

  const errors: string[] = [];
  const appendedEvents = next.events.slice(previous.events.length);
  if (JSON.stringify(previous.run) === JSON.stringify(next.run)) {
    errors.push("accepted transition did not update the Run snapshot");
  }
  if (appendedEvents.length === 0) {
    errors.push("accepted transition did not append a Run Event");
  }

  const eventKeys = new Set<string>();
  const sequencesByRun = new Map<string, number[]>();
  for (const event of next.events) {
    const key = `${event.runId}:${event.sequence}`;
    if (eventKeys.has(key)) errors.push(`duplicate event key ${key}`);
    eventKeys.add(key);
    const sequences = sequencesByRun.get(event.runId) ?? [];
    sequences.push(event.sequence);
    sequencesByRun.set(event.runId, sequences);
  }
  for (const [runId, sequences] of sequencesByRun) {
    const ordered = [...sequences].sort((left, right) => left - right);
    ordered.forEach((sequence, index) => {
      if (sequence !== index + 1) {
        errors.push(`event sequence gap for ${runId}`);
      }
    });
  }

  const currentEvents = next.events.filter(
    (event) => event.runId === next.run.id,
  );
  const lastSequence = currentEvents.at(-1)?.sequence;
  if (lastSequence !== next.run.lastEventSequence) {
    errors.push("Run snapshot event cursor does not match appended events");
  }

  if (previous.run.id === next.run.id) {
    if (next.run.revision !== previous.run.revision + 1) {
      errors.push("Run snapshot revision did not advance exactly once");
    }
    if (appendedEvents.some((event) => event.runId !== next.run.id)) {
      errors.push("transition appended an event for a different Run");
    }
  } else {
    if (next.run.derivedFrom?.runId !== previous.run.id) {
      errors.push("new Run is missing its derivation reference");
    }
    const preserved = next.previousRuns.find(
      (run) => run.id === previous.run.id,
    );
    if (JSON.stringify(preserved) !== JSON.stringify(previous.run)) {
      errors.push("derived transition mutated the original Run snapshot");
    }
    if (
      appendedEvents.some(
        (event, index) =>
          event.runId !== next.run.id || event.sequence !== index + 1,
      )
    ) {
      errors.push("derived Run event sequence did not start at one");
    }
  }

  return errors;
}

function acceptTransition(
  previous: PrototypeState,
  next: PrototypeState,
): PrototypeState {
  assertState(next);
  const errors = validateAtomicTransition(previous, next);
  if (errors.length > 0) {
    throw new Error(`Atomic transition invariant failed: ${errors.join("; ")}`);
  }
  return next;
}

function emptySteps(workflow: ContentWorkflowVersionV1) {
  return Object.fromEntries(
    workflow.definition.steps.map((step) => [
      step.id,
      {
        state: "pending" as const,
        attempts: [],
        outputArtifactIds: {},
      },
    ]),
  );
}

function resolveRunInputs(
  workflow: ContentWorkflowVersionV1,
  candidate: Record<string, unknown>,
  workspaceId: string,
  artifacts: ArtifactV1[],
): Record<string, unknown> {
  const artifactById = new Map(
    artifacts.map((artifact) => [
      artifact.id,
      ArtifactV1Schema.parse(artifact),
    ]),
  );
  const resolved: Record<string, unknown> = {};

  for (const [inputName, definition] of Object.entries(
    workflow.definition.inputs,
  )) {
    const value = candidate[inputName];
    if (value === undefined) {
      if (definition.required) {
        throw new Error(`Missing required workflow input ${inputName}`);
      }
      continue;
    }

    if (definition.type === "text") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Workflow input ${inputName} must be inline text`);
      }
      resolved[inputName] = value;
      continue;
    }

    if (
      !value ||
      typeof value !== "object" ||
      !("artifactId" in value) ||
      typeof value.artifactId !== "string"
    ) {
      throw new Error(
        `Workflow input ${inputName} must be an Artifact reference`,
      );
    }

    const artifact = artifactById.get(value.artifactId);
    if (!artifact) {
      throw new Error(
        `Workflow input ${inputName} references missing Artifact ${value.artifactId}`,
      );
    }
    if (artifact.workspaceId !== workspaceId) {
      throw new Error(
        `Workflow input ${inputName} Artifact ${artifact.id} belongs to workspace ${artifact.workspaceId}, not ${workspaceId}`,
      );
    }
    if (artifact.kind !== definition.type) {
      throw new Error(
        `Workflow input ${inputName} requires ${definition.type}, but Artifact ${artifact.id} is ${artifact.kind}`,
      );
    }

    resolved[inputName] = { artifactId: artifact.id };
  }

  return resolved;
}

function resolveCredentialSlots(
  workflow: ContentWorkflowVersionV1,
  profile: PrototypeCredentialProfile,
) {
  return Object.fromEntries(
    Object.entries(workflow.definition.credentialSlots).map(
      ([slotName, requirement]) => {
        const resolved = profile.slots[slotName];
        if (!resolved) {
          throw new Error(
            `Credential profile ${profile.profileRef} does not resolve slot ${slotName}`,
          );
        }
        if (resolved.capability !== requirement.capability) {
          throw new Error(
            `Credential ${resolved.credentialRef} cannot satisfy ${requirement.capability}`,
          );
        }

        return [
          slotName,
          {
            capability: requirement.capability,
            profileRef: profile.profileRef,
            profileVersion: profile.profileVersion,
            credentialRef: resolved.credentialRef,
            credentialVersion: resolved.credentialVersion,
          },
        ];
      },
    ),
  );
}

export function createPrototypeState(
  workflow: ContentWorkflowVersionV1,
  order: string[],
  resolvedInputs: Record<string, unknown>,
  credentialProfile: PrototypeCredentialProfile,
  seedArtifacts: ArtifactV1[] = [],
): PrototypeState {
  const createdAt = timestamp(0);
  const workspaceId = "workspace_local";
  const parsedSeedArtifacts = seedArtifacts.map((artifact) =>
    ArtifactV1Schema.parse(artifact),
  );
  const state: PrototypeState = {
    workflow,
    order,
    run: {
      schema: "workflow-run/v1",
      id: "run_prototype_001",
      workspaceId,
      workflow: {
        id: workflow.id,
        version: workflow.version,
        digest: workflow.digest,
      },
      state: "queued",
      revision: 0,
      lastEventSequence: 1,
      resolvedInputs: resolveRunInputs(
        workflow,
        resolvedInputs,
        workspaceId,
        parsedSeedArtifacts,
      ),
      resolvedCredentialSlots: resolveCredentialSlots(
        workflow,
        credentialProfile,
      ),
      steps: emptySteps(workflow),
      outputArtifactIds: {},
      createdAt,
      updatedAt: createdAt,
    },
    previousRuns: [],
    artifacts: parsedSeedArtifacts,
    events: [
      {
        schema: "workflow-run-event/v1",
        runId: "run_prototype_001",
        sequence: 1,
        type: "run.created",
        at: createdAt,
        refs: {},
        payload: {},
      },
    ],
    revision: 0,
    lastAction: "created",
  };
  return assertState(state);
}

function createDerivedRun(state: PrototypeState): PrototypeState {
  if (state.run.state !== "failed" || !state.run.failure) return state;
  const originalFailure = structuredClone(state.run.failure);

  const next = structuredClone(state);
  next.revision += 1;
  next.lastAction = "manual-retry-derived-run";

  const original = structuredClone(next.run);
  const reusedArtifactIds = Object.values(original.steps).flatMap((step) =>
    step.state === "succeeded" || step.state === "reused"
      ? Object.values(step.outputArtifactIds)
      : [],
  );
  const nextRunNumber = next.previousRuns.length + 2;
  const runId = `run_prototype_${String(nextRunNumber).padStart(3, "0")}`;
  const createdAt = timestamp(next.revision);

  next.previousRuns.push(original);
  next.run = {
    schema: "workflow-run/v1",
    id: runId,
    workspaceId: original.workspaceId,
    workflow: structuredClone(original.workflow),
    state: "queued",
    revision: 0,
    lastEventSequence: 1,
    resolvedInputs: structuredClone(original.resolvedInputs),
    resolvedCredentialSlots: structuredClone(
      original.resolvedCredentialSlots,
    ),
    steps: Object.fromEntries(
      Object.entries(original.steps).map(([stepId, step]) => {
        if (step.state !== "succeeded" && step.state !== "reused") {
          return [
            stepId,
            {
              state: "pending" as const,
              attempts: [],
              outputArtifactIds: {},
            },
          ];
        }

        const artifactIds = Object.values(step.outputArtifactIds);
        return [
          stepId,
          {
            state: "reused" as const,
            attempts: [],
            outputArtifactIds: structuredClone(step.outputArtifactIds),
            reusedFrom: {
              runId: original.id,
              artifactIds,
            },
          },
        ];
      }),
    ),
    outputArtifactIds: {},
    derivedFrom: {
      runId: original.id,
      retryFromStepId: originalFailure.stepId,
      reusedArtifactIds,
    },
    createdAt,
    updatedAt: createdAt,
  };
  appendEvent(next, {
    type: "run.derived",
    refs: {
      stepId: originalFailure.stepId,
      relatedRunId: original.id,
    },
    payload: {
      reasonCode: "MANUAL_RETRY",
    },
  });
  return acceptTransition(state, next);
}

export function reducePrototype(
  state: PrototypeState,
  action: PrototypeAction,
  registry: OperationRegistry,
): PrototypeState {
  if (action.type === "manual-retry-derived-run") {
    return createDerivedRun(state);
  }

  const next = structuredClone(state);
  next.revision += 1;
  next.lastAction = action.type;
  next.run.revision += 1;
  next.run.updatedAt = timestamp(next.revision);

  if (action.type === "start") {
    if (next.run.state !== "queued") return state;
    const first = readyStepId(next);
    if (!first) throw new Error("No executable first step");
    next.run.state = "running";
    next.run.steps[first].state = "running";
    next.run.steps[first].attempts.push({
      number: 1,
      state: "running",
      startedAt: next.run.updatedAt,
    });
    appendEvent(next, { type: "run.started" });
    appendEvent(next, {
      type: "step.started",
      refs: { stepId: first, attempt: 1 },
    });
    return acceptTransition(state, next);
  }

  if (action.type === "complete-step") {
    if (next.run.state !== "running") return state;
    const stepId = currentStepId(next);
    if (!stepId) return state;
    const step = next.workflow.definition.steps.find(
      (candidate) => candidate.id === stepId,
    );
    const attempt = runningAttempt(next.run, stepId);
    if (!step || !attempt) return state;

    attempt.state = "succeeded";
    attempt.finishedAt = next.run.updatedAt;
    next.run.steps[stepId].state = "succeeded";
    appendEvent(next, {
      type: "step.succeeded",
      refs: { stepId, attempt: attempt.number },
    });

    for (const [port, kind] of Object.entries(
      registry[step.uses]?.outputs ?? {},
    )) {
      const artifact = makeArtifact(next, stepId, attempt.number, port, kind);
      next.artifacts.push(artifact);
      next.run.steps[stepId].outputArtifactIds[port] = artifact.id;
      appendEvent(next, {
        type: "artifact.created",
        refs: {
          stepId,
          attempt: attempt.number,
          artifactId: artifact.id,
        },
      });
    }

    const following = readyStepId(next);
    if (following) {
      next.run.steps[following].state = "running";
      next.run.steps[following].attempts.push({
        number: 1,
        state: "running",
        startedAt: next.run.updatedAt,
      });
      appendEvent(next, {
        type: "step.started",
        refs: { stepId: following, attempt: 1 },
      });
    } else {
      next.run.state = "succeeded";
      next.run.outputArtifactIds = Object.fromEntries(
        Object.entries(next.workflow.definition.outputs).map(
          ([name, binding]) => [
            name,
            next.run.steps[binding.step].outputArtifactIds[binding.output],
          ],
        ),
      );
      appendEvent(next, { type: "run.succeeded" });
    }

    return acceptTransition(state, next);
  }

  if (action.type === "fail-step") {
    if (next.run.state !== "running") return state;
    const stepId = currentStepId(next);
    if (!stepId) return state;
    const attempt = runningAttempt(next.run, stepId);
    const definition = next.workflow.definition.steps.find(
      (candidate) => candidate.id === stepId,
    );
    if (!attempt || !definition) return state;

    attempt.state = "failed";
    attempt.finishedAt = next.run.updatedAt;
    attempt.error = action.error;
    appendEvent(next, {
      type: "step.failed",
      refs: { stepId, attempt: attempt.number },
      payload: { error: action.error },
    });

    const shouldRetry =
      action.error.classification === "transient" &&
      action.error.retryable &&
      attempt.number < definition.retry.maxAttempts;

    if (shouldRetry) {
      const delay = backoffMs(attempt.number, definition.retry);
      attempt.retryAfterMs = delay;
      appendEvent(next, {
        type: "step.retry-scheduled",
        refs: { stepId, attempt: attempt.number },
        payload: {
          reasonCode: "TRANSIENT_FAILURE",
          error: action.error,
          backoffMs: delay,
        },
      });

      const nextAttempt = attempt.number + 1;
      next.run.steps[stepId].state = "running";
      next.run.steps[stepId].attempts.push({
        number: nextAttempt,
        state: "running",
        startedAt: next.run.updatedAt,
      });
      appendEvent(next, {
        type: "step.started",
        refs: { stepId, attempt: nextAttempt },
        payload: { reasonCode: "AUTOMATIC_RETRY" },
      });
    } else {
      next.run.state = "failed";
      next.run.steps[stepId].state = "failed";
      next.run.failure = {
        stepId,
        attempt: attempt.number,
        error: action.error,
      };
      appendEvent(next, {
        type: "run.failed",
        refs: { stepId, attempt: attempt.number },
        payload: {
          error: action.error,
          reasonCode:
            action.error.retryable &&
            attempt.number >= definition.retry.maxAttempts
              ? "ATTEMPTS_EXHAUSTED"
              : "NON_RETRYABLE_FAILURE",
        },
      });
    }

    return acceptTransition(state, next);
  }

  if (action.type === "cancel") {
    if (
      next.run.state === "succeeded" ||
      next.run.state === "failed" ||
      next.run.state === "cancelled"
    ) {
      return state;
    }

    const stepId = currentStepId(next);
    if (stepId) {
      const attempt = runningAttempt(next.run, stepId);
      if (attempt) {
        attempt.state = "cancelled";
        attempt.finishedAt = next.run.updatedAt;
        appendEvent(next, {
          type: "step.cancelled",
          refs: { stepId, attempt: attempt.number },
        });
      }
      next.run.steps[stepId].state = "cancelled";
    }
    next.run.state = "cancelled";
    appendEvent(next, { type: "run.cancelled" });
    return acceptTransition(state, next);
  }

  return state;
}
