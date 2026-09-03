import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { GovernanceError } from "@/lib/governance/service";
import { PRODUCTION_GOVERNANCE_SERVICE } from "@/lib/governance/production";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), workspaceId: z.string().min(1).max(200), token: z.string().min(32).max(100), code: z.string().regex(/^\d{6}$/), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.literal("decide"), workspaceId: z.string().min(1).max(200), sessionId: z.string().min(1).max(200), sessionToken: z.string().min(32).max(100), resourceId: z.string().min(1).max(200), revisionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), decision: z.enum(["comment", "accept", "approve", "reject"]), comment: z.string().max(2000).nullable(), idempotencyKey: z.string().min(8).max(200) }).strict(),
]);

function sameOrigin(request: NextRequest): boolean {
  try { return new URL(request.headers.get("origin") ?? "").origin === request.nextUrl.origin; } catch { return false; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ grantId: string }> }) {
  if (!sameOrigin(request)) return noStoreJson({ success: false, code: "FORBIDDEN" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const { grantId } = await context.params;
  try {
    const result = parsed.data.action === "verify"
      ? await PRODUCTION_GOVERNANCE_SERVICE.verifyReviewGuest({ ...parsed.data, grantId })
      : await PRODUCTION_GOVERNANCE_SERVICE.decideReviewGuest({ ...parsed.data, grantId });
    return noStoreJson({ success: true, result });
  } catch (error) {
    if (!(error instanceof GovernanceError)) return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 500 });
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" || error.code === "EXPIRED" ? 403 : error.code === "CONFLICT" ? 409 : 400;
    return noStoreJson({ success: false, code: `GOVERNANCE_${error.code}` }, { status });
  }
}
