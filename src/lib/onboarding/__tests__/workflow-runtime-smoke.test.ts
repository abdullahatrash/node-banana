// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { start } from "workflow/api";
import { createLocalWorld } from "@workflow/world-local";
import * as schema from "@/lib/db/schema";
import { PostgresOnboardingRepository } from "../postgres-repository";
import { DefaultOnboardingService } from "../service";

const databaseUrl = process.env.ONBOARDING_REHEARSAL_DATABASE_URL;
const baseUrl = process.env.ONBOARDING_WORKFLOW_SMOKE_BASE_URL;

it.skipIf(!databaseUrl || !baseUrl)("executes the compiled onboarding workflow through its real queue and step handlers", async () => {
  if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1" || new URL(databaseUrl).pathname !== "/onboarding_rehearsal") {
    throw new Error("Only the disposable local rehearsal database is allowed");
  }
  if (!baseUrl || new URL(baseUrl).hostname !== "127.0.0.1" || process.env.WORKFLOW_TARGET_WORLD !== "local") {
    throw new Error("Only the explicitly configured local Workflow server is allowed");
  }
  if (!process.env.WORKFLOW_LOCAL_DATA_DIR) throw new Error("An explicit shared local Workflow data directory is required");
  const manifest = JSON.parse(readFileSync("src/app/.well-known/workflow/v1/manifest.json", "utf8"));
  const metadata = manifest.workflows["workflows/onboarding-brand-analysis.ts"].executeOnboardingBrandAnalysis;
  const world = createLocalWorld({ baseUrl, dataDir: process.env.WORKFLOW_LOCAL_DATA_DIR, recoverActiveRuns: false });
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const database = drizzle(pool, { schema });
    const userId = `workflow_smoke_${randomUUID()}`;
    await database.insert(schema.user).values({ id: userId, name: "Local Workflow Smoke", email: `${userId}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const repository = new PostgresOnboardingRepository(database);
    const runs: Array<Awaited<ReturnType<typeof start>>> = [];
    const service = new DefaultOnboardingService(repository, {
      async schedule(input) { runs.push(await start(metadata, [input], { world })); },
    });
    const initial = await service.getSnapshot({ userId });
    const identity = await service.execute({ userId, command: {
      type: "save_identity", expectedRevision: initial.revision, idempotencyKey: `identity_${userId}`,
      payload: { fullName: "Local Workflow Smoke", companyName: "Local Test Brand", logoAssetId: null, interfaceLocale: "en", contentLanguage: "en" },
    } });
    const queued = await service.execute({ userId, command: {
      type: "set_brand_source", expectedRevision: identity.revision, idempotencyKey: `source_${userId}`,
      payload: { kind: "description", description: "A local test brand that helps small teams prepare clear social content." },
    } });
    expect(runs).toHaveLength(1);
    const run = runs[0];
    await expect(run.returnValue).resolves.toEqual({ status: "ready", runId: queued.analysis!.runId });
    const snapshot = await service.getSnapshot({ userId });
    expect(snapshot.analysis?.status).toBe("ready");
    expect(snapshot.draftBrandProfile?.identity.companyName).toBe("Local Test Brand");
    const artifact = await repository.getActivationArtifactByProfile(identity.workspaceId!, snapshot.draftBrandProfileId!);
    expect(artifact?.artifact.brandProfileId).toBe(snapshot.draftBrandProfileId);
  } finally {
    await pool.end();
    await world.close?.();
  }
}, 60_000);
