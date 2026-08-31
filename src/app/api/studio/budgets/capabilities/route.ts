import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  PRODUCTION_CAPABILITY_REGISTRY,
  dispatchCapability,
} from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const invocationSchema = z.object({
  capability: z.enum([
    "budget_policies.list@1",
    "budget_policy_revisions.create@1",
    "pricing_overrides.list@1",
    "pricing_overrides.create@1",
    "pricing_overrides.revoke@1",
    "spend_controls.get@1",
    "spend_controls.suspend@1",
    "spend_controls.resume@1",
  ]),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

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
  { route: "/api/studio/budgets/capabilities", action: "write" },
  async (request: NextRequest, authz) => {
    const humanContext = credentialHumanContext(request, authz);
    if (
      !humanContext ||
      (humanContext.role !== "owner" && humanContext.role !== "admin")
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Only Workspace owners and admins can manage budgets.",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson(
        { success: false, error: "Invalid Budget capability invocation." },
        { status: 400 },
      );
    }
    const parsed = invocationSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid Budget capability invocation." },
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
            "Idempotency-Key with 8 to 200 printable characters is required for this Budget mutation.",
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
