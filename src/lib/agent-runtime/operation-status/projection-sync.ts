import { createHash } from "node:crypto";
import type { ProjectedSourceOperation } from "./source-reader";
import type { OperationStatusService } from "./service";
import type { OperationState } from "./types";

const safeId = (value: string) => value.replace(/[^A-Za-z0-9._:/-]/g, "-").slice(0, 200);
const fingerprint = (source: ProjectedSourceOperation) => createHash("sha256").update(`${source.adapterId}:${source.resourceId}:${source.state}:${source.stage ?? ""}:${source.updatedAt.toISOString()}`).digest("hex").slice(0, 20);
function path(from: OperationState, to: OperationState): Array<{ state: OperationState; stage?: string }> {
  if (from === to) return to === "running" ? [{ state: "running", stage: "source.execute" }] : [];
  if (["cancelled", "succeeded", "failed_known"].includes(from)) return [];
  if (from === "outcome_unknown") return ["cancelled", "succeeded", "failed_known"].includes(to) ? [{ state: to }] : [];
  if (from === "cancelling") return ["cancelled", "succeeded", "failed_known", "outcome_unknown"].includes(to) ? [{ state: to }] : [];
  if (to === "cancelled" && from !== "running") return [{ state: "cancelled" }];
  const result: Array<{ state: OperationState; stage?: string }> = [];
  if (from === "queued") { result.push({ state: "admitted" }); from = "admitted"; }
  if (["waiting_user", "waiting_provider", "waiting_quota", "waiting_time", "blocked"].includes(from)) { result.push({ state: "admitted" }); from = "admitted"; }
  if (["waiting_user", "waiting_provider", "waiting_quota", "waiting_time", "blocked"].includes(to)) return [...result, { state: to }];
  if (to === "admitted") return result;
  if (from === "admitted") result.push({ state: "running", stage: "source.execute" });
  if (to !== "running") result.push({ state: to });
  return result;
}

export async function synchronizeOperationProjections(service: OperationStatusService, sources: ProjectedSourceOperation[]) {
  const summary = { created: 0, transitioned: 0, unchanged: 0, conflicts: 0 };
  for (const source of sources) {
    const operationId = safeId(`${source.kind}:${source.resourceId}`); const fp = fingerprint(source);
    let current = await service.get(source.workspaceId, operationId);
    if (!current) {
      const created = await service.create({ workspaceId: source.workspaceId, operationId, kind: source.kind, resourceId: safeId(source.resourceId), actor: { type: "system", service: "operation-projection" }, metadata: { ...source.metadata, sourceAdapter: source.adapterId, sourceUpdatedAt: source.updatedAt.toISOString() }, idempotencyKey: `project:create:${operationId}` });
      if (created.kind !== "applied" && created.kind !== "replayed") { summary.conflicts++; continue; }
      current = created.operation; summary.created++;
    }
    const steps = path(current.state, source.state);
    if (!steps.length && current.state === source.state && (source.state !== "running" || current.stage === (source.stage ?? "source.execute"))) {
      if (current.metadata.sourceUpdatedAt === source.updatedAt.toISOString()) { summary.unchanged++; continue; }
      steps.push({ state: source.state, ...(source.state === "running" ? { stage: source.stage ?? "source.execute" } : {}) });
    }
    for (const [index, step] of steps.entries()) {
      const result = await service.transition({ workspaceId: source.workspaceId, operationId, expectedRevision: current.revision, to: step.state, stage: step.state === "running" ? source.stage ?? step.stage ?? "source.execute" : null, reasonCode: "source.projection_reconciled", actor: { type: "system", service: "operation-projection" }, metadata: { ...source.metadata, sourceAdapter: source.adapterId, sourceUpdatedAt: source.updatedAt.toISOString() }, idempotencyKey: `project:${fp}:${index}` });
      if (result.kind !== "applied" && result.kind !== "replayed") { summary.conflicts++; break; }
      current = result.operation; summary.transitioned++;
    }
  }
  return summary;
}
