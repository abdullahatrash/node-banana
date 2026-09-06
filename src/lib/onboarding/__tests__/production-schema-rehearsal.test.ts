// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { PostgresOnboardingRepository } from "../postgres-repository";
import { DefaultOnboardingService } from "../service";

const url = process.env.ONBOARDING_REHEARSAL_DATABASE_URL;
it.skipIf(!url)("saves onboarding identity, scoped locale and free credits on the deployed schema", async () => {
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/onboarding_rehearsal") throw new Error("Only the disposable local rehearsal database is allowed");
  const client = new Pool({connectionString:url,max:4});
  try {
    const userId = `onboarding_rehearsal_${randomUUID()}`;
    await drizzle(client,{schema}).insert(schema.user).values({id:userId,name:"Onboarding Rehearsal",email:`${userId}@example.com`,emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
    const service = new DefaultOnboardingService(new PostgresOnboardingRepository(drizzle(client,{schema})),{schedule:async()=>{throw new Error("Unexpected generation dispatch");}});
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
  } finally {await client.end();}
});
