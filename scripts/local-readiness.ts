import "./_load-env";

import { Pool } from "pg";
import { configuredCatalog } from "@/lib/model-routing/catalog";
import { buildLocalReadinessReport, type LocalReadinessFacts } from "@/lib/local-readiness";
import { evaluateXAdsAttributionReadiness, loadXAdsAttributionConfig } from "@/lib/marketing-attribution/config";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

const databaseUrl = process.env.DATABASE_URL?.trim() || null;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 1 }) : null;

async function count(query: string, parameters: unknown[] = []): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query<{ count: string }>(query, parameters);
  return Number(result.rows[0]?.count ?? 0);
}

async function run() {
  let databaseConnected = false;
  let databaseDetail = databaseUrl ? "Connection failed." : "DATABASE_URL is not configured.";
  let workspaceId = argument("--workspace") || process.env.DEV_WORKSPACE_ID?.trim() || null;
  let workspaceExists = false;
  let acceptedBrand = false;
  let verifiedReplicateRegion = false;
  let replicateVaultKey = false;
  let replicateVaultKeyValidated = false;
  let activePlans = 0;
  let activeCreditPacks = 0;
  let availableCredits = 0;
  const configuredReplicateRegion = process.env.PROVIDER_REGION_REPLICATE?.trim() || null;

  if (pool) {
    try {
      const version = await pool.query<{ version: string }>("select current_setting('server_version') as version");
      databaseConnected = true;
      databaseDetail = `Connected to PostgreSQL ${version.rows[0]?.version ?? "unknown"}.`;
      if (!workspaceId) {
        const workspace = await pool.query<{ id: string }>("select id from workspaces where deleted_at is null order by created_at limit 1");
        workspaceId = workspace.rows[0]?.id ?? null;
      }
      workspaceExists = Boolean(workspaceId) && (await count("select count(*) from workspaces where id = $1 and deleted_at is null", [workspaceId])) > 0;
      activePlans = await count("select count(*) from billing_plan_versions where status = 'active' and effective_at <= now() and (retired_at is null or retired_at > now())");
      activeCreditPacks = await count("select count(*) from generation_credit_pack_versions where status = 'active' and effective_at <= now() and (retired_at is null or retired_at > now())");
      if (workspaceId && workspaceExists) {
        acceptedBrand = (await count("select count(*) from brand_profiles where workspace_id = $1 and status = 'active' and accepted_at is not null", [workspaceId])) > 0;
        const key = await pool.query<{ validated: boolean }>("select (last_validated_at is not null) as validated from workspace_provider_keys where workspace_id = $1 and provider = 'replicate' limit 1", [workspaceId]);
        replicateVaultKey = key.rowCount === 1;
        replicateVaultKeyValidated = key.rows[0]?.validated === true;
        verifiedReplicateRegion = Boolean(configuredReplicateRegion) && (await count("select count(*) from workspace_governance_resources where workspace_id = $1 and kind = 'data_region_policy' and id = 'active' and status = 'active' and body->>'verified' = 'true' and body->'verifiedEvidence'->>'expiresAt' > $2 and exists (select 1 from jsonb_array_elements(body->'verifiedEvidence'->'routes') route where route->>'kind' = 'processing' and route->>'routeId' = 'provider:replicate' and route->>'region' = $3)", [workspaceId, new Date().toISOString(), configuredReplicateRegion])) > 0;
        const credits = await pool.query<{ credits: string }>("select coalesce(sum(available_units), 0)::text as credits from generation_credit_buckets where workspace_id = $1 and (expires_at is null or expires_at > now())", [workspaceId]);
        availableCredits = Number(credits.rows[0]?.credits ?? 0);
      }
    } catch (error) {
      databaseConnected = false;
      databaseDetail = error instanceof Error ? error.message : "Database readiness check failed.";
    }
  }

  const encryptionKey = process.env.BYOK_KEY_ENCRYPTION_KEY?.trim() || "";
  const xAdsReadiness = evaluateXAdsAttributionReadiness(loadXAdsAttributionConfig());
  const facts: LocalReadinessFacts = {
    generatedAt: new Date(),
    workspaceId,
    workspaceExists,
    databaseConnected,
    databaseDetail,
    canonicalStorageConfigured:
      process.env.STORAGE_BACKEND?.trim().toLowerCase() === "s3" &&
      Boolean(process.env.S3_BUCKET_NAME?.trim()) &&
      Boolean(process.env.S3_REGION?.trim()) &&
      Boolean(process.env.S3_ACCESS_KEY_ID?.trim()) &&
      Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim()),
    encryptionKeyConfigured: Boolean(encryptionKey),
    encryptionKeyValid: /^[a-fA-F0-9]{64}$/.test(encryptionKey),
    stepUpDeliveryConfigured:
      (process.env.AUTH_EMAIL_DELIVERY?.trim().toLowerCase() === "resend" &&
        Boolean(process.env.RESEND_API_KEY?.trim()) &&
        Boolean(process.env.AUTH_FROM_EMAIL?.trim())) ||
      process.env.AUTH_ALLOW_CONSOLE_EMAIL_LINKS === "true",
    qualifiedReplicateModels: configuredCatalog().filter((model) => model.provider === "replicate" && model.qualification.status === "qualified").length,
    qualificationDedicatedTokenConfigured: Boolean(process.env.REPLICATE_QUALIFICATION_API_TOKEN?.trim()),
    qualificationHarnessConfigured: Boolean(
      process.env.QUALIFICATION_HARNESS_TOKEN?.trim() &&
      process.env.QUALIFICATION_WEBHOOK_URL?.trim() &&
      process.env.QUALIFICATION_WEBHOOK_OBSERVER_URL?.trim() &&
      process.env.QUALIFICATION_INGESTION_URL?.trim() &&
      process.env.QUALIFICATION_SPEND_OBSERVER_URL?.trim(),
    ),
    qualificationSpendTrustConfigured: Boolean(process.env.QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON?.trim()),
    qualificationSigningTrustConfigured: Boolean(process.env.MODEL_QUALIFICATION_PUBLIC_KEYS_JSON?.trim()),
    legacyReplicateKeyConfigured: Boolean(process.env.REPLICATE_API_KEY?.trim()),
    acceptedBrand,
    verifiedReplicateRegion,
    replicateVaultKey,
    replicateVaultKeyValidated,
    managedReplicateKey: Boolean(process.env.REPLICATE_MANAGED_API_TOKEN?.trim()),
    managedReplicateRevision: Boolean(process.env.REPLICATE_MANAGED_KEY_REVISION?.trim()),
    activePlans,
    activeCreditPacks,
    availableCredits,
    merchantConfigured: Boolean(process.env.MERCHANT_OF_RECORD_BASE_URL?.trim() && process.env.MERCHANT_OF_RECORD_API_TOKEN?.trim()),
    xAdsAttributionAvailable: xAdsReadiness.available,
    xAdsAttributionBlockers: xAdsReadiness.blockers,
  };

  const report = buildLocalReadinessReport(facts);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`\nNode Banana local readiness\nWorkspace: ${report.workspaceId ?? "not found"}\n\n`);
    for (const check of report.checks) {
      const marker = check.status === "ready" ? "OK" : check.status === "optional" ? "OPTIONAL" : "BLOCKED";
      process.stdout.write(`[${marker}] ${check.label}: ${check.detail}\n`);
      if (check.action) process.stdout.write(`          ${check.action}\n`);
    }
    process.stdout.write(`\nCore: ${report.coreReady ? "ready" : "blocked"} · BYOK generation: ${report.byokReady ? "ready" : "blocked"} · Managed generation: ${report.managedReady ? "ready" : "blocked"} · X Ads attribution: ${report.xAdsAttributionReady ? "ready" : "unavailable"}\n`);
  }
}

run()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Local readiness check failed."}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
