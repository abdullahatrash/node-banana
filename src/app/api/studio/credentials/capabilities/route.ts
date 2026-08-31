import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  dispatchCapability,
  PRODUCTION_CAPABILITY_REGISTRY,
} from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const invocationSchema = z
  .object({
    capability: z
      .string()
      .regex(/^credentials\.[a-z][a-z0-9_.]*@[1-9][0-9]*$/),
    input: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/credentials/capabilities", action: "write" },
  async (request: NextRequest, authz) => {
    const humanContext = credentialHumanContext(request, authz);
    if (!humanContext) {
      return noStoreJson(
        {
          success: false,
          error: "Only Workspace owners and admins can manage credentials.",
        },
        { status: 403 },
      );
    }
    const parsed = invocationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid credential capability invocation." },
        { status: 400 },
      );
    }
    const rawIdempotencyKey = request.headers.get("idempotency-key");
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
      rawIdempotencyKey,
    );
    const separator = parsed.data.capability.lastIndexOf("@");
    const definition = PRODUCTION_CAPABILITY_REGISTRY.getDefinition({
      name: parsed.data.capability.slice(0, separator),
      version: Number(parsed.data.capability.slice(separator + 1)),
    });
    if (
      definition?.idempotency.mode === "key-required" &&
      !parsedIdempotencyKey.success
    ) {
      return noStoreJson(
        {
          success: false,
          error:
            "Idempotency-Key with 8 to 200 printable characters is required for this credential mutation.",
          code: "IDEMPOTENCY_KEY_REQUIRED",
        },
        { status: 400 },
      );
    }
    const response = await dispatchCapability(parsed.data, {
      securityContext: {
        ...humanContext,
        ...(parsedIdempotencyKey.success
          ? { idempotencyKey: parsedIdempotencyKey.data }
          : {}),
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
      result: response.output,
      capability: `${response.capability.name}@${response.capability.version}`,
    });
  },
);
