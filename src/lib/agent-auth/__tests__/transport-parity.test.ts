import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AGENT_CURRENT_GET_IDENTITY,
  CAPABILITY_DISPATCHER,
  runCapabilityCli,
  type CapabilityResponse,
} from "@/lib/agent-tools";
import { createCapabilityMcpServer } from "@/lib/agent-tools/mcp";
import {
  AgentAuthService,
  InMemoryAgentAuthRepository,
  createAgentAuthenticatedDispatcher,
} from "@/lib/agent-auth";

describe("Agent Key CLI and stdio MCP parity", () => {
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
    const dispatcher = createAgentAuthenticatedDispatcher({
      agentKey: paired.agentKey,
      service,
      dispatcher: CAPABILITY_DISPATCHER,
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
    } finally {
      await client.close();
      await server.close();
    }
  });
});
