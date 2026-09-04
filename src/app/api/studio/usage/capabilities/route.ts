import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const invocation = z.object({
  capability: z.enum([
    "usage_records.get@1",
    "usage_records.list@1",
    "cost_valuations.get@1",
    "cost_valuations.list@1",
    "usage_summaries.get@1",
    "usage_events.list@1",
    "agent_usage.get@1",
  ]),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/usage/capabilities", action: "read", permission: "workspaces:read" },
  async (request: NextRequest, authz) => {
    const selectedWorkspace = request.headers.get("x-workspace-id")?.trim();
    if (!selectedWorkspace || selectedWorkspace !== authz.workspaceId) {
      return noStoreJson(
        { success: false, error: "Usage evidence is unavailable." },
        { status: 403 },
      );
    }
    const parsed = invocation.safeParse(await request.json());
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid usage capability invocation." },
        { status: 400 },
      );
    }
    const response = await dispatchCapability(parsed.data, {
      securityContext: {
        kind: "human",
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        role: authz.role,
      },
    });
    if (response.type === "capability_error") {
      const status =
        response.category === "authorization"
          ? 403
          : response.category === "not_found"
            ? 404
            : response.category === "conflict"
              ? 409
              : response.category === "internal"
                ? 500
                : 400;
      return noStoreJson(
        {
          success: false,
          error: response.message,
          code: response.code,
          operatorTraceRef: response.operatorTraceRef,
        },
        { status },
      );
    }
    return noStoreJson({
      success: true,
      capability: `${response.capability.name}@${response.capability.version}`,
      result: response.output,
    });
  },
);
