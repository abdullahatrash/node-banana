import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/linkedin-golden-workflow-v1.json";
import {
  dispatchCliCapability,
  dispatchMcpCapability,
  listMcpCapabilityTools,
} from "@/lib/agent-tools/adapters";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  createCapabilityRegistry,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";
import type { WorkflowOperationRegistryReader } from "../types";
import {
  createWorkflowRegistrations,
  WORKFLOW_CAPABILITY_IDENTITIES,
} from "../capabilities";
import {
  InMemoryWorkflowCredentialSlotAdmission,
  InMemoryWorkflowRevisionRepository,
} from "../memory";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../operation-registry";
import { WorkflowRevisionService } from "../service";
import { WorkflowRevisionValidator } from "../validation";

function setup(options: {
  operations?: WorkflowOperationRegistryReader;
  grantCredential?: boolean;
} = {}) {
  const operations =
    options.operations ?? GOLDEN_WORKFLOW_OPERATION_REGISTRY;
  const slots = new InMemoryWorkflowCredentialSlotAdmission();
  slots.allow({
    workspaceId: "workspace_1",
    slotId: "slot_gemini_golden",
    profileId: "profile_gemini_golden",
    provider: "gemini",
  });
  const service = new WorkflowRevisionService(
    new InMemoryWorkflowRevisionRepository(),
    new WorkflowRevisionValidator(
      operations,
      slots,
    ),
    { now: () => new Date("2026-07-25T12:00:00.000Z") },
  );
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createWorkflowRegistrations(service, operations),
  ]);
  const authorizer: CapabilityAuthorizer = {
    authorize: async (_request: CapabilityAuthorizationRequest) => ({
      allowed: true,
      operatorTraceRef: "trace_parity",
      effectiveResources: {
        channelIds: [],
        credentialProfileIds:
          options.grantCredential === false
            ? []
            : ["profile_gemini_golden"],
        workflowIds: [],
        automationIds: [],
        artifactIds: [],
      },
    }),
  };
  const dispatcher = new CapabilityDispatcher(registry, authorizer);
  return {
    dispatcher: {
      dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
        dispatcher.dispatch(invocation, {
          securityContext: {
            kind: "agent",
            workspaceId: "workspace_1",
            principalId: "principal_1",
            keyId: "key_1",
          },
        }),
    },
    dispatchHuman: (invocation: Parameters<typeof dispatcher.dispatch>[0], options?: {
      workspaceId?: string;
      userId?: string;
    }) => dispatcher.dispatch(invocation, {
      securityContext: {
        kind: "human",
        workspaceId: options?.workspaceId ?? "workspace_1",
        userId: options?.userId ?? "user_1",
        role: "member",
      },
    }),
    registry,
  };
}

describe("Workflow capability CLI/MCP parity", () => {
  it("publishes the same immutable resource across transports", async () => {
    const { dispatcher } = setup();
    const created = await dispatchCliCapability(
      "workflows.create@1",
      { idempotencyKey: "create-workflow-parity" },
      dispatcher,
    );
    expect(created.type).toBe("capability_result");
    const workflowId = (created as { output: { id: string } }).output.id;
    const draft = { ...structuredClone(fixture), workflowId };
    const cli = await dispatchCliCapability(
      "workflow_versions.create@1",
      { idempotencyKey: "publish-workflow-parity", draft },
      dispatcher,
    );
    const nonCanonical = structuredClone(draft);
    nonCanonical.steps.reverse();
    nonCanonical.outputs = {
      post_copy: nonCanonical.outputs.post_copy,
      hero_image: nonCanonical.outputs.hero_image,
    };
    const mcp = await dispatchMcpCapability(
      "workflow_versions.create.v1",
      {
        idempotencyKey: "publish-workflow-parity",
        draft: nonCanonical,
      },
      dispatcher,
    );
    expect(mcp.type).toBe("capability_result");
    expect(cli.type).toBe("capability_result");
    expect(
      (mcp as { output: unknown }).output,
    ).toEqual((cli as { output: unknown }).output);
    // The envelope honestly identifies each raw request while the scoped
    // publication receipt replays the same canonical resource.
    expect(mcp.requestDigest).not.toBe(cli.requestDigest);
  });

  it.each([
    {
      name: "missing required input",
      expected: "WORKFLOW_REQUIRED_INPUT_MISSING",
      mutate: (draft: typeof fixture) => {
        delete (draft.steps[0].inputs as Partial<
          typeof draft.steps[0]["inputs"]
        >).prompt;
      },
    },
    {
      name: "handle type mismatch",
      expected: "WORKFLOW_HANDLE_TYPE_MISMATCH",
      mutate: (draft: typeof fixture) => {
        draft.inputs.brief.kind = "image";
      },
    },
  ])("keeps $name errors equal across transports", async ({
    mutate,
    expected,
  }) => {
    const { dispatcher } = setup();
    const invalid = structuredClone(fixture);
    mutate(invalid);
    const input = { draft: invalid };
    const cli = await dispatchCliCapability(
      "workflow_versions.validate@1",
      input,
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_versions.validate.v1",
      input,
      dispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(
      (cli as { output: { errors: Array<{ code: string }> } }).output.errors,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expected })]),
    );
  });

  it("keeps inaccessible Credential Slot errors equal across transports", async () => {
    const { dispatcher } = setup({ grantCredential: false });
    const input = { draft: structuredClone(fixture) };
    const cli = await dispatchCliCapability(
      "workflow_versions.validate@1",
      input,
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_versions.validate.v1",
      input,
      dispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(
      (cli as { output: { errors: Array<{ code: string }> } }).output.errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE",
        }),
      ]),
    );
  });

  it("keeps retired exact-operation errors equal across transports", async () => {
    const retired: WorkflowOperationRegistryReader = {
      digest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      get: (identity) => {
        const found = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(identity);
        return found && identity === "gemini.generate_text@1"
          ? { ...found, lifecycle: "retired" as const }
          : found;
      },
      list: () =>
        GOLDEN_WORKFLOW_OPERATION_REGISTRY.list().map((found) =>
          found.identity === "gemini.generate_text@1"
            ? { ...found, lifecycle: "retired" as const }
            : found,
        ),
      validateConfig: (identity, value) =>
        GOLDEN_WORKFLOW_OPERATION_REGISTRY.validateConfig(identity, value),
    };
    const { dispatcher } = setup({ operations: retired });
    const input = { draft: structuredClone(fixture) };
    const cli = await dispatchCliCapability(
      "workflow_versions.validate@1",
      input,
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_versions.validate.v1",
      input,
      dispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(
      (cli as { output: { errors: Array<{ code: string }> } }).output.errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "WORKFLOW_CAPABILITY_RETIRED" }),
      ]),
    );
  });

  it("returns canonically equal validation errors across transports", async () => {
    const { dispatcher } = setup();
    const invalid = structuredClone(fixture);
    invalid.steps[1].inputs.prompt = {
      from: "step_output",
      step: "generate_hero",
      output: "image",
    };
    const cli = await dispatchCliCapability(
      "workflow_versions.validate@1",
      { draft: invalid },
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_versions.validate.v1",
      { draft: invalid },
      dispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(
      (cli as { output: { errors: Array<{ code: string }> } }).output.errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "WORKFLOW_GRAPH_CYCLE" }),
      ]),
    );
  });

  it("keeps creation collection-scoped and get/publication workflow-scoped", () => {
    const { registry } = setup();
    expect(
      registry.getRegistration(
        WORKFLOW_CAPABILITY_IDENTITIES.workflowCreate,
      )?.authorization.resources,
    ).toEqual([]);
    expect(
      registry.getRegistration(WORKFLOW_CAPABILITY_IDENTITIES.validate)
        ?.authorization.resources,
    ).toEqual([]);
    expect(
      registry.getRegistration(WORKFLOW_CAPABILITY_IDENTITIES.create)
        ?.authorization.resources,
    ).toEqual([{ kind: "workflow", inputPath: "draft.workflowId" }]);
    expect(
      registry.getRegistration(WORKFLOW_CAPABILITY_IDENTITIES.get)
        ?.authorization.resources,
    ).toEqual([{ kind: "workflow", inputPath: "workflowId" }]);
    expect(
      registry.getRegistration(WORKFLOW_CAPABILITY_IDENTITIES.getV2),
    ).toMatchObject({
      audience: "shared",
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
    });
  });

  it("lets an admitted Human inspect an exact immutable Revision through v2 only", async () => {
    const { dispatcher, dispatchHuman } = setup();
    const created = await dispatchCliCapability(
      "workflows.create@1",
      { idempotencyKey: "create-workflow-human-read" },
      dispatcher,
    );
    expect(created.type).toBe("capability_result");
    const workflowId = (created as { output: { id: string } }).output.id;
    const published = await dispatchCliCapability(
      "workflow_versions.create@1",
      {
        idempotencyKey: "publish-workflow-human-read",
        draft: { ...structuredClone(fixture), workflowId },
      },
      dispatcher,
    );
    expect(published.type).toBe("capability_result");
    const revisionId = (published as { output: { id: string } }).output.id;

    const visible = await dispatchHuman({
      capability: "workflow_versions.get@2",
      input: { workflowId, revisionId },
    });
    expect(visible).toMatchObject({
      type: "capability_result",
      capability: { name: "workflow_versions.get", version: 2 },
      output: { id: revisionId, workflowId },
    });
    await expect(dispatchHuman({
      capability: "workflow_versions.get@1",
      input: { workflowId, revisionId },
    })).resolves.toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    await expect(dispatchHuman({
      capability: "workflow_versions.get@2",
      input: { workflowId, revisionId },
    }, { workspaceId: "workspace_2", userId: "user_2" })).resolves.toMatchObject({
      type: "capability_error",
      code: "WORKFLOW_UNAVAILABLE",
    });
  });

  it("publishes the complete typed draft contract through capability and MCP discovery", async () => {
    const { dispatcher, registry } = setup();
    const definition = registry.getDefinition(
      WORKFLOW_CAPABILITY_IDENTITIES.validate,
    );
    const inputSchema = definition?.schemas.input as {
      properties?: {
        draft?: {
          properties?: Record<string, unknown>;
        };
      };
    };
    expect(inputSchema.properties?.draft?.properties).toMatchObject({
      schema: expect.any(Object),
      workflowId: expect.any(Object),
      inputs: expect.any(Object),
      credentialSlots: expect.any(Object),
      steps: expect.any(Object),
      outputs: expect.any(Object),
    });

    const tools = await listMcpCapabilityTools(dispatcher);
    const validateTool = tools.find(
      (tool) => tool.name === "workflow_versions.validate.v1",
    );
    expect(validateTool?.inputSchema).toEqual(definition?.schemas.input);
  });
});
