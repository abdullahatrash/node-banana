import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { runProductionGovernanceSweep } from "@/lib/governance/sweeper";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

function bounded(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, error: "DATABASE_URL is not configured." }, { status: 503 });
  const authFailure = ensureInternalStudioOrCronAuth(request);
  if (authFailure) return authFailure;
  const summary = await runProductionGovernanceSweep({
    workspaceLimit: bounded(request.nextUrl.searchParams.get("workspaces"), 100, 500),
    maxJobsPerWorkspace: bounded(request.nextUrl.searchParams.get("jobs"), 200, 1_000),
  });
  return noStoreJson({ success: true, summary });
}

export const GET = handle;
export const POST = handle;
