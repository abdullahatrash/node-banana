import type {
  ContentWorkflowRecord,
  ContentWorkflowRevisionRecord,
  WorkflowCredentialSlotAdmissionPort,
  WorkflowRevisionMutationReceiptRecord,
  WorkflowRevisionRepository,
} from "./types";

function receiptKey(input: {
  workspaceId: string;
  principalId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return [
    input.workspaceId,
    input.principalId,
    input.capability,
    input.idempotencyKey,
  ].join("\u0000");
}

function workflowKey(workspaceId: string, workflowId: string): string {
  return `${workspaceId}\u0000${workflowId}`;
}

function revisionKey(workspaceId: string, revisionId: string): string {
  return `${workspaceId}\u0000${revisionId}`;
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkflowRevisionRepository
  implements WorkflowRevisionRepository
{
  readonly workflows = new Map<string, ContentWorkflowRecord>();
  readonly revisions = new Map<string, ContentWorkflowRevisionRecord>();
  readonly receipts = new Map<
    string,
    WorkflowRevisionMutationReceiptRecord
  >();
  failNextCommit = false;

  async readReceipt(
    input: Parameters<WorkflowRevisionRepository["readReceipt"]>[0],
  ) {
    const found = this.receipts.get(receiptKey(input));
    if (!found) return { kind: "absent" as const };
    return found.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, resourceId: found.resourceId }
      : { kind: "conflict" as const };
  }

  async createWorkflow(
    input: Parameters<WorkflowRevisionRepository["createWorkflow"]>[0],
  ) {
    const existingReceipt = this.receipts.get(receiptKey(input.receipt));
    if (existingReceipt) {
      if (
        existingReceipt.requestFingerprint !== input.receipt.requestFingerprint
      ) {
        return { kind: "conflict" as const };
      }
      const found = this.workflows.get(
        workflowKey(input.workflow.workspaceId, existingReceipt.resourceId),
      );
      return found
        ? { kind: "replayed" as const, workflow: clone(found) }
        : { kind: "unavailable" as const };
    }
    if (this.failNextCommit) {
      this.failNextCommit = false;
      return { kind: "unavailable" as const };
    }
    const storedWorkflow = immutable(clone(input.workflow));
    const storedReceipt = immutable(clone(input.receipt));
    this.workflows.set(
      workflowKey(input.workflow.workspaceId, input.workflow.id),
      storedWorkflow,
    );
    this.receipts.set(receiptKey(input.receipt), storedReceipt);
    return { kind: "created" as const, workflow: clone(storedWorkflow) };
  }

  async publish(
    input: Parameters<WorkflowRevisionRepository["publish"]>[0],
  ) {
    const existingReceipt = this.receipts.get(receiptKey(input.receipt));
    if (existingReceipt) {
      if (
        existingReceipt.requestFingerprint !== input.receipt.requestFingerprint
      ) {
        return { kind: "conflict" as const };
      }
      const found = this.revisions.get(
        revisionKey(
          input.revision.workspaceId,
          existingReceipt.resourceId,
        ),
      );
      return found
        ? { kind: "replayed" as const, revision: clone(found) }
        : { kind: "persistence_unavailable" as const };
    }
    const key = workflowKey(
      input.revision.workspaceId,
      input.revision.workflowId,
    );
    const workflow = this.workflows.get(key);
    if (!workflow) {
      return { kind: "unavailable" as const };
    }
    if (this.failNextCommit) {
      this.failNextCommit = false;
      return { kind: "persistence_unavailable" as const };
    }
    const revision = immutable(
      clone({
        ...input.revision,
        revision: workflow.currentRevision + 1,
      }),
    );
    const receipt = immutable(
      clone({ ...input.receipt, resourceId: revision.id }),
    );
    const updatedWorkflow = immutable(
      clone({
        ...workflow,
        currentRevision: revision.revision,
        updatedAt: revision.createdAt,
      }),
    );
    this.revisions.set(
      revisionKey(revision.workspaceId, revision.id),
      revision,
    );
    this.receipts.set(receiptKey(receipt), receipt);
    this.workflows.set(key, updatedWorkflow);
    return { kind: "created" as const, revision: clone(revision) };
  }

  async getRevision(
    input: Parameters<WorkflowRevisionRepository["getRevision"]>[0],
  ) {
    const found = this.revisions.get(
      revisionKey(input.workspaceId, input.revisionId),
    );
    return found && found.workflowId === input.workflowId ? clone(found) : null;
  }
}

export class InMemoryWorkflowCredentialSlotAdmission
  implements WorkflowCredentialSlotAdmissionPort
{
  readonly slots = new Map<
    string,
    { workspaceId: string; profileId: string; provider: string; active: boolean }
  >();

  allow(input: {
    workspaceId: string;
    slotId: string;
    profileId: string;
    provider: string;
  }): void {
    this.slots.set(input.slotId, { ...input, active: true });
  }

  async isAccessible(
    input: Parameters<WorkflowCredentialSlotAdmissionPort["isAccessible"]>[0],
  ): Promise<boolean> {
    const slot = this.slots.get(input.slotId);
    return Boolean(
      slot &&
        slot.active &&
        slot.workspaceId === input.workspaceId &&
        slot.provider === input.provider &&
        (input.effectiveResources.credentialProfileIds ?? []).includes(
          slot.profileId,
        ),
    );
  }
}
