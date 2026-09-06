import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  PRODUCTION_CAPABILITY_REGISTRY,
  dispatchCapability,
} from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const invocationSchema = z
  .object({
    capability: z.enum([
      "operational_metrics.list@1",
      "observability_retention.get@1",
      "observability_retention.set@1",
      "telemetry_operator_grants.list@1",
      "telemetry_operator_grants.issue@1",
      "telemetry_operator_grants.revoke@1",
      "diagnostic_traces.get@1",
      "support_bundles.create@1",
      "support_bundles.get@1",
      "support_bundles.payload.get@1",
      "support_bundles.revoke@1",
      "support_bundle_audit.list@1",
    ]),
    input: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

function responseStatus(category: string): number {
  if (category === "authorization") return 403;
  if (category === "not_found") return 404;
  if (category === "conflict") return 409;
  if (category === "internal") return 500;
  return 400;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/observability/capabilities", action: "write", permission: "workspaces:write" },
  async (request: NextRequest, authz) => {
    const humanContext = credentialHumanContext(request, authz);
    if (!humanContext) {
      return noStoreJson(
        { success: false, error: "Observability access is not authorized." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson(
        { success: false, error: "Invalid observability capability invocation." },
        { status: 400 },
      );
    }
    const parsed = invocationSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid observability capability invocation." },
        { status: 400 },
      );
    }

    const separator = parsed.data.capability.lastIndexOf("@");
    const definition = PRODUCTION_CAPABILITY_REGISTRY.getDefinition({
      name: parsed.data.capability.slice(0, separator),
      version: Number(parsed.data.capability.slice(separator + 1)),
    });
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (
      definition?.idempotency.mode === "key-required" &&
      !idempotencyKey.success
    ) {
      return noStoreJson(
        {
          success: false,
          code: "IDEMPOTENCY_KEY_REQUIRED",
          error:
            "Idempotency-Key with 8 to 200 printable characters is required for this observability mutation.",
        },
        { status: 400 },
      );
    }

    const response = await dispatchCapability(parsed.data, {
      securityContext: {
        ...humanContext,
        ...(idempotencyKey.success
          ? { idempotencyKey: idempotencyKey.data }
          : {}),
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
