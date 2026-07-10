import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

import { ToolError } from "../errors";
import { runTool } from "../runtime";
import type { ToolDefinition } from "../types";

function sessionWithRole(role: "owner" | "member"): ContentOSSession {
  return {
    user: { id: `apitoken:ws_1`, name: null, email: null },
    workspace: { id: "ws_1", organizationId: null },
    role,
    planTier: "free",
    permissions: getPermissionsForRole(role),
  };
}

const echoTool: ToolDefinition<
  z.ZodObject<{ value: z.ZodString }>,
  z.ZodObject<{ echoed: z.ZodString; workspaceId: z.ZodString }>
> = {
  name: "echo",
  description: "Echoes its input scoped to the caller's workspace.",
  requiredPermission: "assets:read",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ echoed: z.string(), workspaceId: z.string() }),
  handler: async (input, ctx) => ({
    echoed: input.value,
    workspaceId: ctx.session.workspace.id,
  }),
};

describe("runTool", () => {
  it("validates input, runs the handler, and returns schema-valid output", async () => {
    const result = await runTool(
      echoTool,
      { value: "hello" },
      { session: sessionWithRole("owner") },
    );

    expect(result).toEqual({ echoed: "hello", workspaceId: "ws_1" });
  });

  it("scopes the handler to the session's workspace", async () => {
    const session = sessionWithRole("owner");
    session.workspace.id = "ws_other";

    const result = await runTool(echoTool, { value: "x" }, { session });

    expect(result.workspaceId).toBe("ws_other");
  });

  it("throws a structured invalid_input error when input fails the schema", async () => {
    await expect(
      runTool(
        echoTool,
        { value: 123 } as unknown as { value: string },
        { session: sessionWithRole("owner") },
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fix: expect.any(String),
    });
  });

  it("denies access with a forbidden error when the role lacks the permission", async () => {
    const restrictedTool: ToolDefinition = {
      ...echoTool,
      // members do not have assets:delete
      requiredPermission: "assets:delete",
    };

    const error = await runTool(
      restrictedTool,
      { value: "hi" },
      { session: sessionWithRole("member") },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("forbidden");
    expect((error as ToolError).toStructured()).toMatchObject({
      code: "forbidden",
      message: expect.any(String),
      fix: expect.any(String),
    });
  });

  it("wraps an unexpected handler throw in a structured internal error", async () => {
    const boomTool: ToolDefinition = {
      ...echoTool,
      handler: async () => {
        throw new Error("database exploded");
      },
    };

    const error = await runTool(
      boomTool,
      { value: "hi" },
      { session: sessionWithRole("owner") },
    ).catch((e) => e);

    expect((error as ToolError).code).toBe("internal");
    expect((error as ToolError).message).toContain("database exploded");
  });

  it("passes a handler-thrown ToolError through unchanged", async () => {
    const notFoundTool: ToolDefinition = {
      ...echoTool,
      handler: async () => {
        throw new ToolError({
          code: "not_found",
          message: "No such thing.",
          fix: "Check the id.",
        });
      },
    };

    const error = await runTool(
      notFoundTool,
      { value: "hi" },
      { session: sessionWithRole("owner") },
    ).catch((e) => e);

    expect((error as ToolError).code).toBe("not_found");
    expect((error as ToolError).message).toBe("No such thing.");
  });

  it("raises invalid_output when the handler returns schema-invalid data", async () => {
    const badOutputTool: ToolDefinition = {
      ...echoTool,
      handler: async () => ({ echoed: "ok" }) as unknown as {
        echoed: string;
        workspaceId: string;
      },
    };

    const error = await runTool(
      badOutputTool,
      { value: "hi" },
      { session: sessionWithRole("owner") },
    ).catch((e) => e);

    expect((error as ToolError).code).toBe("invalid_output");
  });
});
