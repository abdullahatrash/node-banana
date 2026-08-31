import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureAgentRuntimeInternalAuth } from
  "@/lib/agent-runtime/internal-auth";
import { PRODUCTION_PUBLISHING_DELIVERY_EXECUTION } from
  "@/lib/agent-runtime/publishing-deliveries/production";

export const runtime = "nodejs";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;

function batchSize(request: NextRequest): number {
  const query = Number.parseInt(
    request.nextUrl.searchParams.get("batch") ?? "",
    10,
  );
  const configured = Number.parseInt(
    process.env.PUBLISHING_DELIVERY_RELAY_BATCH_SIZE ?? "",
    10,
  );
  const value = Number.isFinite(query)
    ? query
    : Number.isFinite(configured)
      ? configured
      : DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, value));
}

async function relay(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "Publishing Delivery persistence is unavailable." },
      { status: 503 },
    );
  }
  const authFailure = ensureAgentRuntimeInternalAuth(request);
  if (authFailure) return authFailure;

  let delivered = 0;
  try {
    for (let index = 0; index < batchSize(request); index += 1) {
      const result =
        await PRODUCTION_PUBLISHING_DELIVERY_EXECUTION.relayNext();
      if (!result.delivered) break;
      delivered += 1;
    }
    return NextResponse.json({ success: true, delivered });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Publishing Delivery scheduling is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}

export const GET = relay;
export const POST = relay;
