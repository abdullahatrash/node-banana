import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { PRODUCTION_ARTIFACT_SERVICE } from
  "@/lib/agent-runtime/artifacts";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
} from "@/lib/agent-runtime/workflows";
import { DrizzleWorkflowRevisionRepository } from
  "@/lib/agent-runtime/workflows/postgres-repository";
import {
  AesGcmWorkflowRunEventCursorCodec,
  workflowRunCursorKeysFromEnvironment,
} from "./cursor";
import { WorkflowRunExecutorRegistry } from "./executors";
import { createGeminiInvocationBoundary } from "../provider-effects";
import type {
  GeminiImageIntent,
  GeminiTextIntent,
} from "@/lib/provider-adapters/gemini/generate-content";
import { DrizzleWorkflowRunRepository } from "./postgres-repository";
import { DurableWorkflowRunQueue } from "./queue";
import { WorkflowRunService } from "./service";
import { PRODUCTION_USAGE_REPOSITORY, PRODUCTION_USAGE_SERVICE } from "../usage/production";
import {
  PRODUCTION_BUDGET_REPOSITORY,
  PRODUCTION_BUDGET_SERVICE,
} from "../budgets/production";
import { getQuotaCommitWriter, getQuotaService } from "../quotas/production";
import { productionWorkflowRunSpendQuoteCodec } from "./spend-quote";
import type { WorkflowRunStudioAssetPort } from "./types";

const PRODUCTION_STUDIO_ASSET_PORT: WorkflowRunStudioAssetPort = {
  async resolveStudioAssets({ workspaceId, assetIds }) {
    if (assetIds.length === 0) return [];
    const rows = await getDb().select({
      id: assets.id,
      checksum: assets.checksum,
      type: assets.type,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      width: assets.width,
      height: assets.height,
      durationSeconds: assets.durationSeconds,
    }).from(assets).where(and(
      eq(assets.workspaceId, workspaceId),
      inArray(assets.id, assetIds),
      isNull(assets.deletedAt),
    ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return assetIds.flatMap((assetId) => {
      const row = byId.get(assetId);
      if (!row?.checksum || !row.mimeType || row.sizeBytes === null) return [];
      return [{
        assetId: row.id,
        digest: row.checksum,
        type: row.type,
        mediaType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        durationSeconds: row.durationSeconds,
      }];
    });
  },
};

export const PRODUCTION_WORKFLOW_RUN_SERVICE = new WorkflowRunService(
  new DrizzleWorkflowRunRepository(
    getDb,
    PRODUCTION_USAGE_REPOSITORY,
    PRODUCTION_BUDGET_REPOSITORY,
    getQuotaCommitWriter(),
    productionWorkflowRunSpendQuoteCodec(),
  ),
  new DrizzleWorkflowRevisionRepository(getDb),
  new DurableWorkflowRunQueue(),
  WorkflowRunExecutorRegistry.createProduction(
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    {
      text: createGeminiInvocationBoundary<GeminiTextIntent>(),
      image: createGeminiInvocationBoundary<GeminiImageIntent>(),
    },
  ),
  new AesGcmWorkflowRunEventCursorCodec(
    workflowRunCursorKeysFromEnvironment,
  ),
  undefined,
  PRODUCTION_ARTIFACT_SERVICE,
  PRODUCTION_USAGE_SERVICE,
  PRODUCTION_BUDGET_SERVICE,
  getQuotaService(),
  productionWorkflowRunSpendQuoteCodec(),
  PRODUCTION_STUDIO_ASSET_PORT,
);

export async function executeProductionWorkflowRun(input: {
  workspaceId: string;
  runId: string;
  workerId: string;
}): Promise<{ runId: string; state: string }> {
  const run = await PRODUCTION_WORKFLOW_RUN_SERVICE.executeOne({
    workspaceId: input.workspaceId,
    runId: input.runId,
    workerId: input.workerId,
  });
  return { runId: run.id, state: run.state };
}
