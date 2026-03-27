import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import { listExpiringSocialAccounts } from "@/lib/social/repository";
import { tokenRefreshWorkflow } from "@/../workflows/token-refresh";
import { logger } from "@/utils/logger";

interface TokenRefreshDispatchResponse {
  success: boolean;
  summary?: {
    scanned: number;
    dispatched: number;
    failed: number;
  };
  error?: string;
}

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BUFFER_MINUTES = 15;

function getPositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getBatchSize(request: NextRequest): number {
  const queryBatch = getPositiveInteger(request.nextUrl.searchParams.get("batch"));
  const envBatch = getPositiveInteger(process.env.SOCIAL_TOKEN_REFRESH_BATCH_SIZE ?? null);

  return Math.min(MAX_BATCH_SIZE, queryBatch ?? envBatch ?? DEFAULT_BATCH_SIZE);
}

function getBufferMinutes(request: NextRequest): number {
  const queryBuffer = getPositiveInteger(request.nextUrl.searchParams.get("bufferMinutes"));
  const envBuffer = getPositiveInteger(
    process.env.SOCIAL_TOKEN_REFRESH_BUFFER_MINUTES ?? null,
  );

  return queryBuffer ?? envBuffer ?? DEFAULT_BUFFER_MINUTES;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<TokenRefreshDispatchResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const authFailure = ensureInternalSocialAuth(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const batchSize = getBatchSize(request);
    const bufferMinutes = getBufferMinutes(request);
    const expiresBefore = new Date(Date.now() + bufferMinutes * 60 * 1000);

    const expiringAccounts = await listExpiringSocialAccounts({
      expiresBefore,
      limit: batchSize,
    });

    let dispatched = 0;
    let failed = 0;

    for (const account of expiringAccounts) {
      try {
        await start(tokenRefreshWorkflow, [account.id]);
        logger.info("system", "Token refresh workflow dispatched", {
          workspaceId: account.workspaceId,
          accountId: account.id,
          provider: account.platform,
          dispatchKey: `token-refresh:${account.id}`,
          workflowRunRef: null,
        });
        dispatched += 1;
      } catch {
        logger.warn("system", "Token refresh workflow dispatch failed", {
          workspaceId: account.workspaceId,
          accountId: account.id,
          provider: account.platform,
          dispatchKey: `token-refresh:${account.id}`,
          workflowRunRef: null,
        });
        failed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: expiringAccounts.length,
        dispatched,
        failed,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to dispatch token refresh workflows",
      },
      { status: 500 },
    );
  }
}
