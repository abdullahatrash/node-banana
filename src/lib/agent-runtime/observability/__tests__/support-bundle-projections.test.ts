import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  projectBudgetReservationContractEvidence,
  projectQuotaReservationContractEvidence,
  projectQuotaWaitContractEvidence,
  projectRunContractEvidence,
} from "@/lib/agent-runtime/contract-evidence";
import {
  runtimeContractEvidenceVersions,
  runtimeCostValuations,
  runtimeUsageRecords,
  workflowRunEvents,
} from "@/lib/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryObservabilityRepository } from "../memory";
import { ObservabilityService } from "../service";
import {
  ProductionSupportBundleProjectionReader,
  SupportBundleApplication,
  type SupportBundleContentStore,
  type SupportBundleSelectionRequest,
} from "../support-bundles";
import { InMemorySupportBundleBindIntentRepository } from "../support-bundles-memory";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getArtifact: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/agent-runtime/artifacts", () => ({
  PRODUCTION_ARTIFACT_SERVICE: { getArtifact: mocks.getArtifact },
}));

const now = new Date("2026-08-01T12:00:00.000Z");
const canaries = [
  "PROMPT_CANARY", "CONTENT_CANARY", "MEDIA_CANARY", "CREDENTIAL_CANARY",
  "HEADER_CANARY", "SIGNED_URL_CANARY", "PROVIDER_BODY_CANARY",
];
const poison = {
  prompt: canaries[0], content: canaries[1], mediaMetadata: canaries[2],
  credentials: canaries[3], headers: { authorization: canaries[4] },
  signedUrl: canaries[5], providerBody: { raw: canaries[6] },
};
const digest = `sha256:${"a".repeat(64)}` as const;

const mutableEvidence = [
  {
    workspaceId: "workspace_1", resourceKind: "run", resourceId: "run_1", version: 2,
    canonicalDigest: digest, projectionKind: "run_summary",
    projectionDigest: digest, createdAt: now,
    projection: projectRunContractEvidence({
      id: "run_1", workflowId: "workflow_1", workflowRevisionId: "revision_1",
      state: "completed", startSnapshotDigest: digest, finalSnapshotDigest: digest,
      derivation: null, sourceRunId: null, rootRunId: "run_1", derivationDepth: 0,
      resumeAt: null, failureCode: null, acceptedAt: now, startedAt: now,
      completedAt: now, updatedAt: now,
    } as never),
  },
  {
    workspaceId: "workspace_1", resourceKind: "budget_reservation", resourceId: "budget_1", version: 2,
    canonicalDigest: digest, projectionKind: "budget_summary",
    projectionDigest: digest, createdAt: now,
    projection: projectBudgetReservationContractEvidence({
      id: "budget_1", runId: "run_1", policyId: "policy_1", policyRevisionId: "revision_1",
      scope: "workspace", period: { kind: "calendar_month", timezone: "UTC", startsAt: now, endsAt: now },
      currency: "USD", reservedAmount: "1", heldAmount: "0", settledAmount: "1",
      releasedAmount: "0", state: "settled", pricingSnapshotIds: [], createdAt: now, updatedAt: now,
    } as never),
  },
  {
    workspaceId: "workspace_1", resourceKind: "quota_reservation", resourceId: "quota_1", version: 2,
    canonicalDigest: digest, projectionKind: "quota_reservation_summary",
    projectionDigest: digest, createdAt: now,
    projection: projectQuotaReservationContractEvidence({
      id: "quota_1", runId: "run_1", transitionKey: "transition_1", boundary: "run_admission",
      subject: { kind: "run", id: "run_1" }, policyId: "policy_1", policyRevisionId: "revision_1",
      scope: "workspace", kind: "admission", dimension: "runs@1", unit: "count",
      window: { kind: "calendar_day", timezone: "UTC", startsAt: now, endsAt: now },
      reservationRule: "consume", reservedAmount: "1", heldAmount: "0", settledAmount: "1",
      releasedAmount: "0", overageAmount: "0", state: "settled", createdAt: now, updatedAt: now,
    } as never),
  },
  {
    workspaceId: "workspace_1", resourceKind: "quota_wait", resourceId: "wait_1", version: 2,
    canonicalDigest: digest, projectionKind: "quota_wait_summary",
    projectionDigest: digest, createdAt: now,
    projection: projectQuotaWaitContractEvidence({
      id: "wait_1", runId: "run_1", transitionKey: "transition_1", boundary: "run_admission",
      subject: { kind: "run", id: "run_1" }, claims: [{ dimension: "runs@1", unit: "count", amount: "1" }],
      reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED", eligibleAt: now, state: "resumed",
      resumedBy: { kind: "human", userId: canaries[3] }, resolutionReservationIds: ["quota_1"],
      createdAt: now, resolvedAt: now,
    } as never),
  },
].map((item) => ({
  ...item,
  projectionDigest: canonicalDigest(item.projection),
}));

const sources = new Map<unknown, Record<string, unknown>>([
  [workflowRunEvents, { id: "event_1", runId: "run_1", sequence: 1, type: "run.completed", occurredAt: now, event: poison, ...poison }],
  [runtimeUsageRecords, { id: "usage_1", settlementId: "settlement_1", binding: { runId: "run_1", stepAttemptId: "attempt_1", workflowId: "workflow_1", ...poison }, dimension: "image", unit: "generation", source: "provider", quantity: "1", outcome: "settled", interval: { startedAt: now, endedAt: now, ...poison }, directArtifactId: null, lineageArtifactIds: [], supersedesUsageRecordId: null, recordedAt: now, ...poison }],
  [runtimeCostValuations, { id: "cost_1", settlementId: "settlement_1", runId: "run_1", stepAttemptId: "attempt_1", usageRecordIds: ["usage_1"], basis: "provider", pricingSource: "catalog", amount: "1", currency: "USD", pricingSnapshotIds: [], fxSnapshotId: null, supersedesCostValuationId: null, recordedAt: now, ...poison }],
]);

const selections: SupportBundleSelectionRequest[] = [
  { resourceKind: "run", resourceId: "run_1", projectionKind: "run_summary" },
  { resourceKind: "run_event", resourceId: "event_1", projectionKind: "run_event_summary" },
  { resourceKind: "artifact", resourceId: "artifact_1", projectionKind: "artifact_metadata" },
  { resourceKind: "usage_record", resourceId: "usage_1", projectionKind: "usage_summary" },
  { resourceKind: "cost_valuation", resourceId: "cost_1", projectionKind: "cost_summary" },
  { resourceKind: "budget_reservation", resourceId: "budget_1", projectionKind: "budget_summary" },
  { resourceKind: "quota_reservation", resourceId: "quota_1", projectionKind: "quota_reservation_summary" },
  { resourceKind: "quota_wait", resourceId: "wait_1", projectionKind: "quota_wait_summary" },
];

class Store implements SupportBundleContentStore {
  bytes: Uint8Array | null = null;
  async put(input: { key: string; bytes: Uint8Array }) { this.bytes = new Uint8Array(input.bytes); }
  async get() { if (!this.bytes) throw new Error("missing"); return this.bytes; }
  async delete() { this.bytes = null; }
}

describe("ProductionSupportBundleProjectionReader leakage closure", () => {
  beforeEach(() => {
    let evidenceIndex = 0;
    const db = {
      select: (selection?: Record<string, unknown>) => ({
        from: (table: unknown) => ({
          where: () => table === runtimeContractEvidenceVersions
            ? {
                orderBy: () => ({ limit: async () => {
                  const source = mutableEvidence[evidenceIndex++ % mutableEvidence.length];
                  return source ? [source] : [];
                } }),
              }
            : ({
                limit: async () => {
                  const source = sources.get(table);
                  return source ? [selection ? { value: source } : source] : [];
                },
              }),
        }),
      }),
    };
    mocks.getDb.mockReturnValue(db);
    mocks.getArtifact.mockResolvedValue({ artifact: {
      id: "artifact_1", kind: "image", digest, sizeBytes: 10, mediaType: "image/png",
      width: 1, height: 1, origin: { kind: "generated", providerMetadata: poison },
      retention: { mode: "retained", snapshotAt: now, ...poison },
      lineage: { sourceArtifactIds: [], inputs: [{ port: "image", kind: "source", artifactId: null, contentDigest: digest, ...poison }], ...poison },
      createdAt: now.toISOString(), textContent: canaries[1], ...poison,
    } });
  });

  it("uses a closed projection for every resource path and freezes no source canary", async () => {
    const reader = new ProductionSupportBundleProjectionReader();
    const projected = await Promise.all(selections.map((selection) => reader.project({ workspaceId: "workspace_1", ...selection })));
    for (const item of projected) {
      expect(item).not.toBeNull();
      const serialized = JSON.stringify(item!.content);
      for (const canary of canaries) expect(serialized).not.toContain(canary);
    }
    expect(Object.keys(projected[0]!.content)).toEqual(["schema", "id", "workflowId", "workflowRevisionId", "state", "startSnapshotDigest", "finalSnapshotDigest", "sourceRunId", "rootRunId", "derivationDepth", "resumeAt", "failureCode", "acceptedAt", "startedAt", "completedAt", "updatedAt"]);
    expect(Object.keys(projected[1]!.content)).toEqual(["schema", "id", "runId", "sequence", "type", "occurredAt"]);
    expect(Object.keys(projected[2]!.content)).toEqual(["schema", "id", "kind", "digest", "sizeBytes", "mediaType", "width", "height", "originKind", "retention", "lineage", "createdAt"]);
    expect(projected.filter((_, index) => [0, 5, 6, 7].includes(index)).map((item) => item!.version)).toEqual([2, 2, 2, 2]);

    const repository = new InMemoryObservabilityRepository();
    const service = new ObservabilityService(repository, { encode: async (value) => JSON.stringify(value), decode: async (value) => JSON.parse(value) });
    await service.setRetention({ workspaceId: "workspace_1", metricTtlSeconds: 3600, traceTtlSeconds: 600, supportBundleTtlSeconds: 60, actorUserId: "owner_1", idempotencyKey: "retention_1", recordedAt: now });
    const store = new Store();
    const application = new SupportBundleApplication(service, reader, store, new InMemorySupportBundleBindIntentRepository());
    await application.create({ workspaceId: "workspace_1", actorUserId: "owner_1", selections, purpose: "incident_diagnosis", consentExpiresAt: new Date(now.getTime() + 60_000), idempotencyKey: "projection_canaries", recordedAt: now });
    const frozen = new TextDecoder().decode(store.bytes!);
    expect(frozen).toContain("support-bundle-payload/v1");
    for (const canary of canaries) expect(frozen).not.toContain(canary);
    expect(canonicalDigest(JSON.parse(frozen))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
