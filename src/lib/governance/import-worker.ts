import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GovernanceAuditEvent, GovernanceRepository, GovernanceResource } from "./types";
import { GOVERNANCE_PORTABLE_KINDS, type GovernanceImportRegionRoutePin, type GovernancePortableDataPort, type GovernancePortableKind, validatePortablePayload } from "./portability";
import { GOVERNANCE_REGION_ROUTES } from "./region-enforcement";

const IMPORT_LEASE_MS = 5 * 60_000;
const UNAVAILABLE_PORTABLE_DATA: GovernancePortableDataPort = {
  list: async () => [],
  materialize: async () => ({ kind: "unavailable", reason: "DESTINATION_ADAPTER_REQUIRED" }),
};

export interface GovernanceImportRegionAdmissionPort {
  admit(input: {
    workspaceId: string;
    kind: "primary_storage" | "processing";
    routeId: string;
    configuredRegion: string;
    evaluatedAt: Date;
  }): Promise<{ allowed: true; policyApplied: boolean; evidenceDigest?: string } | { allowed: false; reason: string }>;
}

const DENYING_REGION_ADMISSION: GovernanceImportRegionAdmissionPort = {
  admit: async () => ({ allowed: false, reason: "IMPORT_REGION_ADMISSION_NOT_CONFIGURED" }),
};

export class GovernanceImportRegionDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Workspace import region route denied: ${reason}`);
    this.name = "GovernanceImportRegionDeniedError";
  }
}

interface ImportItem {
  id: string; kind: string; sourceId: string; destinationId?: string; digest: string;
  payload?: Record<string, unknown>; action: "create_or_match" | "omit";
  mapping?: Record<string, string>;
  state: "queued" | "previewed" | "running" | "waiting_user" | "created" | "matched" | "omitted" | "failed_known";
  outcome: Record<string, unknown> | null; provenancePreserved: boolean;
}

interface ImportJobBody {
  source: string; sourceManifestDigest: string; manifestKeyId: string;
  manifestSignature: string; manifestVerified: true; requestedByUserId: string;
  items: ImportItem[];
  lease: { id: string; claimedAt: string; expiresAt: string; attempt: number; regionRoute: { kind: "processing"; routeId: string; configuredRegion: string; policyApplied: boolean; evidenceDigest: string | null; admittedAt: string } } | null;
  [key: string]: unknown;
}

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "imports.process@1", action, resource: { kind: job.kind, id: job.id }, outcome, redactedDetails: {}, occurredAt: now };
}

export class GovernanceImportWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    private readonly portableData: GovernancePortableDataPort = UNAVAILABLE_PORTABLE_DATA,
    private readonly regionAdmission: GovernanceImportRegionAdmissionPort = DENYING_REGION_ADMISSION,
  ) {}

  async process(input: { workspaceId: string; importId: string }): Promise<void> {
    const found = await this.repository.getResource<ImportJobBody>({ workspaceId: input.workspaceId, kind: "workspace_import", id: input.importId });
    if (!found || ["succeeded", "failed_known"].includes(found.status)) return;
    const claimed = await this.claim(found);
    if (!claimed) return;
    let job = claimed;
    while (true) {
      const body = job.body;
      if (body.manifestVerified !== true || !body.requestedByUserId) {
        await this.updateJob(job, "failed_known", { ...body, failureCode: "UNVERIFIED_MANIFEST" }, "reject_import", "failed");
        return;
      }
      const item = body.items.find((candidate) => candidate.state === "queued");
      if (!item) {
        const status = body.items.some((candidate) => candidate.state === "failed_known")
          ? "failed_known"
          : body.items.some((candidate) => candidate.state === "waiting_user")
            ? "waiting_user"
            : "succeeded";
        await this.updateJob(job, status, {
          ...body,
          lease: null,
          ...(status === "waiting_user" ? { waitingSince: this.clock.now().toISOString() } : { completedAt: this.clock.now().toISOString() }),
        }, "complete_import", status === "succeeded" ? "completed" : status === "waiting_user" ? "accepted" : "failed");
        return;
      }
      const kind = (GOVERNANCE_PORTABLE_KINDS as readonly string[]).includes(item.kind) ? item.kind as GovernancePortableKind : null;
      const payload = kind && item.payload ? validatePortablePayload(kind, item.payload) : null;
      if (!kind || item.action !== "create_or_match" || !payload || canonicalDigest(payload) !== item.digest) {
        job = await this.recordItem(job, item.id, "failed_known", { code: "UNSUPPORTED_OR_INVALID_TRANSFER" });
        continue;
      }
      const destinationId = item.destinationId ?? `imported_${item.digest.slice(7, 39)}`;
      const regionRoute = await this.admitMaterialization(input.workspaceId);
      const result = await this.portableData.materialize({
        workspaceId: input.workspaceId, requestedByUserId: body.requestedByUserId,
        kind, sourceId: item.sourceId, destinationId, digest: item.digest, payload,
        provenance: { source: body.source, sourceManifestDigest: body.sourceManifestDigest },
        idempotencyKey: `portable-import:${job.id}:${item.id}`,
        regionRoute,
        mapping: item.mapping,
      });
      if (result.kind === "created" || result.kind === "matched") {
        job = await this.recordItem(job, item.id, result.kind, { destinationId: result.destinationId, [result.kind]: true });
      } else if (result.kind === "waiting_user") {
        job = await this.recordItem(job, item.id, "waiting_user", { code: result.reason, requiredMappings: result.requiredMappings });
      } else {
        job = await this.recordItem(job, item.id, "failed_known", { code: "reason" in result ? result.reason : "DESTINATION_ADAPTER_FAILED" });
      }
    }
  }

  async recoverExpired(input: { workspaceId: string }): Promise<number> {
    const now = this.clock.now();
    const jobs = await this.repository.listResources<ImportJobBody>({ workspaceId: input.workspaceId, kinds: ["workspace_import"], status: "running" });
    const expired = jobs.filter((job) => !job.body.lease || new Date(job.body.lease.expiresAt) <= now);
    for (const job of expired) await this.process({ workspaceId: input.workspaceId, importId: job.id });
    return expired.length;
  }

  private async claim(job: GovernanceResource<ImportJobBody>): Promise<GovernanceResource<ImportJobBody> | null> {
    const now = this.clock.now();
    if (job.status === "running" && job.body.lease && new Date(job.body.lease.expiresAt) > now) return null;
    if (job.status !== "queued" && job.status !== "running") throw new Error("Workspace import is not claimable.");
    const configuredRegion = process.env.GOVERNANCE_IMPORT_PROCESSING_REGION ?? process.env.APP_DATA_REGION ?? "unconfigured";
    const admission = await this.regionAdmission.admit({ workspaceId: job.workspaceId, ...GOVERNANCE_REGION_ROUTES.workspaceImportProcessing, configuredRegion, evaluatedAt: now });
    if (!admission.allowed) throw new GovernanceImportRegionDeniedError(admission.reason);
    const lease = {
      id: `lease_${randomUUID().replaceAll("-", "")}`,
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + IMPORT_LEASE_MS).toISOString(),
      attempt: (job.body.lease?.attempt ?? 0) + 1,
      regionRoute: { ...GOVERNANCE_REGION_ROUTES.workspaceImportProcessing, configuredRegion, policyApplied: admission.policyApplied, evidenceDigest: admission.evidenceDigest ?? null, admittedAt: now.toISOString() },
    };
    const next: GovernanceResource<ImportJobBody> = { ...job, version: job.version + 1, status: "running", body: { ...job.body, lease }, updatedAt: now };
    const outcome = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "imports.claim@1", idempotencyKey: `import-claim-${job.id}-${job.version}-${lease.id}`, requestDigest: canonicalDigest({ importId: job.id, version: job.version, lease }), result: { importId: job.id, status: "running", leaseId: lease.id }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, "claim_import", "accepted", now) });
    return outcome.type === "committed" ? next : null;
  }

  private async admitMaterialization(workspaceId: string): Promise<GovernanceImportRegionRoutePin> {
    const admittedAt = this.clock.now();
    const configuredRegion = process.env.GOVERNANCE_IMPORT_STORAGE_REGION ?? process.env.APP_DATA_REGION ?? "unconfigured";
    const admission = await this.regionAdmission.admit({ workspaceId, ...GOVERNANCE_REGION_ROUTES.workspaceImportStorage, configuredRegion, evaluatedAt: admittedAt });
    if (!admission.allowed) throw new GovernanceImportRegionDeniedError(admission.reason);
    return { ...GOVERNANCE_REGION_ROUTES.workspaceImportStorage, configuredRegion, policyApplied: admission.policyApplied, evidenceDigest: admission.evidenceDigest ?? null, admittedAt: admittedAt.toISOString() };
  }

  private async recordItem(job: GovernanceResource<ImportJobBody>, itemId: string, state: ImportItem["state"], outcome: Record<string, unknown>): Promise<GovernanceResource<ImportJobBody>> {
    return this.updateJob(job, "running", { ...job.body, items: job.body.items.map((item) => item.id === itemId ? { ...item, state, outcome } : item) }, "record_import_item", state === "failed_known" ? "failed" : "completed");
  }

  private async updateJob(job: GovernanceResource<ImportJobBody>, status: string, body: ImportJobBody, action: string, outcome: GovernanceAuditEvent["outcome"]): Promise<GovernanceResource<ImportJobBody>> {
    const now = this.clock.now();
    const next: GovernanceResource<ImportJobBody> = { ...job, version: job.version + 1, status, body, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "imports.process@1", idempotencyKey: `${action}-${job.id}-${job.version}`, requestDigest: canonicalDigest({ importId: job.id, version: job.version, action }), result: { importId: job.id, status }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, action, outcome, now) });
    if (committed.type === "conflict") throw new Error("Workspace import changed concurrently.");
    return next;
  }
}

export const TRANSFERABLE_GOVERNANCE_IMPORT_KINDS = [...GOVERNANCE_PORTABLE_KINDS];
