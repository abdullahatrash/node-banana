import nextEnv from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

nextEnv.loadEnvConfig(process.cwd());

const baseUrl = new URL(process.env.APP_BASE_URL || "http://localhost:3002");
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname)) throw new Error("Licensed-trend smoke accepts loopback URLs only.");
const internalSecret = process.env.STUDIO_INTERNAL_API_SECRET?.trim();
if (!internalSecret) throw new Error("STUDIO_INTERNAL_API_SECRET is required.");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const bucket = process.env.S3_BUCKET_NAME;
const region = process.env.S3_REGION;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error("S3 configuration is required.");
const s3 = new S3Client({ region, endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey } });
const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID();
const catalogId = `smoke_catalog_${suffix}`;
const sourceKey = `licensed-catalog-smoke/${suffix}/source.png`;
const evidenceKey = `licensed-catalog-smoke/${suffix}/license.txt`;
let workspaceId = ""; let entitlementId = ""; let jobId = ""; let inspirationItemId = ""; let rightsSnapshotId = ""; let rightsEvidenceId = ""; let sourceAssetId = ""; let evidenceAssetId = "";

const sha256 = (body) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf8MZ0AAAAASUVORK5CYII=", "base64");
const evidence = Buffer.from(`Synthetic local smoke license evidence for ${catalogId}\n`, "utf8");

function cookies(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function json(response, label) {
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
  if (!response.ok || body.success === false) throw new Error(`${label} failed with ${response.status}: ${body.code || "UNKNOWN"}`);
  return body;
}

async function internal(body) {
  return json(await fetch(new URL("/api/studio/internal/licensed-trend-catalog", baseUrl), { method: "POST", headers: { "content-type": "application/json", "x-studio-internal-secret": internalSecret }, body: JSON.stringify(body) }), body.action);
}

async function cleanup() {
  if (!workspaceId) return;
  const catalogs = await pool.query("select id from licensed_trend_catalog_entries where provider_key = 'local.smoke'");
  const catalogIds = catalogs.rows.map((row) => row.id);
  if (!catalogIds.length) return;
  const entitlements = await pool.query("select workspace_id, id from licensed_trend_workspace_entitlements where catalog_id = any($1::text[]) and state = 'active'", [catalogIds]);
  for (const entitlement of entitlements.rows) await internal({ action: "revoke_entitlement", workspaceId: entitlement.workspace_id, entitlementId: entitlement.id });
  for (const id of catalogIds) await internal({ action: "set_catalog_state", catalogId: id, state: "revoked" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const records = await client.query("select workspace_id, id, revision, title, payload, updated_by_user_id from workspace_product_records where kind = 'inspiration_item' and archived_at is null and payload->'catalogBinding'->>'catalogId' = any($1::text[]) for update", [catalogIds]);
    for (const record of records.rows) {
      const revision = record.revision + 1; const at = new Date();
      await client.query("update workspace_product_records set state = 'archived', revision = $3, archived_at = $4, updated_at = $4 where workspace_id = $1 and id = $2", [record.workspace_id, record.id, revision, at]);
      await client.query("insert into workspace_product_record_revisions (workspace_id, record_id, revision, title, state, payload, author_user_id, created_at) values ($1,$2,$3,$4,'archived',$5,$6,$7)", [record.workspace_id, record.id, revision, record.title, record.payload, record.updated_by_user_id, at]);
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

try {
  const signIn = await fetch(new URL("/api/auth/sign-in/email", baseUrl), { method: "POST", headers: { "content-type": "application/json", origin: baseUrl.origin }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL || "alice@nodebanana.dev", password: process.env.SMOKE_PASSWORD || "Password123!" }) });
  const cookie = cookies(signIn); if (!signIn.ok || !cookie) throw new Error("Seeded-user sign-in failed."); await signIn.arrayBuffer();
  const workspaces = await json(await fetch(new URL("/api/studio/workspaces", baseUrl), { headers: { cookie } }), "workspace list");
  workspaceId = workspaces.workspaces?.[0]?.id || ""; if (!workspaceId) throw new Error("No seeded workspace is available.");
  const [sourcePut, evidencePut] = await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: bucket, Key: sourceKey, Body: image, ContentType: "image/png" })),
    s3.send(new PutObjectCommand({ Bucket: bucket, Key: evidenceKey, Body: evidence, ContentType: "text/plain" })),
  ]);
  if (!sourcePut.ETag || !evidencePut.ETag) throw new Error("S3 did not return immutable object identities.");
  const now = new Date(); const publishedAt = new Date(now.getTime() - 86_400_000); const expiresAt = new Date(now.getTime() + 86_400_000);
  await internal({ action: "publish", document: { schema: "licensed-trend-catalog-entry/v1", id: catalogId, revision: 1, provider: { key: "local.smoke", itemId: suffix, sourceUrl: "https://example.com/licensed-smoke", attribution: "Synthetic local smoke fixture" }, title: "اختبار كتالوج مرخّص", sourceName: "Local smoke fixture", publishedAt: publishedAt.toISOString(), metrics: { views: 100, likes: 10, comments: 1, observedAt: now.toISOString() }, media: { type: "image", mimeType: "image/png", sizeBytes: image.length, width: 1, height: 1, durationSeconds: null, storageKey: sourceKey, versionId: sourcePut.VersionId || null, etag: sourcePut.ETag, digest: sha256(image) }, evidenceDocument: { mimeType: "text/plain", sizeBytes: evidence.length, storageKey: evidenceKey, versionId: evidencePut.VersionId || null, etag: evidencePut.ETag, digest: sha256(evidence) }, rights: { basis: "licensed", permittedRemix: "transform", issuer: { type: "license_authority", id: "local-smoke" }, scope: { commercialUse: true, derivativeUse: false, modelInputUse: true, territories: ["worldwide"] }, issuedAt: publishedAt.toISOString(), expiresAt: expiresAt.toISOString() }, classification: { region: "MENA", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["اختبار"], creativePrimitives: { topics: ["اختبار"], hookPattern: "سؤال عربي مباشر", pacing: "سريع", structure: ["خطاف", "برهان", "دعوة"] } } } });
  const grant = await internal({ action: "grant", workspaceId, catalogId, catalogRevision: 1, territories: ["worldwide"], expiresAt: expiresAt.toISOString(), grantAuthority: "local-smoke" });
  entitlementId = grant.result.document.id;
  const catalog = await json(await fetch(new URL("/api/product-inspiration/licensed-catalog", baseUrl), { headers: { cookie, "x-workspace-id": workspaceId } }), "catalog browse");
  const card = catalog.items.find((item) => item.catalogId === catalogId && item.state === "available");
  if (!card) throw new Error("Granted catalog package is not browsable.");
  const preview = await fetch(new URL(card.previewUrl, baseUrl), { headers: { cookie, "x-workspace-id": workspaceId } });
  if (!preview.ok || !Buffer.from(await preview.arrayBuffer()).equals(image)) throw new Error("Entitlement-gated preview did not return the catalog media.");
  const imported = await json(await fetch(new URL("/api/product-inspiration/licensed-catalog", baseUrl), { method: "POST", headers: { cookie, "content-type": "application/json", origin: baseUrl.origin, "x-workspace-id": workspaceId }, body: JSON.stringify({ action: "import", entitlementId, idempotencyKey: `smoke:${suffix}` }) }), "catalog import");
  jobId = imported.result.job.id;
  await json(await fetch(new URL("/api/studio/internal/licensed-trend-materialization?limit=10", baseUrl), { headers: { "x-studio-internal-secret": internalSecret } }), "materialization worker");
  const verified = await pool.query("select state, source_asset_id, evidence_document_asset_id, rights_evidence_id, rights_snapshot_id, inspiration_item_id from licensed_trend_materialization_jobs where workspace_id = $1 and id = $2", [workspaceId, jobId]);
  const job = verified.rows[0]; if (!job || job.state !== "succeeded") throw new Error(`Materialization ended in ${job?.state || "missing"}.`);
  ({ source_asset_id: sourceAssetId, evidence_document_asset_id: evidenceAssetId, rights_evidence_id: rightsEvidenceId, rights_snapshot_id: rightsSnapshotId, inspiration_item_id: inspirationItemId } = job);
  const page = await fetch(new URL("/inspiration", baseUrl), { headers: { cookie }, redirect: "manual" });
  if (page.status !== 200) throw new Error(`Inspiration page returned HTTP ${page.status}.`);
  console.log("[OK] licensed trend publish → grant → browse → import → verified materialization");
} finally {
  try { await cleanup(); } catch (error) { console.warn(`[WARN] smoke cleanup could not complete: ${error instanceof Error ? error.message : "unknown"}`); }
  await pool.end(); s3.destroy();
}
