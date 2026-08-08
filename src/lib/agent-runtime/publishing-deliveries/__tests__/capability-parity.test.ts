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
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createPublishingDeliveryRegistrations,
  PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES,
} from "../capabilities";
import { setupPublishingDeliveries } from "./fixtures";

async function capabilitySetup(options: { punctuatedArtifacts?: boolean } = {}) {
  const setup = await setupPublishingDeliveries(undefined, options);
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createPublishingDeliveryRegistrations(setup.service),
  ]);
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request: CapabilityAuthorizationRequest) => ({
      allowed: true,
      operatorTraceRef: "release_authorization_evidence_1",
      effectiveResources: {
        channelIds: request.resources.filter((item) => item.kind === "channel").map((item) => item.id),
        artifactIds: request.resources.filter((item) => item.kind === "artifact").map((item) => item.id),
        credentialProfileIds: [], workflowIds: [], automationIds: [],
      },
    }),
  };
  const dispatcher = new CapabilityDispatcher(registry, authorizer);
  const agentDispatcher = {
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
  const humanDispatcher = {
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, {
        securityContext: {
          kind: "human" as const,
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "owner" as const,
        },
      }),
  };
  const memberDispatcher = {
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, {
        securityContext: {
          kind: "human" as const,
          workspaceId: "workspace_1",
          userId: "member_1",
          role: "member" as const,
        },
      }),
  };
  return { ...setup, registry, agentDispatcher, humanDispatcher, memberDispatcher };
}

function releaseInput(setup: Awaited<ReturnType<typeof setupPublishingDeliveries>>) {
  const input = setup.releaseInput();
  return {
    approvalRequestId: input.approvalRequestId,
    channelIds: input.channelIds,
    artifactIds: input.artifactIds,
    idempotencyKey: input.idempotencyKey,
  };
}

describe("Publishing Delivery CLI/MCP parity", () => {
  it("publishes intrinsic shared cancellation without claiming external reversal", async () => {
    const setup = await capabilitySetup();
    const registration = setup.registry.getRegistration(
      PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.cancel,
    )!;
    expect(registration).toMatchObject({
      audience: "shared",
      effect: {
        mutation: "runtime-state",
        timing: "immediate",
        reversibility: "conditional",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "intrinsic" },
      authorization: {
        resources: [
          { kind: "channel", inputPath: "channelIds" },
          { kind: "artifact", inputPath: "artifactIds" },
        ],
      },
    });
    const released = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(setup),
      setup.agentDispatcher,
    );
    const deliveryId = (released as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    const input = {
      deliveryId,
      channelIds: setup.rawApproval.channelIds,
      artifactIds: setup.rawApproval.artifactIds,
    };
    const cli = await dispatchCliCapability(
      "publishing_deliveries.cancel@1",
      input,
      setup.agentDispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "publishing_deliveries.cancel.v1",
      input,
      setup.agentDispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(cli).toMatchObject({
      type: "capability_result",
      status: "completed",
      output: {
        desiredState: "cancel",
        outcome: "prevented",
        externallyCompletedAtRequest: false,
        durable: true,
        externallyReversed: false,
      },
    });
    expect(() => z.fromJSONSchema(
      setup.registry.getDefinition(PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.cancel)!.schemas.output as never,
    ).parse((cli as { output: unknown }).output)).not.toThrow();
  });

  it("allows explicitly authorized Humans but rejects membership role alone", async () => {
    const allowed = await capabilitySetup();
    const released = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(allowed),
      allowed.agentDispatcher,
    );
    const deliveryId = (released as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    const input = {
      deliveryId,
      channelIds: allowed.rawApproval.channelIds,
      artifactIds: allowed.rawApproval.artifactIds,
    };
    expect(await dispatchCliCapability(
      "publishing_deliveries.cancel@1",
      input,
      allowed.humanDispatcher,
    )).toMatchObject({
      type: "capability_result",
      output: { outcome: "prevented" },
    });

    const denied = await capabilitySetup();
    const deniedRelease = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(denied),
      denied.agentDispatcher,
    );
    const deniedDeliveryId = (deniedRelease as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    expect(await dispatchCliCapability(
      "publishing_deliveries.cancel@1",
      { ...input, deliveryId: deniedDeliveryId },
      denied.memberDispatcher,
    )).toMatchObject({
      type: "capability_error",
      code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
    });
  });

  it("publishes exact release authorization and durable-async capability metadata", async () => {
    const setup = await capabilitySetup();
    const registration = setup.registry.getRegistration(
      PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.release,
    )!;
    expect(registration.authorization.resources).toEqual([
      { kind: "channel", inputPath: "channelIds" },
      { kind: "artifact", inputPath: "artifactIds" },
    ]);
    expect(registration.effect).toMatchObject({
      timing: "durable-async",
      maySpendProviderBudget: false,
    });
    expect(registration.approval).toEqual({ mode: "required-before-effect" });
    const tools = await listMcpCapabilityTools(setup.agentDispatcher);
    expect(tools.some((tool) => tool.name === "publishing_plan_revisions.release.v1")).toBe(true);
  });

  it("returns identical immutable Durable Acceptance through CLI and MCP without claiming completion", async () => {
    const setup = await capabilitySetup();
    const input = releaseInput(setup);
    const cli = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      input,
      setup.agentDispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "publishing_plan_revisions.release.v1",
      input,
      setup.agentDispatcher,
    );
    expect(mcp).toEqual(cli);
    expect(cli).toMatchObject({
      type: "capability_result",
      status: "accepted",
      output: {
        durable: true,
        externallyCompleted: false,
        deliveries: [{ state: "scheduled", externallyCompleted: false }],
      },
    });
    const output = (cli as { output: unknown }).output;
    expect(() => z.fromJSONSchema(
      setup.registry.getDefinition(PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.release)!.schemas.output as never,
    ).parse(output)).not.toThrow();
  });

  it("keeps punctuated Artifact IDs inside release and observation authorization schemas", async () => {
    const setup = await capabilitySetup({ punctuatedArtifacts: true });
    const released = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(setup),
      setup.agentDispatcher,
    );
    const deliveryId = (released as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    const resources = {
      channelIds: setup.rawApproval.channelIds,
      artifactIds: ["artifact:text.v1", "artifact:image.v1"],
    };
    expect(await dispatchCliCapability("publishing_deliveries.get@1", {
      deliveryId,
      ...resources,
    }, setup.agentDispatcher)).toMatchObject({ type: "capability_result" });
    expect(await dispatchCliCapability("publishing_deliveries.list@1", {
      ...resources,
      limit: 10,
    }, setup.agentDispatcher)).toMatchObject({
      type: "capability_result",
      output: { items: [{ id: deliveryId }] },
    });
    expect(await dispatchCliCapability("publishing_delivery_events.list@1", {
      deliveryId,
      ...resources,
      limit: 10,
    }, setup.agentDispatcher)).toMatchObject({
      type: "capability_result",
      output: {
        items: [{ type: "delivery.accepted" }, { type: "delivery.scheduled" }],
        nextAfterSequence: null,
      },
    });
  });

  it("publishes closed retained-event evidence and rejects undeclared fields", async () => {
    const setup = await capabilitySetup();
    const released = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(setup),
      setup.agentDispatcher,
    );
    const deliveryId = (released as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    const response = await dispatchCliCapability("publishing_delivery_events.list@1", {
      deliveryId,
      channelIds: setup.rawApproval.channelIds,
      artifactIds: setup.rawApproval.artifactIds,
      limit: 2,
    }, setup.agentDispatcher);
    const output = structuredClone((response as { output: { items: Array<{ evidence: Record<string, unknown> }> } }).output);
    const parser = z.fromJSONSchema(
      setup.registry.getDefinition(PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.events)!.schemas.output as never,
    );
    expect(() => parser.parse(output)).not.toThrow();
    expect(output).toMatchObject({ nextAfterSequence: null });
    output.items[0]!.evidence.secret = "must-not-fit-contract";
    expect(() => parser.parse(output)).toThrow();
  });

  it("keeps scheduled and terminal inspect projections inside the closed output schema", async () => {
    const setup = await capabilitySetup();
    const released = await dispatchCliCapability(
      "publishing_plan_revisions.release@1",
      releaseInput(setup),
      setup.agentDispatcher,
    );
    const deliveryId = (released as { output: { deliveries: Array<{ id: string }> } }).output.deliveries[0]!.id;
    const input = {
      deliveryId,
      channelIds: setup.rawApproval.channelIds,
      artifactIds: setup.rawApproval.artifactIds,
    };
    const parser = z.fromJSONSchema(
      setup.registry.getDefinition(PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.get)!.schemas.output as never,
    );
    const scheduled = await dispatchCliCapability(
      "publishing_deliveries.get@1",
      input,
      setup.agentDispatcher,
    );
    expect(() => parser.parse((scheduled as { output: unknown }).output)).not.toThrow();

    const current = setup.repository.deliveries.get(`workspace_1\u0000${deliveryId}`)!;
    setup.repository.deliveries.set(`workspace_1\u0000${deliveryId}`, {
      ...current,
      state: "succeeded",
      intentDigest: `sha256:${"1".repeat(64)}`,
      providerOperationRef: "linkedin_post_1",
      latestEffectEvidenceDigest: `sha256:${"2".repeat(64)}`,
      completedAt: new Date("2026-08-08T12:02:00.000Z"),
      updatedAt: new Date("2026-08-08T12:02:00.000Z"),
    });
    const terminal = await dispatchCliCapability(
      "publishing_deliveries.get@1",
      input,
      setup.agentDispatcher,
    );
    expect(terminal).toMatchObject({
      type: "capability_result",
      output: { state: "succeeded", externallyCompleted: true },
    });
    expect(() => parser.parse((terminal as { output: unknown }).output)).not.toThrow();
  });
});
