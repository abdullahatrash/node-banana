import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { putObjectToS3 } from "@/lib/storage";
import type { GovernanceAuditEvent, GovernanceRepository, GovernanceResource } from "./types";

export interface GovernanceExportStore {
  put(input: { key: string; bytes: Uint8Array }): Promise<void>;
}

export class S3GovernanceExportStore implements GovernanceExportStore {
  async put(input: { key: string; bytes: Uint8Array }) {
    await putObjectToS3({ key: input.key, body: input.bytes, contentType: "application/vnd.tasmeemai.encrypted+json" });
  }
}

function keyFromBase64(value: string, name: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes.`);
  return key;
}

function audit(input: { workspaceId: string; job: GovernanceResource; outcome: "completed" | "failed"; now: Date }): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: input.workspaceId, actor: { kind: "system", id: null }, capability: "governance_exports.process@1", action: input.job.kind === "audit_export" ? "process_audit_export" : "process_workspace_export", resource: { kind: input.job.kind, id: input.job.id }, outcome: input.outcome, redactedDetails: {}, occurredAt: input.now };
}

const OMITTED_RESOURCE_KINDS = new Set(["step_up_challenge", "step_up_session", "review_guest_session", "invitation_binding"]);

export class GovernanceExportWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly store: GovernanceExportStore,
    private readonly keys: { encryptionKeyBase64: string; signingKeyBase64: string },
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async process(input: { workspaceId: string; kind: "audit_export" | "workspace_export"; exportId: string }): Promise<void> {
    const job = await this.repository.getResource({ workspaceId: input.workspaceId, kind: input.kind, id: input.exportId });
    if (!job || job.status === "succeeded") return;
    if (job.status !== "queued") throw new Error("Export job is not queued.");
    const now = this.clock.now();
    try {
      const encryptionKey = keyFromBase64(this.keys.encryptionKeyBase64, "GOVERNANCE_EXPORT_ENCRYPTION_KEY");
      const signingKey = keyFromBase64(this.keys.signingKeyBase64, "GOVERNANCE_EXPORT_SIGNING_KEY");
      const jobBody = job.body as { from: string | null; to: string | null; expiresAt: string; includeKinds?: string[]; omissions?: string[] };
      const auditEvents = await this.repository.listAudit({ workspaceId: input.workspaceId, limit: 500 });
      const resources = input.kind === "workspace_export"
        ? (await this.repository.listResources({ workspaceId: input.workspaceId })).filter((item) => !OMITTED_RESOURCE_KINDS.has(item.kind))
        : [];
      const payload = {
        schema: input.kind === "audit_export" ? "workspace-audit-export/v1" : "workspace-export/v1",
        workspaceId: input.workspaceId,
        scope: input.kind === "audit_export" ? { from: jobBody.from, to: jobBody.to } : { includeKinds: jobBody.includeKinds ?? [] },
        exportedAt: now.toISOString(),
        audit: auditEvents,
        resources,
      };
      const plaintext = Buffer.from(canonicalJson(payload), "utf8");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      cipher.setAAD(Buffer.from(`${input.workspaceId}\u0000${job.id}`, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = { schema: "governance-encrypted-export/v1", algorithm: "AES-256-GCM", keyId: "workspace-export-v1", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
      const bytes = Buffer.from(canonicalJson(envelope), "utf8");
      const storageKey = `governance/${input.workspaceId}/${job.id}.encrypted.json`;
      await this.store.put({ key: storageKey, bytes });
      const manifestUnsigned = {
        schema: "governance-export-manifest/v1",
        exportId: job.id,
        workspaceId: input.workspaceId,
        scope: payload.scope,
        generatedAt: now.toISOString(),
        expiresAt: jobBody.expiresAt,
        payloadSchema: payload.schema,
        contentDigest: canonicalDigest(payload),
        encryptedArtifactDigest: canonicalDigest(envelope),
        encryption: { algorithm: "AES-256-GCM", keyId: "workspace-export-v1" },
        omissions: input.kind === "workspace_export" ? jobBody.omissions ?? [] : ["secrets", "credential_material", "unrequested_content"],
      };
      const signature = createHmac("sha256", signingKey).update(canonicalJson(manifestUnsigned)).digest("base64url");
      const next: GovernanceResource = { ...job, version: job.version + 1, status: "succeeded", body: { ...job.body, status: "succeeded", artifactRef: storageKey, manifest: { ...manifestUnsigned, signature: { algorithm: "HMAC-SHA256", keyId: "workspace-export-signing-v1", value: signature } } }, updatedAt: now };
      const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: "governance_exports.process@1", idempotencyKey: `export-${job.id}-${job.version}`, requestDigest: canonicalDigest({ workspaceId: input.workspaceId, kind: input.kind, exportId: job.id, version: job.version }), result: { exportId: job.id, status: "succeeded" }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit({ workspaceId: input.workspaceId, job, outcome: "completed", now }) });
      if (outcome.type === "conflict") throw new Error("Export job changed while processing.");
    } catch (error) {
      await this.fail(job, error instanceof Error ? error.name : "ExportFailure", now);
      throw error;
    }
  }

  private async fail(job: GovernanceResource, failureCode: string, now: Date) {
    const next: GovernanceResource = { ...job, version: job.version + 1, status: "failed_known", body: { ...job.body, status: "failed_known", failureCode, artifactRef: null, manifest: null }, updatedAt: now };
    await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "governance_exports.fail@1", idempotencyKey: `export-fail-${job.id}-${job.version}`, requestDigest: canonicalDigest({ jobId: job.id, version: job.version, failureCode }), result: { exportId: job.id, status: "failed_known" }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit({ workspaceId: job.workspaceId, job, outcome: "failed", now }) });
  }
}
