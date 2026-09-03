import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GovernanceAuditEvent, GovernanceRepository, GovernanceResource, GovernanceResourceKind } from "./types";
import { GOVERNANCE_RESOURCE_KINDS } from "./types";

const TRANSFERABLE_KINDS = new Set<GovernanceResourceKind>([
  "custom_role",
  "portfolio",
  "approval_policy",
  "data_region_policy",
  "retention_policy",
]);

interface ImportItem {
  id: string;
  kind: string;
  sourceId: string;
  destinationId?: string;
  digest: string;
  payload?: Record<string, unknown>;
  action: "create_or_match" | "omit";
  state: "queued" | "previewed" | "running" | "created" | "matched" | "omitted" | "failed_known";
  outcome: Record<string, unknown> | null;
  provenancePreserved: boolean;
}

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "imports.process@1", action, resource: { kind: job.kind, id: job.id }, outcome, redactedDetails: {}, occurredAt: now };
}

export class GovernanceImportWorker {
  constructor(private readonly repository: GovernanceRepository, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async process(input: { workspaceId: string; importId: string }): Promise<void> {
    let job = await this.repository.getResource({ workspaceId: input.workspaceId, kind: "workspace_import", id: input.importId });
    if (!job || ["succeeded", "failed_known"].includes(job.status)) return;
    if (!["queued", "running"].includes(job.status)) throw new Error("Workspace import is not executable.");
    if (job.status === "queued") job = await this.updateJob(job, "running", job.body, "start_import", "accepted");

    while (true) {
      const body = job.body as { source: string; sourceManifestDigest: string; items: ImportItem[]; [key: string]: unknown };
      const item = body.items.find((candidate) => candidate.state === "queued");
      if (!item) {
        const status = body.items.some((candidate) => candidate.state === "failed_known") ? "failed_known" : "succeeded";
        await this.updateJob(job, status, { ...body, completedAt: this.clock.now().toISOString() }, "complete_import", status === "succeeded" ? "completed" : "failed");
        return;
      }
      const kind = (GOVERNANCE_RESOURCE_KINDS as readonly string[]).includes(item.kind) ? item.kind as GovernanceResourceKind : null;
      if (!kind || !TRANSFERABLE_KINDS.has(kind) || item.action !== "create_or_match" || !item.payload || canonicalDigest(item.payload) !== item.digest) {
        job = await this.recordItem(job, item.id, "failed_known", { code: "UNSUPPORTED_OR_INVALID_TRANSFER" });
        continue;
      }
      const destinationId = item.destinationId ?? `imported_${item.digest.slice(7, 39)}`;
      const existing = await this.repository.getResource<{ _importProvenance?: { sourceManifestDigest?: string; sourceItemDigest?: string } }>({ workspaceId: input.workspaceId, kind, id: destinationId });
      if (existing) {
        const provenance = existing.body._importProvenance;
        job = await this.recordItem(job, item.id, provenance?.sourceManifestDigest === body.sourceManifestDigest && provenance.sourceItemDigest === item.digest ? "matched" : "failed_known", provenance?.sourceItemDigest === item.digest ? { destinationId, matched: true } : { code: "DESTINATION_CONFLICT", destinationId });
        continue;
      }
      const now = this.clock.now();
      const imported: GovernanceResource = { id: destinationId, workspaceId: input.workspaceId, kind, version: 1, status: "active", body: { ...item.payload, _importProvenance: { schema: "workspace-import-provenance/v1", source: body.source, sourceManifestDigest: body.sourceManifestDigest, sourceId: item.sourceId, sourceItemDigest: item.digest, importedAt: now.toISOString() } }, createdByUserId: job.createdByUserId, createdAt: now, updatedAt: now };
      const nextItems = body.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: "created" as const, outcome: { destinationId, created: true } } : candidate);
      const next: GovernanceResource = { ...job, version: job.version + 1, body: { ...body, items: nextItems }, updatedAt: now };
      const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: "imports.process@1", idempotencyKey: `import-item-${job.id}-${item.id}`, requestDigest: canonicalDigest({ importId: job.id, itemId: item.id, digest: item.digest }), result: { itemId: item.id, destinationId, state: "created" }, createdAt: now }, mutations: [{ type: "create", expectedVersion: null, resource: imported }, { type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, "materialize_import_item", "completed", now) });
      if (outcome.type === "conflict") {
        const refreshed = await this.repository.getResource({ workspaceId: input.workspaceId, kind: "workspace_import", id: input.importId });
        if (!refreshed) return;
        job = refreshed;
      } else job = next;
    }
  }

  private async recordItem(job: GovernanceResource, itemId: string, state: ImportItem["state"], outcome: Record<string, unknown>): Promise<GovernanceResource> {
    const body = job.body as { items: ImportItem[]; [key: string]: unknown };
    return this.updateJob(job, "running", { ...body, items: body.items.map((item) => item.id === itemId ? { ...item, state, outcome } : item) }, "record_import_item", state === "failed_known" ? "failed" : "completed");
  }

  private async updateJob(job: GovernanceResource, status: string, body: Record<string, unknown>, action: string, outcome: GovernanceAuditEvent["outcome"]): Promise<GovernanceResource> {
    const now = this.clock.now();
    const next: GovernanceResource = { ...job, version: job.version + 1, status, body, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "imports.process@1", idempotencyKey: `${action}-${job.id}-${job.version}`, requestDigest: canonicalDigest({ importId: job.id, version: job.version, action }), result: { importId: job.id, status }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, action, outcome, now) });
    if (committed.type === "conflict") throw new Error("Workspace import changed concurrently.");
    return next;
  }
}

export const TRANSFERABLE_GOVERNANCE_IMPORT_KINDS = [...TRANSFERABLE_KINDS];
