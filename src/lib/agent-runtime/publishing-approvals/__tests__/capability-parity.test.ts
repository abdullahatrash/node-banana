import { dispatchCliCapability, dispatchMcpCapability, listMcpCapabilityTools } from "@/lib/agent-tools/adapters";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import { createCapabilityRegistry, createDiscoveryRegistrations } from "@/lib/agent-tools/registry";
import type { CapabilityAuthorizationRequest, CapabilityAuthorizer } from "@/types/agentAuthorization";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPublishingApprovalRegistrations, PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES } from "../capabilities";
import { setupPublishingApprovals } from "./fixtures";

async function capabilitySetup() {
  const setup = await setupPublishingApprovals();
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createPublishingApprovalRegistrations(setup.service),
  ]);
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request: CapabilityAuthorizationRequest) => ({
      allowed: true,
      operatorTraceRef: "approval_request_auth_1",
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
      dispatcher.dispatch(invocation, { securityContext: { kind: "agent" as const, workspaceId: "workspace_1", principalId: "principal_1", keyId: "key_1" } }),
  };
  return { ...setup, registry, dispatcher, agentDispatcher };
}

function requestInput(revisionId: string) {
  return {
    idempotencyKey: "approval-capability-request",
    revisionId,
    action: "publish",
    targetIds: ["target_1"],
    channelIds: ["channel_linkedin"],
    artifactIds: ["artifact_text", "artifact_image"],
    expiresAt: "2026-08-08T12:30:00.000Z",
  };
}

describe("Publishing Approval CLI/MCP parity", () => {
  it("publishes closed request schemas with exact Channel and Artifact authorization", async () => {
    const setup = await capabilitySetup();
    const registration = setup.registry.getRegistration(PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request)!;
    expect(registration.authorization.resources).toEqual([
      { kind: "channel", inputPath: "channelIds" },
      { kind: "artifact", inputPath: "artifactIds" },
    ]);
    expect((setup.registry.getDefinition(PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request)!.schemas.input as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    const tools = await listMcpCapabilityTools(setup.agentDispatcher);
    expect(tools.some((tool) => tool.name === "publishing_approvals.request.v1")).toBe(true);
  });

  it("returns the same pending transport result without claiming Approval", async () => {
    const setup = await capabilitySetup();
    const input = requestInput(setup.revision.id);
    const cli = await dispatchCliCapability("publishing_approvals.request@1", input, setup.agentDispatcher);
    const mcp = await dispatchMcpCapability("publishing_approvals.request.v1", input, setup.agentDispatcher);
    expect(mcp).toEqual(cli);
    expect(cli).toMatchObject({ type: "capability_result", output: { status: "pending", decision: null, authorizesExecution: false } });
    const serialized = JSON.stringify(cli);
    expect(serialized).not.toContain("requestAuthorization");
    expect(serialized).not.toContain("requestingKeyId");
    const output = (cli as { output: unknown }).output;
    expect(() => z.fromJSONSchema(setup.registry.getDefinition(PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request)!.schemas.output as never).parse(output)).not.toThrow();
  });

  it("keeps final Agent observation inside schema without leaking the Human or authority evidence", async () => {
    const setup = await capabilitySetup();
    const full = await setup.service.request({ ...setup.requestInput(), idempotencyKey: "approval-final-agent-view" });
    await setup.service.decide({ workspaceId: "workspace_1", userId: "owner_1", idempotencyKey: "approval-final-decision", approvalRequestId: full.id, expectedInspectionDigest: full.inspectionDigest, decision: "approved" });
    const response = await dispatchCliCapability("publishing_approvals.get@1", { approvalRequestId: full.id, channelIds: ["channel_linkedin"], artifactIds: ["artifact_text", "artifact_image"] }, setup.agentDispatcher);
    expect(response).toMatchObject({ type: "capability_result", output: { status: "approved", decision: { decision: "approved", authorizesExecution: false }, authorizesExecution: false } });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("owner_1");
    expect(serialized).not.toContain("grant_channel_linkedin");
    expect(serialized).not.toContain("approval_authority_evidence_1");
    expect(() => z.fromJSONSchema(setup.registry.getDefinition(PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.get)!.schemas.output as never).parse((response as { output: unknown }).output)).not.toThrow();
  });

  it("proves an Agent cannot decide through CLI or MCP even with allowed transport admission", async () => {
    const setup = await capabilitySetup();
    const requested = await dispatchCliCapability("publishing_approvals.request@1", requestInput(setup.revision.id), setup.agentDispatcher);
    const output = (requested as { output: { id: string } }).output;
    const input = { approvalRequestId: output.id, expectedInspectionDigest: `sha256:${"a".repeat(64)}`, decision: "approved" };
    const cli = await dispatchCliCapability("publishing_approvals.decide@1", input, setup.agentDispatcher);
    const mcp = await dispatchMcpCapability("publishing_approvals.decide.v1", input, setup.agentDispatcher);
    expect(cli).toMatchObject({ type: "capability_error", code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED" });
    expect(mcp).toEqual(cli);
    expect(setup.repository.requests.values().next().value!.decision).toBeNull();
  });

  it("self-scopes Agent observation and binds the exact requested manifests rather than a broader grant", async () => {
    const setup = await capabilitySetup();
    const requested = await dispatchCliCapability("publishing_approvals.request@1", requestInput(setup.revision.id), setup.agentDispatcher);
    const approvalId = (requested as { output: { id: string } }).output.id;
    const get = await dispatchCliCapability("publishing_approvals.get@1", { approvalRequestId: approvalId, channelIds: ["channel_linkedin"], artifactIds: ["artifact_text", "artifact_image"] }, setup.agentDispatcher);
    expect(get).toMatchObject({ type: "capability_result", output: { id: approvalId } });
    const narrow = await dispatchCliCapability("publishing_approvals.get@1", { approvalRequestId: approvalId, channelIds: ["channel_linkedin"], artifactIds: ["artifact_text"] }, setup.agentDispatcher);
    expect(narrow).toMatchObject({ type: "capability_error", code: "PUBLISHING_APPROVAL_NOT_FOUND" });
  });
});
