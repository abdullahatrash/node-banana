import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const invocation = z.object({
  capability: z.enum([
    "workflow_runs.get@2",
    "workflow_run_events.list@2",
    "workflow_step_attempts.list@2",
    "workflow_run_artifacts.get@2",
    "workflow_versions.get@2",
    "usage_records.list@1",
    "cost_valuations.list@1",
    "usage_summaries.get@1",
    "budget_reservations.list@1",
    "quota_reservations.list@1",
    "quota_waits.list@1",
    "diagnostic_traces.get@1",
  ]),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

function responseStatus(category: string): number {
  if (category === "authorization") return 403;
  if (category === "not_found") return 404;
  if (category === "conflict") return 409;
  if (category === "internal") return 500;
  return 400;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/runs/capabilities", action: "read", permission: "projects:read" },
  async (request: NextRequest, authz) => {
    const selectedWorkspace = request.headers.get("x-workspace-id")?.trim();
    if (!selectedWorkspace || selectedWorkspace !== authz.workspaceId) {
      return noStoreJson(
        { success: false, error: "Workflow Run evidence is unavailable." },
        { status: 403 },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson(
        { success: false, error: "Invalid Workflow Run capability invocation." },
        { status: 400 },
      );
    }
    const parsed = invocation.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid Workflow Run capability invocation." },
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
      return noStoreJson(
        {
          success: false,
          error: response.message,
          code: response.code,
          operatorTraceRef: response.operatorTraceRef,
        },
        { status: responseStatus(response.category) },
      );
    }
    return noStoreJson({
      success: true,
      capability: `${response.capability.name}@${response.capability.version}`,
      result: response.output,
    });
  },
);
