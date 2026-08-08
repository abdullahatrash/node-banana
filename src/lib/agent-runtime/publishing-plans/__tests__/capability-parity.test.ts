import { describe, expect, it } from "vitest";
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
import { z } from "zod";
import {
  createPublishingPlanRegistrations,
  PUBLISHING_PLAN_CAPABILITY_IDENTITIES,
} from "../capabilities";
import { AesGcmPublishingPlanCursorCodec } from "../cursor";
import { publishingPlanDraft, setupPublishingPlans } from "./fixtures";

function capabilitySetup() {
  const setup = setupPublishingPlans();
  const cursor = new AesGcmPublishingPlanCursorCodec(() => ({
    active: { id: "active", key: Buffer.alloc(32, 3) },
    all: [{ id: "active", key: Buffer.alloc(32, 3) }],
  }));
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createPublishingPlanRegistrations(setup.service, cursor),
  ]);
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request: CapabilityAuthorizationRequest) => ({
      allowed: true,
      operatorTraceRef: "otr_publishing_plan_create",
      effectiveResources: {
        channelIds: request.resources
          .filter((item) => item.kind === "channel")
          .map((item) => item.id),
        artifactIds: request.resources
          .filter((item) => item.kind === "artifact")
          .map((item) => item.id),
        credentialProfileIds: [],
        workflowIds: [],
        automationIds: [],
      },
    }),
  };
  const dispatcher = new CapabilityDispatcher(registry, authorizer);
  const bound = {
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, {
        securityContext: {
          kind: "agent" as const,
          workspaceId: "workspace_1",
          principalId: "principal_1",
          keyId: "key_1",
        },
      }),
  };
  return { ...setup, dispatcher: bound, registry };
}

function blockers(response: unknown): string[] {
  return (
    response as {
      output: { blockers: Array<{ code: string }> };
    }
  ).output.blockers.map((item) => item.code);
}

describe("Publishing Plan CLI/MCP parity", () => {
  it("publishes strict discoverable schemas and authorization manifests", async () => {
    const { registry, dispatcher } = capabilitySetup();
    expect(
      registry.getRegistration(PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create)
        ?.authorization.resources,
    ).toEqual([
      { kind: "channel", inputPath: "draft.channelIds" },
      { kind: "artifact", inputPath: "draft.artifactIds" },
    ]);
    const definition = registry.getDefinition(
      PUBLISHING_PLAN_CAPABILITY_IDENTITIES.validate,
    );
    expect(
      (definition?.schemas.input as { additionalProperties?: boolean })
        .additionalProperties,
    ).toBe(false);
    const draftProperties = (
      definition?.schemas.input as {
        properties?: { draft?: { properties?: Record<string, unknown> } };
      }
    ).properties?.draft?.properties;
    expect(draftProperties).not.toHaveProperty("context");
    expect(draftProperties).toMatchObject({
      planId: expect.any(Object),
      channelIds: expect.any(Object),
      artifactIds: expect.any(Object),
      targets: expect.any(Object),
    });
    const tools = await listMcpCapabilityTools(dispatcher);
    expect(
      tools.find(
        (tool) => tool.name === "publishing_plan_revisions.validate.v1",
      )?.inputSchema,
    ).toEqual(definition?.schemas.input);
  });

  it("creates and replays the same immutable revision across transports", async () => {
    const { dispatcher } = capabilitySetup();
    const input = {
      idempotencyKey: "publishing-plan-parity",
      draft: publishingPlanDraft(),
    };
    const cli = await dispatchCliCapability(
      "publishing_plan_revisions.create@1",
      input,
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "publishing_plan_revisions.create.v1",
      input,
      dispatcher,
    );

    expect(cli.type).toBe("capability_result");
    expect(mcp.type).toBe("capability_result");
    expect((mcp as { output: unknown }).output).toEqual(
      (cli as { output: unknown }).output,
    );
    expect(
      (cli as { output: { validationEvidence: { authorizesExecution: boolean } } })
        .output.validationEvidence.authorizesExecution,
    ).toBe(false);
  });

  it("keeps inaccessible Channel, missing media, invalid settings, and expired context blockers equal", async () => {
    const scenarios: Array<{
      expected: string;
      mutate(setup: ReturnType<typeof capabilitySetup>): void;
    }> = [
      {
        expected: "CHANNEL_INACCESSIBLE",
        mutate(setup) {
          const channel = setup.channels.snapshots.values().next().value!;
          setup.channels.put({ ...channel, state: "disconnected" });
        },
      },
      {
        expected: "ARTIFACT_MISSING",
        mutate(setup) {
          setup.artifacts.snapshots.delete("workspace_1\u0000artifact_image");
        },
      },
      {
        expected: "SETTINGS_INVALID",
        mutate() {},
      },
      {
        expected: "CONTEXT_EXPIRED",
        mutate(setup) {
          setup.contexts.snapshots.clear();
        },
      },
    ];

    for (const scenario of scenarios) {
      const setup = capabilitySetup();
      scenario.mutate(setup);
      const draft = publishingPlanDraft();
      if (scenario.expected === "SETTINGS_INVALID") {
        draft.targets[0]!.settings = { type: "company" };
      }
      const input = { draft };
      const cli = await dispatchCliCapability(
        "publishing_plan_revisions.validate@1",
        input,
        setup.dispatcher,
      );
      const mcp = await dispatchMcpCapability(
        "publishing_plan_revisions.validate.v1",
        input,
        setup.dispatcher,
      );
      expect(mcp).toEqual(cli);
      expect(blockers(cli)).toContain(scenario.expected);
    }
  });

  it("keeps partial blocked validation output inside the discoverable schema", async () => {
    const setup = capabilitySetup();
    const channel = setup.channels.snapshots.values().next().value!;
    setup.channels.put({ ...channel, state: "disconnected" });
    setup.artifacts.snapshots.clear();
    const draft = publishingPlanDraft();
    draft.targets[0]!.settings = { rawProviderPayload: "unsupported" };

    const response = await dispatchCliCapability(
      "publishing_plan_revisions.validate@1",
      { draft },
      setup.dispatcher,
    );
    const output = (response as { output: unknown }).output;
    const definition = setup.registry.getDefinition(
      PUBLISHING_PLAN_CAPABILITY_IDENTITIES.validate,
    );

    expect(blockers(response)).toEqual([
      "CHANNEL_INACCESSIBLE",
      "ARTIFACT_MISSING",
    ]);
    expect(() =>
      z.fromJSONSchema(definition!.schemas.output as never).parse(output),
    ).not.toThrow();
  });

  it("validates multiple targets and inspects subsequent cursor pages", async () => {
    const setup = capabilitySetup();
    const firstDraft = publishingPlanDraft();
    firstDraft.targets.push({
      ...structuredClone(firstDraft.targets[0]!),
      targetId: "target_2",
    });
    const validation = await dispatchCliCapability(
      "publishing_plan_revisions.validate@1",
      { draft: firstDraft },
      setup.dispatcher,
    );
    expect(
      (validation as { output: { evidence: { targets: unknown[] } } }).output
        .evidence.targets,
    ).toHaveLength(2);

    await dispatchCliCapability(
      "publishing_plan_revisions.create@1",
      { idempotencyKey: "publishing-plan-page-1", draft: firstDraft },
      setup.dispatcher,
    );
    const edited = structuredClone(firstDraft);
    edited.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-09T12:00:00.000Z",
    };
    await dispatchCliCapability(
      "publishing_plan_revisions.create@1",
      {
        idempotencyKey: "publishing-plan-page-2",
        expectedRevision: 1,
        draft: edited,
      },
      setup.dispatcher,
    );
    const firstPage = await dispatchCliCapability(
      "publishing_plan_revisions.list@1",
      { planId: "plan_1", limit: 1 },
      setup.dispatcher,
    );
    const page = (
      firstPage as {
        output: { items: Array<{ id: string }>; nextCursor: string };
      }
    ).output;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
    const secondPage = await dispatchMcpCapability(
      "publishing_plan_revisions.list.v1",
      { planId: "plan_1", limit: 1, cursor: page.nextCursor },
      setup.dispatcher,
    );
    const second = (
      secondPage as { output: { items: Array<{ id: string }> } }
    ).output;
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(page.items[0]?.id);
  });
});
