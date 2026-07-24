import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/linkedin-golden-workflow-v1.json";
import {
  InMemoryWorkflowCredentialSlotAdmission,
  InMemoryWorkflowRevisionRepository,
} from "../memory";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../operation-registry";
import { WorkflowRevisionService } from "../service";
import { WorkflowRevisionValidator } from "../validation";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";
import type { WorkflowDraft } from "../types";

const resources: AgentResourceConstraints = {
  channelIds: [],
  credentialProfileIds: ["profile_gemini_golden"],
  workflowIds: [],
  automationIds: [],
  artifactIds: [],
};

function setup() {
  const repository = new InMemoryWorkflowRevisionRepository();
  const slots = new InMemoryWorkflowCredentialSlotAdmission();
  slots.allow({
    workspaceId: "workspace_1",
    slotId: "slot_gemini_golden",
    profileId: "profile_gemini_golden",
    provider: "gemini",
  });
  const service = new WorkflowRevisionService(
    repository,
    new WorkflowRevisionValidator(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      slots,
    ),
    { now: () => new Date("2026-07-25T12:00:00.000Z") },
  );
  return { repository, service };
}

function authored(
  workflowId: string,
): WorkflowDraft {
  return { ...(structuredClone(fixture) as WorkflowDraft), workflowId };
}

async function createWorkflow(service: WorkflowRevisionService) {
  return service.createWorkflow({
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    authorizationEvidenceRef: "trace_create",
    idempotencyKey: "create-workflow-1",
  });
}

function publishInput(workflowId: string, key: string) {
  return {
    candidate: authored(workflowId),
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    authorizationEvidenceRef: "trace_publish",
    effectiveResources: resources,
    idempotencyKey: key,
  };
}

describe("WorkflowRevisionService", () => {
  it("creates a canonical server-owned Workflow identity and replays safely", async () => {
    const { service } = setup();
    const first = await createWorkflow(service);
    const replay = await createWorkflow(service);
    expect(first.id).toMatch(/^wf_[a-f0-9]{32}$/);
    expect(replay).toEqual(first);
  });

  it("publishes immutable authored revisions and preserves author evidence", async () => {
    const { repository, service } = setup();
    const workflow = await createWorkflow(service);
    const first = await service.publish(
      publishInput(workflow.id, "publish-revision-1"),
    );
    const replayCandidate = authored(workflow.id);
    replayCandidate.steps.reverse();
    replayCandidate.outputs = {
      post_copy: replayCandidate.outputs.post_copy,
      hero_image: replayCandidate.outputs.hero_image,
    };
    const replay = await service.publish({
      ...publishInput(workflow.id, "publish-revision-1"),
      candidate: replayCandidate,
    });
    expect(replay).toEqual(first);
    expect(first.revision).toBe(1);
    expect(first.author).toEqual({
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_publish",
    });
    const stored = repository.revisions.get(
      `workspace_1\u0000${first.id}`,
    );
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.definition)).toBe(true);
  });

  it("creates a separate authored revision for a new key, even with the same behavior", async () => {
    const { service } = setup();
    const workflow = await createWorkflow(service);
    const first = await service.publish(
      publishInput(workflow.id, "publish-revision-1"),
    );
    const second = await service.publish(
      publishInput(workflow.id, "publish-revision-2"),
    );
    expect(second.revision).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.definitionDigest).toBe(first.definitionDigest);
  });

  it("appends changed behavior without mutating the earlier revision", async () => {
    const { service } = setup();
    const workflow = await createWorkflow(service);
    const first = await service.publish(
      publishInput(workflow.id, "publish-revision-1"),
    );
    const frozenFirst = structuredClone(first);
    const changed = authored(workflow.id);
    changed.steps[0].config.instruction = "Write a detailed LinkedIn launch.";
    const second = await service.publish({
      ...publishInput(workflow.id, "publish-revision-2"),
      candidate: changed,
    });
    expect(second.revision).toBe(2);
    expect(second.definitionDigest).not.toBe(first.definitionDigest);
    await expect(
      service.getRevision({
        workspaceId: "workspace_1",
        workflowId: workflow.id,
        revisionId: first.id,
      }),
    ).resolves.toEqual(frozenFirst);
  });

  it("conflicts when one key is reused for changed behavior", async () => {
    const { service } = setup();
    const workflow = await createWorkflow(service);
    await service.publish(publishInput(workflow.id, "publish-revision-1"));
    const changed = authored(workflow.id);
    changed.steps[0].config.instruction = "Different behavior";
    await expect(
      service.publish({
        ...publishInput(workflow.id, "publish-revision-1"),
        candidate: changed,
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_IDEMPOTENCY_CONFLICT",
    });
  });

  it("conflicts when one key is reused for changed persisted display metadata", async () => {
    const { service } = setup();
    const workflow = await createWorkflow(service);
    await service.publish(publishInput(workflow.id, "publish-revision-1"));
    const changed = authored(workflow.id);
    changed.name = "Changed persisted display name";
    changed.description = "Changed persisted display description";
    changed.inputs.brief.description = "Changed persisted input description";

    await expect(
      service.publish({
        ...publishInput(workflow.id, "publish-revision-1"),
        candidate: changed,
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_IDEMPOTENCY_CONFLICT",
    });
  });

  it("does not leave partial state when persistence fails", async () => {
    const { repository, service } = setup();
    const workflow = await createWorkflow(service);
    repository.failNextCommit = true;
    await expect(
      service.publish(publishInput(workflow.id, "publish-revision-1")),
    ).rejects.toMatchObject({
      code: "WORKFLOW_PERSISTENCE_UNAVAILABLE",
      retryable: true,
    });
    expect(repository.revisions.size).toBe(0);
    expect(repository.receipts.size).toBe(1);
    expect(repository.workflows.values().next().value?.currentRevision).toBe(0);
  });
});
