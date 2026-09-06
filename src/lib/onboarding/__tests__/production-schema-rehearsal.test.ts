// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { PostgresOnboardingRepository } from "../postgres-repository";
import { DefaultOnboardingService } from "../service";

vi.mock("@/lib/creator-personas/production", () => ({ CREATOR_PERSONAS: { resolveUsage: vi.fn() } }));
import { DefaultOnboardingAnalysisWorker } from "../analysis-worker";
import { DescriptionBrandSourceReader } from "../brand-source/description-adapter";
import { createConfiguredBrandProfileGenerator } from "../brand-profile/ai-sdk-adapter";

const url = process.env.ONBOARDING_REHEARSAL_DATABASE_URL;
it.skipIf(!url)("recovers dispatch and prepares a draft on the deployed schema without provider configuration", async () => {
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/onboarding_rehearsal") throw new Error("Only the disposable local rehearsal database is allowed");
  const client = new Pool({connectionString:url,max:4});
  try {
    const userId = `onboarding_rehearsal_${randomUUID()}`;
    await drizzle(client,{schema}).insert(schema.user).values({id:userId,name:"Onboarding Rehearsal",email:`${userId}@example.com`,emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
    const repository = new PostgresOnboardingRepository(drizzle(client,{schema}));
    const schedule = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("queue unavailable")).mockResolvedValue(undefined);
    const service = new DefaultOnboardingService(repository,{schedule});
    const initial=await service.getSnapshot({userId});
    const command={type:"save_identity",expectedRevision:initial.revision,idempotencyKey:"rehearsal_identity",payload:{fullName:"Onboarding Rehearsal",companyName:"Rehearsal Workspace",logoAssetId:null,interfaceLocale:"ar",contentLanguage:"ar"}};
    const saved=await service.execute({userId,command});
    expect(saved.currentStep).toBe("brand_source");
    expect(saved.workspaceId).toBeTruthy();
    expect(saved.revision).toBe(initial.revision+1);
    const replay=await service.execute({userId,command});
    expect(replay.workspaceId).toBe(saved.workspaceId);
    const credits=await client.query('SELECT sum(granted_units)::int AS units FROM generation_credit_buckets WHERE workspace_id=$1',[saved.workspaceId]);
    expect(credits.rows[0].units).toBe(10);
    const locale=await client.query('SELECT interface_locale FROM workspace_interface_locale_preferences WHERE workspace_id=$1 AND user_id=$2',[saved.workspaceId,userId]);
    expect(locale.rows[0].interface_locale).toBe("ar");
    await expect(service.execute({ userId, command: {
      type: "set_brand_source", expectedRevision: saved.revision, idempotencyKey: "rehearsal_source",
      payload: { kind: "description", description: "منصة تساعد فرق المنطقة على تخطيط محتوى عربي واضح." },
    } })).rejects.toMatchObject({ status: 503 });
    const waiting = await service.getSnapshot({ userId });
    expect(waiting.analysis?.errorCode).toBe("WORKFLOW_DISPATCH_FAILED");
    const recovery = { type: "retry_preparation", expectedRevision: waiting.revision, idempotencyKey: "rehearsal_recovery", payload: { runId: waiting.analysis!.runId } };
    await service.execute({ userId, command: recovery });
    await service.execute({ userId, command: recovery });
    expect(schedule).toHaveBeenCalledTimes(2);
    const worker = new DefaultOnboardingAnalysisWorker({ repository, readerFor: () => new DescriptionBrandSourceReader(), generator: () => createConfiguredBrandProfileGenerator({ environment: { NODE_ENV: "test" } }) });
    for (const stage of ["start", "source", "profile", "activation", "finalize"] as const) {
      await worker.executeStage({ workspaceId: saved.workspaceId!, runId: waiting.analysis!.runId }, stage);
    }
    const ready = await service.getSnapshot({ userId });
    expect(ready.analysis?.status).toBe("ready");
    expect(ready.draftBrandProfile?.identity.companyName).toBe("Rehearsal Workspace");
    const artifact = await repository.getActivationArtifactByProfile(saved.workspaceId!, ready.draftBrandProfileId!);
    expect(artifact?.artifact.brandProfileId).toBe(ready.draftBrandProfileId);

  } finally {await client.end();}
});
