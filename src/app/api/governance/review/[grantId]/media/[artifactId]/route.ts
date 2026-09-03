import { NextRequest, NextResponse } from "next/server";
import { PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS } from "@/lib/agent-runtime/publishing-approvals/audit-artifacts";
import { openReviewMediaToken } from "@/lib/governance/review-presentation";

export async function GET(request: NextRequest, context: { params: Promise<{ grantId: string; artifactId: string }> }) {
  const { grantId, artifactId } = await context.params;
  const token = request.nextUrl.searchParams.get("access") ?? "";
  const payload = openReviewMediaToken(token, { grantId, artifactId });
  if (!payload) return NextResponse.json({ success: false, code: "GOVERNANCE_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const bytes = await PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS.readRetainedBytes({ workspaceId: payload.workspaceId, evidence: payload.evidence });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, { headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Type": payload.evidence.mediaType,
      "Content-Length": String(bytes.byteLength),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ success: false, code: "GOVERNANCE_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
