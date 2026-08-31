import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import {
  AGENT_CURRENT_GET_IDENTITY,
  COMMON_DISCOVERY_ERRORS,
  CapabilityDispatcher,
  QUERY_EFFECT,
  authorizationContractDigestFor,
  createCapabilityRegistry,
  defineCapability,
  runCapabilityCli,
  type CapabilityResponse,
} from "@/lib/agent-tools";
import { PRODUCTION_CAPABILITY_REGISTRY as CAPABILITY_REGISTRY } from "@/lib/agent-runtime/server-dispatcher";
import { createCapabilityMcpServer } from "@/lib/agent-tools/mcp";
import {
  AgentAuthService,
  InMemoryAgentAuthRepository,
  createAgentAuthenticatedDispatcher,
} from "@/lib/agent-auth";
import {
  AgentAuthorizationService,
  EMPTY_RESOURCE_CONSTRAINTS,
  InMemoryAgentAuthorizationRepository,
} from "@/lib/agent-authorization";

describe("Agent Key CLI and stdio MCP parity", () => {
  it.each(["missing", "invalid", "expired"] as const)(
    "returns no fabricated diagnostic reference for a %s Agent Key",
    async (scenario) => {
      let now = new Date("2026-08-08T12:00:00.000Z");
      const repository = new InMemoryAgentAuthRepository();
      repository.addMembership("workspace-safe", "owner-safe", "owner");
      const service = new AgentAuthService(
        repository,
        { now: () => new Date(now) },
        { 1: "transport-null-trace-pepper" },
      );
      let agentKey: string | null | undefined =
        scenario === "missing" ? undefined : "invalid-agent-key";
      const authorizationRepository =
        new InMemoryAgentAuthorizationRepository();
      if (scenario === "expired") {
        const challenge = await service.createPairingChallenge({
          agentName: "Expired transport fixture",
          requestedAccess: ["fixtures.agent_auth"],
        });
        await service.approvePairing({
          challenge: challenge.challenge,
          workspaceId: "workspace-safe",
          sponsorUserId: "owner-safe",
        });
        const paired = await service.redeemPairing({
          challenge: challenge.challenge,
          keyExpiresAt: new Date(now.getTime() + 1_000),
        });
        agentKey = paired.agentKey;
        authorizationRepository.principals.set(
          paired.principal.id,
          repository.principals.get(paired.principal.id)!,
        );
        authorizationRepository.keys.set(
          paired.key.id,
          repository.keys.get(paired.key.id)!,
        );
        now = new Date(now.getTime() + 2_000);
      }
      const authorization = new AgentAuthorizationService(
        authorizationRepository,
        { now: () => new Date(now) },
      );
      let handlerCalls = 0;
      const registry = createCapabilityRegistry([
        defineCapability({
          identity: { name: "fixtures.agent_auth", version: 1 },
          summary: "Agent authentication transport fixture.",
          lifecycle: {
            status: "active",
            introducedAt: "2026-08-08T00:00:00.000Z",
            recommended: true,
          },
          input: z.object({}).strict(),
          outputSchema: { type: "object" },
          effect: QUERY_EFFECT,
          approval: { mode: "none" },
          idempotency: { mode: "retry-safe" },
          authorization: { resources: [] },
          errors: COMMON_DISCOVERY_ERRORS,
          handler: () => {
            handlerCalls += 1;
            return { ok: true };
          },
        }),
      ]);
      const dispatcher = createAgentAuthenticatedDispatcher({
        agentKey,
        service,
        dispatcher: new CapabilityDispatcher(registry, authorization),
      });

      let stdout = "";
      let stderr = "";
      const cliExit = await runCapabilityCli(
        ["call", "fixtures.agent_auth@1", "--input", "{}"],
        {
          dispatcher,
          io: {
            stdout: (text) => { stdout += text; },
            stderr: (text) => { stderr += text; },
          },
        },
      );
      const cliResponse = JSON.parse(stdout) as CapabilityResponse;

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const server = createCapabilityMcpServer(dispatcher);
      const client = new Client(
        { name: `agent-auth-${scenario}`, version: "1.0.0" },
        { capabilities: {} },
      );
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const mcp = await client.callTool({
          name: "fixtures.agent_auth.v1",
          arguments: {},
        });
        expect(cliExit).toBe(1);
        expect(stderr).toBe("");
        expect(mcp.isError).toBe(true);
        expect(mcp.structuredContent).toEqual(cliResponse);
        expect(cliResponse).toMatchObject({
          type: "capability_error",
          code: "CAPABILITY_NOT_AUTHORIZED",
          category: "authorization",
          message:
            "Capability fixtures.agent_auth@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
          retryable: false,
          operatorTraceRef: null,
        });
        expect(JSON.stringify({ cliResponse, mcp: mcp.structuredContent }))
          .not.toMatch(/otr_[a-f0-9]{32}/);
        expect(handlerCalls).toBe(0);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it("resolves the same server-owned Principal and Workspace without identity input", async () => {
    const repository = new InMemoryAgentAuthRepository();
    repository.addMembership("workspace-parity", "human-parity", "admin");
    const service = new AgentAuthService(
      repository,
      { now: () => new Date("2026-07-24T13:00:00.000Z") },
      { 1: "transport-parity-agent-pepper" },
    );
    const challenge = await service.createPairingChallenge({
      agentName: "Parity Agent",
      requestedAccess: ["content.read"],
    });
    await service.approvePairing({
      challenge: challenge.challenge,
      workspaceId: "workspace-parity",
      sponsorUserId: "human-parity",
    });
    const paired = await service.redeemPairing({
      challenge: challenge.challenge,
    });
    const authorizationRepository =
      new InMemoryAgentAuthorizationRepository();
    const authorizationService = new AgentAuthorizationService(
      authorizationRepository,
      { now: () => new Date("2026-07-24T13:00:00.000Z") },
    );
    authorizationRepository.addAdministrator(
      "workspace-parity",
      "human-parity",
    );
    const principal = repository.principals.get(paired.principal.id)!;
    const key = repository.keys.get(paired.key.id)!;
    authorizationRepository.principals.set(principal.id, principal);
    authorizationRepository.keys.set(key.id, key);
    key.authorizationScopes = [
      {
        capability: "agents.current.get@1",
        authorizationContractDigest: authorizationContractDigestFor(
          AGENT_CURRENT_GET_IDENTITY,
          CAPABILITY_REGISTRY.getRegistration(AGENT_CURRENT_GET_IDENTITY)!
            .authorization,
        ),
        resources: EMPTY_RESOURCE_CONSTRAINTS,
      },
    ];
    const definition = CAPABILITY_REGISTRY.getDefinition(
      AGENT_CURRENT_GET_IDENTITY,
    )!;
    const grants = [
      {
        capability: "agents.current.get@1",
        authorizationContractDigest: authorizationContractDigestFor(
          AGENT_CURRENT_GET_IDENTITY,
          CAPABILITY_REGISTRY.getRegistration(AGENT_CURRENT_GET_IDENTITY)!
            .authorization,
        ),
        resources: EMPTY_RESOURCE_CONSTRAINTS,
      },
    ];
    await authorizationService.putWorkspacePolicy({
      workspaceId: "workspace-parity",
      enabled: true,
      grants,
      actorUserId: "human-parity",
    });
    await authorizationService.createGrantSet({
      workspaceId: "workspace-parity",
      principalId: paired.principal.id,
      name: "Transport parity",
      grants,
      actorUserId: "human-parity",
    });
    const dispatcher = createAgentAuthenticatedDispatcher({
      agentKey: paired.agentKey,
      service,
      dispatcher: new CapabilityDispatcher(
        CAPABILITY_REGISTRY,
        authorizationService,
      ),
    });

    let stdout = "";
    let stderr = "";
    const cliExit = await runCapabilityCli(
      ["call", "agents.current.get@1", "--input", "{}"],
      {
        dispatcher,
        io: {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
        },
      },
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createCapabilityMcpServer(dispatcher);
    const client = new Client(
      { name: "agent-auth-parity", version: "1.0.0" },
      { capabilities: {} },
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const mcpResult = await client.callTool({
        name: "agents.current.get.v1",
        arguments: {},
      });
      const cliResponse = JSON.parse(stdout) as CapabilityResponse;

      expect(cliExit).toBe(0);
      expect(stderr).toBe("");
      expect(mcpResult.structuredContent).toEqual(cliResponse);
      expect(cliResponse).toMatchObject({
        type: "capability_result",
        capability: AGENT_CURRENT_GET_IDENTITY,
        output: {
          principalId: paired.principal.id,
          workspaceId: "workspace-parity",
          keyId: paired.key.id,
        },
      });
      expect(JSON.stringify(cliResponse)).not.toContain("sponsorUserId");

      authorizationRepository.policies.get("workspace-parity")!.enabled =
        false;
      stdout = "";
      stderr = "";
      const deniedCliExit = await runCapabilityCli(
        ["call", "agents.current.get@1", "--input", "{}"],
        {
          dispatcher,
          io: {
            stdout: (text) => {
              stdout += text;
            },
            stderr: (text) => {
              stderr += text;
            },
          },
        },
      );
      const deniedMcp = await client.callTool({
        name: "agents.current.get.v1",
        arguments: {},
      });
      const deniedCli = JSON.parse(stdout) as CapabilityResponse;
      const deniedMcpResponse =
        deniedMcp.structuredContent as CapabilityResponse;
      expect(deniedCliExit).toBe(1);
      expect(deniedMcp.isError).toBe(true);
      expect(deniedCli).toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
        category: "authorization",
      });
      const {
        operatorTraceRef: _cliTrace,
        ...deniedCliWithoutTrace
      } = deniedCli as Extract<CapabilityResponse, { type: "capability_error" }>;
      const {
        operatorTraceRef: _mcpTrace,
        ...deniedMcpWithoutTrace
      } = deniedMcpResponse as Extract<
        CapabilityResponse,
        { type: "capability_error" }
      >;
      expect(deniedMcpWithoutTrace).toEqual(deniedCliWithoutTrace);
      expect(authorizationRepository.decisions).toHaveLength(4);
      expect(
        authorizationRepository.decisions.slice(-2).map((decision) => ({
          outcome: decision.outcome,
          reason: decision.reason,
          resources: decision.resources,
        })),
      ).toEqual([
        {
          outcome: "denied",
          reason: "workspace_policy_denied",
          resources: [],
        },
        {
          outcome: "denied",
          reason: "workspace_policy_denied",
          resources: [],
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
