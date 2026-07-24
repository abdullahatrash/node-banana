import {
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools";
import { createLifecycleTestDispatcher } from "./lifecycle-fixture";

describe("CLI and stdio MCP transport parity", () => {
  const dispatcher = createLifecycleTestDispatcher();

  it.each([
    {
      label: "success",
      cli: "fixtures.active@1",
      mcp: "fixtures.active.v1",
      code: undefined,
    },
    {
      label: "unknown capability",
      cli: "fixtures.unknown@1",
      mcp: "fixtures.unknown.v1",
      code: "CAPABILITY_NOT_FOUND",
    },
    {
      label: "retired capability",
      cli: "fixtures.retired@1",
      mcp: "fixtures.retired.v1",
      code: "CAPABILITY_VERSION_RETIRED",
    },
  ])("returns canonically equal responses for $label", async ({ cli, mcp, code }) => {
    const [cliResponse, mcpResponse] = await Promise.all([
      dispatchCliCapability(cli, {}, dispatcher),
      dispatchMcpCapability(mcp, {}, dispatcher),
    ]);

    expect(mcpResponse).toEqual(cliResponse);
    if (code) {
      expect(cliResponse).toMatchObject({
        type: "capability_error",
        code,
      });
    }
  });

  it("returns the same deprecation warning and successful result", async () => {
    const [cliResponse, mcpResponse] = await Promise.all([
      dispatchCliCapability("fixtures.deprecated@1", {}, dispatcher),
      dispatchMcpCapability("fixtures.deprecated.v1", {}, dispatcher),
    ]);

    expect(mcpResponse).toEqual(cliResponse);
    expect(cliResponse).toMatchObject({
      type: "capability_result",
      status: "completed",
      output: { ok: true },
      warnings: [
        {
          code: "CAPABILITY_VERSION_DEPRECATED",
          replacement: { name: "fixtures.active", version: 1 },
          sunsetAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("keeps retired definitions inspectable through capabilities.get@1", async () => {
    const [cliResponse, mcpResponse] = await Promise.all([
      dispatchCliCapability(
        "capabilities.get@1",
        { name: "fixtures.retired", version: 1 },
        dispatcher,
      ),
      dispatchMcpCapability(
        "capabilities.get.v1",
        { name: "fixtures.retired", version: 1 },
        dispatcher,
      ),
    ]);

    expect(mcpResponse).toEqual(cliResponse);
    expect(cliResponse).toMatchObject({
      type: "capability_result",
      output: {
        identity: { name: "fixtures.retired", version: 1 },
        lifecycle: { status: "retired", recommended: false },
      },
    });
  });
});
