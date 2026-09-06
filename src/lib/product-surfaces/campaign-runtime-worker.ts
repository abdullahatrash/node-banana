import "server-only";

import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { PRODUCTION_WORKFLOW_RUN_SERVICE } from "@/lib/agent-runtime/runs/production";
import { productionWorkflowRunSpendQuoteCodec } from "@/lib/agent-runtime/runs/spend-quote";
import { getDb } from "@/lib/db";
import { productRuntimeScanCheckpoints, workspaceProductRecords } from "@/lib/db/schema";
import { BlitzReplenisher } from "./blitz-replenisher";
import { PRODUCTION_BLITZ_REPLENISHMENT_REPOSITORY } from "./blitz-replenishment-repository";
import { CampaignOccurrenceScheduler } from "./campaign-scheduler";
import { PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY } from "./campaign-scheduler-repository";
import { ProductCampaignRuntimeWorker } from "./campaign-runtime-worker-service";

const SCAN_KEY = "campaign-runtime/v1";
const PAGE_SIZE = 50;

type CampaignRow = typeof workspaceProductRecords.$inferSelect;

export async function claimCampaignPage(at: Date): Promise<CampaignRow[]> {
  return getDb().transaction(async (tx) => {
    const [checkpoint] = await tx.select().from(productRuntimeScanCheckpoints).where(eq(productRuntimeScanCheckpoints.scanKey, SCAN_KEY)).limit(1).for("update");
    const after = checkpoint?.cursorAt && checkpoint.cursorId
      ? or(gt(workspaceProductRecords.updatedAt, checkpoint.cursorAt), and(eq(workspaceProductRecords.updatedAt, checkpoint.cursorAt), gt(workspaceProductRecords.id, checkpoint.cursorId)))
      : undefined;
    const rows = await tx.select().from(workspaceProductRecords).where(and(
      eq(workspaceProductRecords.kind, "campaign_automation"), eq(workspaceProductRecords.state, "active"), isNull(workspaceProductRecords.archivedAt), after,
    )).orderBy(asc(workspaceProductRecords.updatedAt), asc(workspaceProductRecords.id)).limit(PAGE_SIZE);
    const last = rows.at(-1);
    await tx.insert(productRuntimeScanCheckpoints).values({ scanKey: SCAN_KEY, cursorAt: rows.length === PAGE_SIZE && last ? last.updatedAt : null, cursorId: rows.length === PAGE_SIZE && last ? last.id : null, updatedAt: at }).onConflictDoUpdate({ target: productRuntimeScanCheckpoints.scanKey, set: { cursorAt: rows.length === PAGE_SIZE && last ? last.updatedAt : null, cursorId: rows.length === PAGE_SIZE && last ? last.id : null, updatedAt: at } });
    return rows;
  });
}

export const PRODUCT_CAMPAIGN_RUNTIME_WORKER = new ProductCampaignRuntimeWorker(
  PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY,
  new CampaignOccurrenceScheduler(PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY, PRODUCTION_WORKFLOW_RUN_SERVICE, productionWorkflowRunSpendQuoteCodec()),
  new BlitzReplenisher(PRODUCTION_BLITZ_REPLENISHMENT_REPOSITORY),
  () => new Date(),
  claimCampaignPage,
);
