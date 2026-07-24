import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Artifact persistence and storage contracts", () => {
  it("creates canonical Artifact tables without reusing legacy Asset rows or CDN fields", () => {
    const sql = source("drizzle/0031_natural_warbird.sql");
    for (const table of [
      "artifact_contents",
      "artifacts",
      "artifact_uploads",
      "artifact_mutation_receipts",
      "artifact_audit_events",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain('"artifacts_workspace_content_fk"');
    expect(sql).toContain('"artifacts_workspace_creator_fk"');
    expect(sql).toContain('"artifact_contents_pk"');
    expect(sql).toContain('"artifacts_workspace_digest_idx"');
    expect(sql).toContain("workspace_default");
    expect(sql).toContain("artifact_contents_storage_key_check");
    expect(sql).not.toMatch(/CREATE TABLE "artifacts"[\s\S]*cdn/i);
    expect(sql).not.toContain('REFERENCES "public"."assets"');
    for (const [indexName, constraintName] of [
      [
        "artifact_contents_identity_unique",
        "artifacts_workspace_content_fk",
      ],
      [
        "artifact_uploads_workspace_id_unique",
        "artifact_audit_events_workspace_upload_fk",
      ],
      [
        "artifacts_workspace_id_unique",
        "artifact_audit_events_workspace_artifact_fk",
      ],
    ] as const) {
      expect(sql.indexOf(`"${indexName}"`)).toBeLessThan(
        sql.indexOf(`"${constraintName}"`),
      );
    }
  });

  it("does not rewrite immutable authority history and protects Artifact history", () => {
    const sql = source("drizzle/0031_natural_warbird.sql");
    for (const table of [
      "agent_keys",
      "agent_grant_revisions",
      "workspace_agent_policy_revisions",
      "workspace_agent_policies",
    ]) {
      expect(sql).not.toContain(`UPDATE "${table}"`);
    }
    expect(sql).toContain('"artifact_contents_insert_only"');
    expect(sql).toContain('"artifact_mutation_receipts_insert_only"');
    expect(sql).toContain('"artifact_audit_events_insert_only"');
    expect(sql).toContain('"artifacts_provenance_immutable"');
  });

  it("normalizes authority JSON written before artifactIds at runtime", () => {
    const agentAuth = source("src/lib/agent-auth/repository.ts");
    const authorization = source(
      "src/lib/agent-authorization/repository.ts",
    );
    expect(agentAuth).toContain(
      "artifactIds: scope.resources.artifactIds ?? []",
    );
    expect(authorization).toContain(
      "artifactIds: grant.resources.artifactIds ?? []",
    );
    expect(authorization).toContain(
      "artifactIds: scope.resources.artifactIds ?? []",
    );
  });

  it("performs store I/O before the atomic metadata commit and never opens a database transaction over store I/O", () => {
    const service = source(
      "src/lib/agent-runtime/artifacts/service.ts",
    );
    const complete = service.slice(
      service.indexOf("async completeImageUpload"),
      service.indexOf("async getArtifact"),
    );
    const read = complete.indexOf("this.store.readStaged");
    const promote = complete.indexOf("this.store.promoteStaged");
    const commit = complete.indexOf("this.repository.commitUpload");
    expect(read).toBeGreaterThan(-1);
    expect(promote).toBeGreaterThan(read);
    expect(commit).toBeGreaterThan(promote);
    expect(complete).not.toContain(".transaction(");
  });

  it("uses Artifact-only S3 keys and sharp inspection without legacy CDN helpers", () => {
    const storage = source(
      "src/lib/agent-runtime/artifacts/storage.ts",
    );
    expect(storage).toContain("agent-artifacts/content/");
    expect(storage).toContain("copyObjectInS3");
    expect(storage).toContain("createPresignedUpload");
    expect(storage).toContain("createPresignedDownload");
    expect(storage).toContain("getObjectStreamFromS3");
    expect(storage).toContain("sourceVersionId");
    expect(storage).toContain("sourceETag");
    expect(storage).toContain("contentLength");
    expect(storage).toContain(
      "S3_ARTIFACT_STAGING_LIFECYCLE_MAX_HOURS",
    );
    const s3 = source("src/lib/storage/s3.ts");
    expect(s3).toContain("CopySourceIfMatch");
    expect(s3).toContain("ContentLength");
    expect(s3).toContain("response.VersionId");
    expect(s3).toContain("response.ETag");
    expect(storage).toContain("sharp(bytes");
    expect(storage).not.toContain("buildAssetObjectKey");
    expect(storage).not.toContain("buildCdnDownloadUrl");
    expect(storage).not.toContain("objectExistsInS3");
  });

  it("keeps bounded failed-upload cleanup server-owned and retryable", () => {
    const repository = source(
      "src/lib/agent-runtime/artifacts/postgres-repository.ts",
    );
    const service = source(
      "src/lib/agent-runtime/artifacts/service.ts",
    );
    const capabilities = source(
      "src/lib/agent-runtime/artifacts/capabilities.ts",
    );
    expect(repository).toContain("listUploadsForCleanup");
    expect(repository).toContain('eq(artifactUploads.status, "pending")');
    expect(repository).toContain('eq(artifactUploads.status, "failed")');
    expect(repository).toContain(".limit(input.limit)");
    expect(service).toContain("cleanupExpiredUploads");
    expect(service).toContain("markUploadStagingCleaned");
    expect(capabilities).not.toContain("cleanupExpiredUploads");
  });
});
