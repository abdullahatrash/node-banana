import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getSupportBundleApplication } from "@/lib/agent-runtime/observability/support-bundles-production";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES = 25;
const MAX_MAINTENANCE_MS = 20_000;

interface MaintenancePage {
  intents: {
    scanned: number;
    bound: number;
    abandoned: number;
    errors: number;
  };
  expired: {
    traces: number;
    metrics: number;
    bundles: number;
    grants: number;
  };
  cleanup: {
    scanned: number;
    deleted: number;
    acknowledged: number;
    errors: number;
  };
}

interface MaintenanceSummary extends MaintenancePage {
  pages: number;
  invocationErrors: number;
  continuationRequired: boolean;
  stoppedBecause:
    | "drained"
    | "iteration_limit"
    | "time_limit"
    | "partial_failure"
    | "error";
}

function positiveBoundedInteger(
  request: NextRequest,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = Number.parseInt(request.nextUrl.searchParams.get(name) ?? "", 10);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function limitFrom(request: NextRequest): number {
  return positiveBoundedInteger(request, "limit", DEFAULT_LIMIT, 100);
}

function maxPagesFrom(request: NextRequest): number {
  return positiveBoundedInteger(
    request,
    "maxPages",
    DEFAULT_MAX_PAGES,
    MAX_PAGES,
  );
}

function emptySummary(): MaintenanceSummary {
  return {
    pages: 0,
    invocationErrors: 0,
    intents: { scanned: 0, bound: 0, abandoned: 0, errors: 0 },
    expired: { traces: 0, metrics: 0, bundles: 0, grants: 0 },
    cleanup: { scanned: 0, deleted: 0, acknowledged: 0, errors: 0 },
    continuationRequired: false,
    stoppedBecause: "drained",
  };
}

function addPage(summary: MaintenanceSummary, page: MaintenancePage): void {
  summary.pages += 1;
  for (const key of ["scanned", "bound", "abandoned", "errors"] as const) {
    summary.intents[key] += page.intents[key];
  }
  for (const key of ["traces", "metrics", "bundles", "grants"] as const) {
    summary.expired[key] += page.expired[key];
  }
  for (const key of ["scanned", "deleted", "acknowledged", "errors"] as const) {
    summary.cleanup[key] += page.cleanup[key];
  }
}

function pageMayHaveMore(page: MaintenancePage, limit: number): boolean {
  return (
    page.intents.scanned >= limit ||
    page.expired.traces >= limit ||
    page.expired.metrics >= limit ||
    page.expired.bundles >= limit ||
    page.expired.grants >= limit ||
    // Cleanup combines durable intent tombstones and stored bundle locators.
    // Reaching the page size is therefore a conservative continuation signal.
    page.cleanup.scanned >= limit
  );
}

async function drainRetentionPages(input: {
  at: Date;
  limit: number;
  maxPages: number;
}): Promise<MaintenanceSummary> {
  const summary = emptySummary();
  const startedAt = Date.now();
  let mayHaveMore = true;

  while (summary.pages < input.maxPages && mayHaveMore) {
    if (summary.pages > 0 && Date.now() - startedAt >= MAX_MAINTENANCE_MS) {
      summary.continuationRequired = true;
      summary.stoppedBecause = "time_limit";
      return summary;
    }

    try {
      // Each page always runs reconciliation, expiry, and physical cleanup, so
      // consent-expired bundle cleanup cannot be starved by another source.
      const page = await getSupportBundleApplication().expireAndDrain({
        at: input.at,
        limit: input.limit,
      });
      addPage(summary, page);
      mayHaveMore = pageMayHaveMore(page, input.limit);
    } catch {
      summary.invocationErrors += 1;
      summary.continuationRequired = true;
      summary.stoppedBecause = "error";
      return summary;
    }
  }

  const hasPageErrors =
    summary.intents.errors > 0 || summary.cleanup.errors > 0;
  // Scheduled maintenance runs every minute, so bounded work signalled here is
  // picked up automatically by the next invocation without an hourly gap.
  summary.continuationRequired = mayHaveMore || hasPageErrors;
  summary.stoppedBecause = mayHaveMore
    ? "iteration_limit"
    : hasPageErrors
      ? "partial_failure"
      : "drained";
  return summary;
}

async function runRetentionMaintenance(request: NextRequest) {
  const authFailure = ensureInternalStudioOrCronAuth(request);
  if (authFailure) return authFailure;

  if (!isDatabaseConfigured()) {
    return noStoreJson(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }
  try {
    const result = await drainRetentionPages({
      at: new Date(),
      limit: limitFrom(request),
      maxPages: maxPagesFrom(request),
    });
    if (
      result.stoppedBecause === "error" ||
      result.invocationErrors > 0 ||
      result.intents.errors > 0 ||
      result.cleanup.errors > 0
    ) {
      return noStoreJson(
        {
          success: false,
          code: "OBSERVABILITY_RETENTION_UNAVAILABLE",
          error: "Observability retention cleanup is temporarily unavailable.",
          summary: result,
        },
        { status: 503 },
      );
    }
    return noStoreJson({ success: true, summary: result });
  } catch {
    return noStoreJson(
      {
        success: false,
        code: "OBSERVABILITY_RETENTION_UNAVAILABLE",
        error: "Observability retention cleanup is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}

// Vercel Cron invokes Route Handlers with GET. POST remains available for
// authenticated manual operations and retries.
export const GET = runRetentionMaintenance;
export const POST = runRetentionMaintenance;
