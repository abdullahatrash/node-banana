import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/linkedin-golden-workflow-v1.json";
import {
  InMemoryWorkflowCredentialSlotAdmission,
} from "../memory";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  WorkflowOperationRegistry,
} from "../operation-registry";
import { WorkflowRevisionValidator } from "../validation";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";
import type { WorkflowDraft } from "../types";
import { z } from "zod";

const resources: AgentResourceConstraints = {
  channelIds: [],
  credentialProfileIds: ["profile_gemini_golden"],
  workflowIds: [],
  automationIds: [],
  artifactIds: [],
};

function setup(
  registry: WorkflowOperationRegistry = GOLDEN_WORKFLOW_OPERATION_REGISTRY,
) {
  const slots = new InMemoryWorkflowCredentialSlotAdmission();
  slots.allow({
    workspaceId: "workspace_1",
    slotId: "slot_gemini_golden",
    profileId: "profile_gemini_golden",
    provider: "gemini",
  });
  return new WorkflowRevisionValidator(registry, slots);
}

function draft(): WorkflowDraft {
  return structuredClone(fixture) as WorkflowDraft;
}

describe("Workflow Revision validation", () => {
  it("freezes the frozen LinkedIn fixture to a literal behavior digest", async () => {
    const result = await setup().validate({
      candidate: draft(),
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.digest).toBe(
      "sha256:b5c5f58a1413295e7678bce0ce80b5fc2f93335bf5b2f449e5a01f08724b5bc3",
    );
    expect(result.normalizedDefinition?.steps.map((step) => step.id)).toEqual([
      "draft_copy",
      "generate_hero",
    ]);
    expect(result.normalizedDefinition?.outputs).toEqual({
      hero_image: {
        kind: "image",
        binding: {
          from: "step_output",
          step: "generate_hero",
          output: "image",
        },
      },
      post_copy: {
        kind: "text",
        binding: {
          from: "step_output",
          step: "draft_copy",
          output: "text",
        },
      },
    });
  });

  it("excludes display copy and Workflow identity from behavior identity", async () => {
    const validator = setup();
    const first = await validator.validate({
      candidate: draft(),
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    const changed = draft();
    changed.workflowId = "another_workflow";
    changed.name = "Another display name";
    changed.description = "Another display description";
    changed.inputs.brief.description = "Another input description";
    const second = await validator.validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(second.digest).toBe(first.digest);
  });

  it("uses deterministic lexical topological ordering", async () => {
    const changed = draft();
    changed.steps.reverse();
    changed.outputs = {
      post_copy: changed.outputs.post_copy,
      hero_image: changed.outputs.hero_image,
    };
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.digest).toBe(
      "sha256:b5c5f58a1413295e7678bce0ce80b5fc2f93335bf5b2f449e5a01f08724b5bc3",
    );
    expect(result.normalizedDefinition?.steps.map((step) => step.id)).toEqual([
      "draft_copy",
      "generate_hero",
    ]);
  });

  it("reports cycles, required inputs, type mismatches, and retired operations", async () => {
    const changed = draft();
    changed.inputs.brief.kind = "image";
    changed.steps[0].inputs.prompt = {
      from: "step_output",
      step: "generate_hero",
      output: "image",
    };
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.errors.map((error) => error.code)).toContain(
      "WORKFLOW_GRAPH_CYCLE",
    );
    expect(result.errors.map((error) => error.code)).toContain(
      "WORKFLOW_HANDLE_TYPE_MISMATCH",
    );

    const retiredRegistry = new WorkflowOperationRegistry([
      {
        identity: "gemini.generate_text@1",
        lifecycle: "retired",
        inputs: { prompt: { kind: "text", required: true } },
        outputs: { text: "text" },
        config: z.object({}).strict(),
        credentialRequirements: {
          provider: { provider: "gemini", required: true },
        },
        retryBounds: {
          maxAttempts: 3,
          maxInitialMs: 60_000,
          maxBackoffMs: 300_000,
          maxMultiplier: 4,
          maxTotalDelayMs: 600_000,
        },
      },
    ]);
    const oneStep = draft();
    oneStep.steps = [oneStep.steps[0]];
    oneStep.steps[0].config = {};
    oneStep.outputs = {
      post_copy: oneStep.outputs.post_copy,
    };
    const retired = await setup(retiredRegistry).validate({
      candidate: oneStep,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(retired.errors.map((error) => error.code)).toContain(
      "WORKFLOW_CAPABILITY_RETIRED",
    );
  });

  it("rejects unavailable Credential Slots without distinguishing the cause", async () => {
    const result = await setup().validate({
      candidate: draft(),
      workspaceId: "another_workspace",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.errors.filter((error) =>
      error.code === "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE"
    )).toHaveLength(2);
  });

  it("rejects optional Workflow inputs feeding required operation ports", async () => {
    const changed = draft();
    changed.inputs.brief.required = false;
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "WORKFLOW_REQUIRED_INPUT_MISSING",
        path: "steps.0.inputs.prompt",
      }),
    );
  });

  it("rejects cyclic object input without recursing", async () => {
    const changed = draft() as WorkflowDraft & {
      loop?: unknown;
    };
    changed.loop = changed;
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "WORKFLOW_FIELD_INVALID",
        path: "<root>",
      }),
    );
  });

  it("rejects oversized primitive collections before schema recursion", async () => {
    const changed = draft() as WorkflowDraft & {
      oversized?: unknown[];
    };
    changed.oversized = new Array(10_001).fill(null);
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "WORKFLOW_FIELD_INVALID",
        path: "<root>",
      }),
    );
  });

  it("rejects oversized candidates and caps emitted validation issues", async () => {
    const oversized = draft();
    oversized.steps[0].config.instruction = "x".repeat(20_000);
    const oversizedResult = await setup().validate({
      candidate: oversized,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(oversizedResult.errors).toContainEqual(
      expect.objectContaining({
        code: "WORKFLOW_FIELD_INVALID",
        path: "<root>",
      }),
    );

    const manySecrets = {
      nested: Array.from({ length: 200 }, () => ({ secret: "value" })),
    };
    const issueResult = await setup().validate({
      candidate: manySecrets,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(issueResult.errors.length).toBeLessThanOrEqual(128);
  });

  it("rejects unused Credential Slot declarations without resolving their existence", async () => {
    const changed = draft();
    changed.credentialSlots.unused = {
      slotId: "cross_workspace_or_ungranted",
      provider: "gemini",
    };
    const result = await setup().validate({
      candidate: changed,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: resources,
    });
    expect(result.errors).toContainEqual({
      code: "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE",
      path: "credentialSlots.unused",
      message: "Credential Slot declaration is unused or unavailable.",
    });
  });

  it("keeps operation metadata immutable and validators private", () => {
    const definition = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_text@1",
    );
    expect(definition).toBeDefined();
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition?.inputs)).toBe(true);
    expect("config" in (definition ?? {})).toBe(false);
    const digest = GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest;
    expect(() => {
      Object.assign(definition?.inputs.prompt ?? {}, { kind: "image" });
    }).toThrow();
    expect(GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest).toBe(digest);
    expect(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.validateConfig(
        "gemini.generate_text@1",
        {
          model: "gemini-2.5-flash",
          instruction: "  trimmed  ",
        },
      ),
    ).toEqual({
      success: true,
      data: {
        model: "gemini-2.5-flash",
        instruction: "trimmed",
      },
    });
  });
});
