import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getServerAuthSession } from "@/lib/auth/session";
import { decodeInvitationToken, GovernanceError } from "@/lib/governance/service";
import { PRODUCTION_GOVERNANCE_SERVICE } from "@/lib/governance/production";

const bodySchema = z.object({ idempotencyKey: z.string().min(8).max(200) }).strict();

function sameOrigin(request: NextRequest): boolean {
  try { return new URL(request.headers.get("origin") ?? "").origin === request.nextUrl.origin; }
  catch { return false; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ invitationToken: string }> }) {
  if (!sameOrigin(request)) return noStoreJson({ success: false, code: "FORBIDDEN" }, { status: 403 });
  const session = await getServerAuthSession(request.headers);
  if (!session?.user?.id || !session.user.email || session.user.emailVerified !== true) return noStoreJson({ success: false, code: "VERIFIED_SESSION_REQUIRED" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const { invitationToken } = await context.params;
  const decoded = decodeInvitationToken(invitationToken);
  if (!decoded) return noStoreJson({ success: false, code: "GOVERNANCE_NOT_FOUND" }, { status: 404 });
  try {
    const result = await PRODUCTION_GOVERNANCE_SERVICE.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: session.user.id, verifiedEmail: session.user.email, authContextId: session.session.id, idempotencyKey: parsed.data.idempotencyKey });
    return noStoreJson({ success: true, result });
  } catch (error) {
    if (!(error instanceof GovernanceError)) return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 500 });
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "EXPIRED" || error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400;
    return noStoreJson({ success: false, code: `GOVERNANCE_${error.code}` }, { status });
  }
}
