import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";
import { WorkflowServiceError } from "./errors";
import type {
  ContentWorkflowDto,
  ContentWorkflowRecord,
  ContentWorkflowRevisionRecord,
  WorkflowClock,
  WorkflowRevisionDto,
  WorkflowRevisionRepository,
  WorkflowValidationResult,
} from "./types";
import { WorkflowRevisionValidator } from "./validation";

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;
const ID = /^[a-zA-Z0-9_-]{1,200}$/;

const systemClock: WorkflowClock = { now: () => new Date() };

function idempotencyKey(value: string): string {
  const trimmed = value.trim();
  if (!IDEMPOTENCY_KEY.test(trimmed)) {
    throw new WorkflowServiceError(
      "WORKFLOW_INVALID_INPUT",
      "A stable idempotency key between 8 and 200 visible ASCII characters is required.",
    );
  }
  return trimmed;
}

function identifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!ID.test(trimmed)) {
    throw new WorkflowServiceError(
      "WORKFLOW_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return trimmed;
}

function serverEvidence(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new WorkflowServiceError(
      "WORKFLOW_PERSISTENCE_UNAVAILABLE",
      `${label} is unavailable.`,
    );
  }
  return trimmed;
}

export function workflowDto(workflow: ContentWorkflowRecord): ContentWorkflowDto {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    currentRevision: workflow.currentRevision,
    createdByPrincipalId: workflow.createdByPrincipalId,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

export function revisionDto(
  revision: ContentWorkflowRevisionRecord,
): WorkflowRevisionDto {
  return {
    id: revision.id,
    workspaceId: revision.workspaceId,
    workflowId: revision.workflowId,
    revision: revision.revision,
    definitionDigest: revision.definitionDigest,
    definition: structuredClone(revision.definition),
    operationRegistryDigest: revision.operationRegistryDigest,
    author: {
      principalId: revision.authorPrincipalId,
      keyId: revision.authorKeyId,
      authorizationEvidenceRef: revision.authorizationEvidenceRef,
    },
    createdAt: revision.createdAt.toISOString(),
  };
}

export class WorkflowRevisionService {
  constructor(
    private readonly repository: WorkflowRevisionRepository,
    private readonly validator: WorkflowRevisionValidator,
    private readonly clock: WorkflowClock = systemClock,
  ) {}

  validate(input: {
    candidate: unknown;
    workspaceId: string;
    principalId: string;
    effectiveResources: AgentResourceConstraints;
  }): Promise<WorkflowValidationResult> {
    return this.validator.validate(input);
  }

  async createWorkflow(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    idempotencyKey: string;
  }): Promise<ContentWorkflowDto> {
    const key = idempotencyKey(input.idempotencyKey);
    const principalId = serverEvidence(input.principalId, "Author Principal");
    const keyId = serverEvidence(input.keyId, "Author key");
    const authorizationEvidenceRef = serverEvidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const requestFingerprint = canonicalDigest({
      capability: "workflows.create@1",
    });
    const receipt = await this.repository.readReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "workflows.create@1",
      idempotencyKey: key,
      requestFingerprint,
    });
    if (receipt.kind === "conflict") {
      throw new WorkflowServiceError(
        "WORKFLOW_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow request.",
      );
    }
    if (receipt.kind === "replayed") {
      const workflow = await this.repository.createWorkflow({
        workflow: {
          id: receipt.resourceId,
          workspaceId: input.workspaceId,
          currentRevision: 0,
          createdByPrincipalId: principalId,
          createdByKeyId: keyId,
          authorizationEvidenceRef,
          createdAt: this.clock.now(),
          updatedAt: this.clock.now(),
        },
        receipt: {
          workspaceId: input.workspaceId,
          principalId,
          capability: "workflows.create@1",
          idempotencyKey: key,
          requestFingerprint,
          resourceId: receipt.resourceId,
          createdAt: this.clock.now(),
        },
      });
      if (workflow.kind === "conflict" || workflow.kind === "unavailable") {
        throw new WorkflowServiceError(
          "WORKFLOW_PERSISTENCE_UNAVAILABLE",
          "The original Workflow creation receipt is unavailable.",
        );
      }
      return workflowDto(workflow.workflow);
    }

    const now = this.clock.now();
    const workflow: ContentWorkflowRecord = {
      id: `wf_${randomUUID().replaceAll("-", "")}`,
      workspaceId: input.workspaceId,
      currentRevision: 0,
      createdByPrincipalId: principalId,
      createdByKeyId: keyId,
      authorizationEvidenceRef,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.repository.createWorkflow({
      workflow,
      receipt: {
        workspaceId: input.workspaceId,
        principalId,
        capability: "workflows.create@1",
        idempotencyKey: key,
        requestFingerprint,
        resourceId: workflow.id,
        createdAt: now,
      },
    });
    if (result.kind === "conflict") {
      throw new WorkflowServiceError(
        "WORKFLOW_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow request.",
      );
    }
    if (result.kind === "unavailable") {
      throw new WorkflowServiceError(
        "WORKFLOW_PERSISTENCE_UNAVAILABLE",
        "Workflow creation could not be committed.",
      );
    }
    return workflowDto(result.workflow);
  }

  async publish(input: {
    candidate: unknown;
    workspaceId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    effectiveResources: AgentResourceConstraints;
    idempotencyKey: string;
  }): Promise<WorkflowRevisionDto> {
    const key = idempotencyKey(input.idempotencyKey);
    const principalId = serverEvidence(input.principalId, "Author Principal");
    const keyId = serverEvidence(input.keyId, "Author key");
    const authorizationEvidenceRef = serverEvidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const validation = await this.validator.validate(input);
    if (
      !validation.valid ||
      !validation.digest ||
      !validation.normalizedDefinition
    ) {
      throw new WorkflowServiceError(
        "WORKFLOW_VALIDATION_FAILED",
        "Workflow publication requires a valid draft.",
        validation.errors,
      );
    }
    const workflowId = validation.normalizedDefinition.workflowId;
    const requestFingerprint = canonicalDigest({
      workflowId,
      definitionDigest: validation.digest,
      definition: validation.normalizedDefinition,
    });
    const receipt = await this.repository.readReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "workflow_versions.create@1",
      idempotencyKey: key,
      requestFingerprint,
    });
    if (receipt.kind === "conflict") {
      throw new WorkflowServiceError(
        "WORKFLOW_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow publication.",
      );
    }
    if (receipt.kind === "replayed") {
      const found = await this.repository.getRevision({
        workspaceId: input.workspaceId,
        workflowId,
        revisionId: receipt.resourceId,
      });
      if (!found) {
        throw new WorkflowServiceError(
          "WORKFLOW_PERSISTENCE_UNAVAILABLE",
          "The original Workflow publication receipt is unavailable.",
        );
      }
      return revisionDto(found);
    }

    const now = this.clock.now();
    const result = await this.repository.publish({
      revision: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        workflowId,
        definitionDigest: validation.digest,
        definition: validation.normalizedDefinition,
        operationRegistryDigest: validation.operationRegistryDigest,
        authorPrincipalId: principalId,
        authorKeyId: keyId,
        authorizationEvidenceRef,
        createdAt: now,
      },
      receipt: {
        workspaceId: input.workspaceId,
        principalId,
        capability: "workflow_versions.create@1",
        idempotencyKey: key,
        requestFingerprint,
        createdAt: now,
      },
    });
    if (result.kind === "conflict") {
      throw new WorkflowServiceError(
        "WORKFLOW_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow publication.",
      );
    }
    if (result.kind === "unavailable") {
      throw new WorkflowServiceError(
        "WORKFLOW_UNAVAILABLE",
        "The Workflow is unavailable for publication.",
      );
    }
    if (result.kind === "persistence_unavailable") {
      throw new WorkflowServiceError(
        "WORKFLOW_PERSISTENCE_UNAVAILABLE",
        "Workflow publication could not be committed.",
      );
    }
    return revisionDto(result.revision);
  }

  async getRevision(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
  }): Promise<WorkflowRevisionDto> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const revisionId = identifier(input.revisionId, "Workflow revision ID");
    const found = await this.repository.getRevision({
      workspaceId: input.workspaceId,
      workflowId,
      revisionId,
    });
    if (!found) {
      throw new WorkflowServiceError(
        "WORKFLOW_UNAVAILABLE",
        "Workflow revision is unavailable.",
      );
    }
    return revisionDto(found);
  }
}
