import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function bearer(request: NextRequest): string | null {
  const direct = request.headers.get("x-agent-runtime-internal-secret")?.trim();
  if (direct) return direct;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim() || null
    : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function ensureAgentRuntimeInternalAuth(
  request: NextRequest,
): NextResponse<{ success: false; error: string }> | null {
  const expected =
    process.env.AGENT_RUNTIME_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { success: false, error: "Agent Runtime relay authentication is unavailable." },
      { status: 503 },
    );
  }
  const provided = bearer(request);
  if (
    !provided ||
    !timingSafeEqual(digest(provided), digest(expected))
  ) {
    return NextResponse.json(
      { success: false, error: "Unauthorized internal request." },
      { status: 401 },
    );
  }
  return null;
}
