import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CAPABILITY_LIST_IDENTITY,
  runCapabilityCli,
  type CapabilityResponse,
} from "@/lib/agent-tools";
import { createCapabilityMcpServer } from "@/lib/agent-tools/mcp";
import { createLifecycleTestDispatcher } from "./lifecycle-fixture";

describe("production CLI and stdio MCP composition parity", () => {
  const dispatcher = createLifecycleTestDispatcher();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createCapabilityMcpServer(dispatcher);
  const client = new Client(
    { name: "capability-parity-test", version: "1.0.0" },
    { capabilities: {} },
  );

  beforeAll(async () => {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function callCli(
    exactCapability: string,
  ): Promise<{ exitCode: number; response: CapabilityResponse }> {
    let stdout = "";
    let stderr = "";
    const exitCode = await runCapabilityCli(
      ["call", exactCapability, "--input", "{}"],
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
    expect(stderr).toBe("");
    return {
      exitCode,
      response: JSON.parse(stdout) as CapabilityResponse,
    };
  }

  function withoutOperatorTraceRef(response: CapabilityResponse) {
    if (response.type !== "capability_error") return response;
    const { operatorTraceRef: _operatorTraceRef, ...canonical } = response;
    return canonical;
  }

  it.each([
    {
      label: "success",
      cli: "fixtures.active@1",
      mcp: "fixtures.active.v1",
      errorCode: undefined,
    },
    {
      label: "unknown capability",
      cli: "fixtures.unknown@1",
      mcp: "fixtures.unknown.v1",
      errorCode: "CAPABILITY_NOT_FOUND",
    },
    {
      label: "deprecated capability",
      cli: "fixtures.deprecated@1",
      mcp: "fixtures.deprecated.v1",
      errorCode: undefined,
    },
    {
      label: "retired capability",
      cli: "fixtures.retired@1",
      mcp: "fixtures.retired.v1",
      errorCode: "CAPABILITY_VERSION_RETIRED",
    },
  ])(
    "preserves canonical response and transport framing for $label",
    async ({ cli, mcp, errorCode }) => {
      const [cliResult, mcpResult] = await Promise.all([
        callCli(cli),
        client.callTool({ name: mcp, arguments: {} }),
      ]);
      const mcpResponse = mcpResult.structuredContent as
        | CapabilityResponse
        | undefined;

      expect(withoutOperatorTraceRef(mcpResponse!)).toEqual(
        withoutOperatorTraceRef(cliResult.response),
      );
      expect(mcpResult.isError ?? false).toBe(Boolean(errorCode));
      expect(cliResult.exitCode).toBe(errorCode ? 1 : 0);
      const content = mcpResult.content as Array<{
        type: string;
        text?: string;
      }>;
      expect(JSON.parse(content[0].text as string)).toEqual(mcpResponse);

      if (errorCode) {
        expect(cliResult.response).toMatchObject({
          type: "capability_error",
          code: errorCode,
          operatorTraceRef: null,
        });
        expect(mcpResponse).toMatchObject({
          type: "capability_error",
          operatorTraceRef: null,
        });
      }
      if (cli === "fixtures.deprecated@1") {
        expect(cliResult.response).toMatchObject({
          type: "capability_result",
          warnings: [
            {
              code: "CAPABILITY_VERSION_DEPRECATED",
              replacement: { name: "fixtures.active", version: 1 },
              sunsetAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }
    },
  );

  it("derives CLI tools and MCP ListTools metadata through capabilities.list@1", async () => {
    const dispatch = vi.spyOn(dispatcher, "dispatch");
    let cliOutput = "";
    const cliExit = await runCapabilityCli(["tools"], {
      dispatcher,
      io: {
        stdout: (text) => {
          cliOutput += text;
        },
        stderr: () => undefined,
      },
    });
    const mcpTools = await client.listTools();

    expect(cliExit).toBe(0);
    expect(cliOutput).toContain("capabilities.list@1");
    expect(mcpTools.tools.map((tool) => tool.name)).toContain(
      "capabilities.list.v1",
    );
    expect(
      dispatch.mock.calls.filter(
        ([invocation]) =>
          typeof invocation.capability !== "string" &&
          invocation.capability.name === CAPABILITY_LIST_IDENTITY.name &&
          invocation.capability.version === CAPABILITY_LIST_IDENTITY.version,
      ),
    ).toHaveLength(2);
  });

  it("keeps retired definitions inspectable through both real framings", async () => {
    let cliStdout = "";
    const cliExit = await runCapabilityCli(
      [
        "call",
        "capabilities.get@1",
        "--input",
        '{"name":"fixtures.retired","version":1}',
      ],
      {
        dispatcher,
        io: {
          stdout: (text) => {
            cliStdout += text;
          },
          stderr: () => undefined,
        },
      },
    );
    const mcpResult = await client.callTool({
      name: "capabilities.get.v1",
      arguments: { name: "fixtures.retired", version: 1 },
    });
    const cliResponse = JSON.parse(cliStdout);

    expect(cliExit).toBe(0);
    expect(mcpResult.isError ?? false).toBe(false);
    expect(mcpResult.structuredContent).toEqual(cliResponse);
    expect(cliResponse).toMatchObject({
      type: "capability_result",
      output: {
        identity: { name: "fixtures.retired", version: 1 },
        lifecycle: { status: "retired", recommended: false },
      },
    });
  });
});
