import { and, eq } from "drizzle-orm";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { PRODUCTION_ARTIFACT_SERVICE } from "@/lib/agent-runtime/artifacts";
import { getLatestContractEvidenceVersion } from "@/lib/agent-runtime/contract-evidence";
import type { MutableContractEvidenceProjectionKind } from "@/lib/agent-runtime/contract-evidence/types";
import {
  runtimeCostValuations,
  runtimeUsageRecords,
  workflowRunEvents,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import {
  deleteObjectFromS3,
  getObjectFromS3,
  putObjectToS3,
} from "@/lib/storage";
import { ObservabilityError } from "./errors";
import {
  supportBundleSelectionDigest,
  supportBundleStorageKey,
  type ObservabilityService,
} from "./service";
import type {
  CanonicalResourceKind,
  SupportBundleDto,
  SupportBundleProjectionKind,
  SupportBundleSelection,
} from "./types";

type JsonRecord = Record<string, unknown>;

export interface SupportBundleSelectionRequest {
  resourceKind: CanonicalResourceKind;
  resourceId: string;
  projectionKind: SupportBundleProjectionKind;
}

export interface FrozenEvidenceProjection {
  version: number;
  canonicalDigest: `sha256:${string}`;
  content: JsonRecord;
}

export interface SupportBundleProjectionReader {
  project(input: {
    workspaceId: string;
    resourceKind: CanonicalResourceKind;
    resourceId: string;
    projectionKind: SupportBundleProjectionKind;
  }): Promise<FrozenEvidenceProjection | null>;
}

export interface SupportBundleContentStore {
  put(input: { key: string; bytes: Uint8Array }): Promise<void>;
  get(input: { key: string }): Promise<Uint8Array>;
  delete(input: { key: string }): Promise<void>;
}

export interface SupportBundleBindIntent {
  schema: "support-bundle-bind-intent/v1";
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  requestDigest: `sha256:${string}`;
  state: "pending" | "bound" | "cleanup" | "abandoned";
  selections: SupportBundleSelection[];
  consent: {
    schema: "support-bundle-consent/v1";
    grantedByUserId: string;
    purpose: "incident_diagnosis" | "support_case";
    selectionDigest: `sha256:${string}`;
    grantedAt: Date;
    expiresAt: Date;
  };
  contentDigest: `sha256:${string}`;
  sizeBytes: number;
  storageKey: string;
  payloadJson: string | null;
  bundleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportBundleBindIntentRepository {
  withBindLock<T>(input: {
    workspaceId: string;
    idempotencyKey: string;
  }, operation: () => Promise<T>): Promise<T>;
  acquirePrepared(
    intent: SupportBundleBindIntent,
  ): Promise<
    | { kind: "created" | "replayed"; intent: SupportBundleBindIntent }
    | { kind: "conflict" | "unavailable" }
  >;
  markBound(input: {
    workspaceId: string;
    idempotencyKey: string;
    requestDigest: `sha256:${string}`;
    bundleId: string;
    boundAt: Date;
  }): Promise<"bound" | "replayed" | "conflict" | "unavailable">;
  deferPending(input: {
    workspaceId: string;
    idempotencyKey: string;
    requestDigest: `sha256:${string}`;
    retryAt: Date;
  }): Promise<"deferred" | "conflict" | "unavailable">;
  markAbandoned(input: {
    workspaceId: string;
    idempotencyKey: string;
    requestDigest: `sha256:${string}`;
    abandonedAt: Date;
  }): Promise<"abandoned" | "replayed" | "conflict" | "unavailable">;
  markCleanup(input: {
    workspaceId: string;
    bundleId: string;
    retryAt: Date;
  }): Promise<"cleanup" | "replayed" | "not_found" | "conflict" | "unavailable">;
  deferCleanup(input: {
    id: string;
    retryAt: Date;
  }): Promise<"deferred" | "conflict" | "unavailable">;
  listPending(input: {
    at: Date;
    limit: number;
  }): Promise<SupportBundleBindIntent[]>;
  listCleanup(input: { at: Date; limit: number }): Promise<SupportBundleBindIntent[]>;
}
export { supportBundleIntentMatchesRecord } from "./support-bundle-intent-match";

const PROJECTION_BY_RESOURCE: Record<
  CanonicalResourceKind,
  SupportBundleProjectionKind
> = {
  run: "run_summary",
  run_event: "run_event_summary",
  artifact: "artifact_metadata",
  usage_record: "usage_summary",
  cost_valuation: "cost_summary",
  budget_reservation: "budget_summary",
  quota_reservation: "quota_reservation_summary",
  quota_wait: "quota_wait_summary",
};
const OBSERVABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

class SupportBundleIntentAbandonedError extends ObservabilityError {
  constructor() {
    super("OBSERVABILITY_UNAVAILABLE", "Support Bundle consent has expired.");
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function iso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function digest(value: unknown): `sha256:${string}` {
  return canonicalDigest(value) as `sha256:${string}`;
}

function canonicalSource(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalSource);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, canonicalSource(child)]),
    );
  }
  return value;
}

function projection(
  version: number,
  source: unknown,
  content: JsonRecord,
): FrozenEvidenceProjection {
  return { version, canonicalDigest: digest(canonicalSource(source)), content };
}

function usageProjection(value: unknown): JsonRecord {
  const item = record(value);
  const binding = record(item.binding);
  const interval = record(item.interval);
  return {
    schema: "support-usage-summary/v1",
    id: item.id,
    settlementId: item.settlementId,
    runId: binding.runId,
    stepAttemptId: binding.stepAttemptId,
    workflowId: binding.workflowId,
    dimension: item.dimension,
    unit: item.unit,
    source: item.source,
    quantity: item.quantity ?? null,
    outcome: item.outcome,
    interval: {
      startedAt: iso(interval.startedAt),
      endedAt: iso(interval.endedAt),
    },
    directArtifactId: item.directArtifactId ?? null,
    lineageArtifactIds: strings(item.lineageArtifactIds),
    supersedesUsageRecordId: item.supersedesUsageRecordId ?? null,
    recordedAt: iso(item.recordedAt),
  };
}

function costProjection(value: unknown): JsonRecord {
  const item = record(value);
  return {
    schema: "support-cost-summary/v1",
    id: item.id,
    settlementId: item.settlementId,
    runId: item.runId,
    stepAttemptId: item.stepAttemptId,
    usageRecordIds: strings(item.usageRecordIds),
    basis: item.basis,
    pricingSource: item.pricingSource,
    amount: item.amount ?? null,
    currency: item.currency ?? null,
    pricingSnapshotIds: strings(item.pricingSnapshotIds),
    fxSnapshotId: item.fxSnapshotId ?? null,
    supersedesCostValuationId: item.supersedesCostValuationId ?? null,
    recordedAt: iso(item.recordedAt),
  };
}

export class ProductionSupportBundleProjectionReader
  implements SupportBundleProjectionReader
{
  async project(
    input: Parameters<SupportBundleProjectionReader["project"]>[0],
  ): Promise<FrozenEvidenceProjection | null> {
    if (PROJECTION_BY_RESOURCE[input.resourceKind] !== input.projectionKind) {
      return null;
    }
    const db = getDb();
    if (
      input.resourceKind === "run" ||
      input.resourceKind === "budget_reservation" ||
      input.resourceKind === "quota_reservation" ||
      input.resourceKind === "quota_wait"
    ) {
      const attached = await getLatestContractEvidenceVersion(db, {
        workspaceId: input.workspaceId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        projectionKind: input.projectionKind as MutableContractEvidenceProjectionKind,
      });
      return attached ? {
        version: attached.version,
        canonicalDigest: attached.canonicalDigest,
        content: attached.projection,
      } : null;
    }
    if (input.resourceKind === "run_event") {
      const [row] = await db
        .select()
        .from(workflowRunEvents)
        .where(
          and(
            eq(workflowRunEvents.workspaceId, input.workspaceId),
            eq(workflowRunEvents.id, input.resourceId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return projection(row.sequence, row, {
        schema: "support-run-event-summary/v1",
        id: row.id,
        runId: row.runId,
        sequence: row.sequence,
        type: row.type,
        occurredAt: iso(row.occurredAt),
      });
    }
    if (input.resourceKind === "artifact") {
      let found;
      try {
        found = await PRODUCTION_ARTIFACT_SERVICE.getArtifact({
          workspaceId: input.workspaceId,
          artifactId: input.resourceId,
        });
      } catch {
        return null;
      }
      const item = found.artifact;
      const retention = record(item.retention);
      return {
        version: 1,
        canonicalDigest: item.digest as `sha256:${string}`,
        content: {
        schema: "support-artifact-metadata/v1",
        id: item.id,
        kind: item.kind,
        digest: item.digest,
        sizeBytes: item.sizeBytes,
        mediaType: item.mediaType,
        width: item.width,
        height: item.height,
        originKind: item.origin.kind,
        retention: {
          mode: retention.mode,
          snapshotAt: retention.snapshotAt,
        },
        lineage: {
          sourceArtifactIds: item.lineage.sourceArtifactIds,
          inputs: item.lineage.inputs.map((lineage) => ({
            port: lineage.port,
            kind: lineage.kind,
            artifactId: lineage.artifactId,
            contentDigest: lineage.contentDigest,
          })),
        },
          createdAt: item.createdAt,
        },
      };
    }
    if (input.resourceKind === "usage_record") {
      const [row] = await db
        .select({ value: runtimeUsageRecords.record })
        .from(runtimeUsageRecords)
        .where(
          and(
            eq(runtimeUsageRecords.workspaceId, input.workspaceId),
            eq(runtimeUsageRecords.id, input.resourceId),
          ),
        )
        .limit(1);
      return row ? projection(1, row.value, usageProjection(row.value)) : null;
    }
    if (input.resourceKind === "cost_valuation") {
      const [row] = await db
        .select({ value: runtimeCostValuations.valuation })
        .from(runtimeCostValuations)
        .where(
          and(
            eq(runtimeCostValuations.workspaceId, input.workspaceId),
            eq(runtimeCostValuations.id, input.resourceId),
          ),
        )
        .limit(1);
      return row ? projection(1, row.value, costProjection(row.value)) : null;
    }
    return null;
  }
}

export class S3SupportBundleContentStore
  implements SupportBundleContentStore
{
  async put(input: { key: string; bytes: Uint8Array }) {
    await putObjectToS3({
      key: input.key,
      body: input.bytes,
      contentType: "application/json",
    });
  }

  async get(input: { key: string }) {
    const stored = await getObjectFromS3({ key: input.key });
    return new Uint8Array(stored.body);
  }

  delete(input: { key: string }) {
    return deleteObjectFromS3({ key: input.key });
  }
}

export class SupportBundleApplication {
  constructor(
    private readonly service: ObservabilityService,
    private readonly reader: SupportBundleProjectionReader,
    private readonly contentStore: SupportBundleContentStore,
    private readonly intents: SupportBundleBindIntentRepository,
  ) {}

  async create(input: {
    workspaceId: string;
    actorUserId: string;
    selections: SupportBundleSelectionRequest[];
    purpose: "incident_diagnosis" | "support_case";
    consentExpiresAt: Date;
    idempotencyKey: string;
    recordedAt: Date;
  }): Promise<SupportBundleDto> {
    if (
      input.workspaceId !== input.workspaceId.trim() || !OBSERVABILITY_ID.test(input.workspaceId) ||
      input.actorUserId !== input.actorUserId.trim() || !OBSERVABILITY_ID.test(input.actorUserId) ||
      input.idempotencyKey !== input.idempotencyKey.trim() || !OBSERVABILITY_ID.test(input.idempotencyKey) ||
      !Number.isFinite(input.recordedAt.getTime()) ||
      !(["incident_diagnosis", "support_case"] as const).includes(input.purpose) ||
      input.selections.length < 1 ||
      input.selections.length > 100 ||
      input.selections.some((selection) => selection.resourceId !== selection.resourceId.trim() || !OBSERVABILITY_ID.test(selection.resourceId)) ||
      !Number.isFinite(input.consentExpiresAt.getTime()) ||
      input.consentExpiresAt <= input.recordedAt ||
      input.consentExpiresAt.getTime() >
        input.recordedAt.getTime() + 604_800_000
    ) {
      throw new ObservabilityError(
        "OBSERVABILITY_INVALID_INPUT",
        "Support Bundle consent or selection is invalid.",
      );
    }
    const unique = new Set(
      input.selections.map(
        (item) => `${item.resourceKind}:${item.resourceId}:${item.projectionKind}`,
      ),
    );
    if (unique.size !== input.selections.length) {
      throw new ObservabilityError(
        "OBSERVABILITY_INVALID_INPUT",
        "Support Bundle selections must be unique.",
      );
    }

    const requestDigest = digest({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      selections: input.selections,
      purpose: input.purpose,
      consentExpiresAt: input.consentExpiresAt.toISOString(),
    });
    const frozenItems = [] as Array<{
      selection: SupportBundleSelection;
      content: JsonRecord;
    }>;
    for (const requested of input.selections) {
      if (PROJECTION_BY_RESOURCE[requested.resourceKind] !== requested.projectionKind) {
        throw new ObservabilityError(
          "OBSERVABILITY_INVALID_INPUT",
          "Support Bundle projection does not match the selected resource.",
        );
      }
      const frozen = await this.reader.project({
        workspaceId: input.workspaceId,
        ...requested,
      });
      if (!frozen) {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "The selected observability resource is unavailable.",
        );
      }
      if (
        !Number.isSafeInteger(frozen.version) || frozen.version < 1 ||
        !SHA256_DIGEST.test(frozen.canonicalDigest) ||
        !frozen.content || typeof frozen.content !== "object" || Array.isArray(frozen.content)
      ) {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "The selected observability projection is invalid.",
        );
      }
      const contentBytes = new TextEncoder().encode(canonicalJson(frozen.content));
      if (contentBytes.byteLength < 1 || contentBytes.byteLength > 10_000_000) {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "The selected observability projection is invalid.",
        );
      }
      frozenItems.push({
        selection: {
          reference: {
            schema: "contract-evidence-reference/v1",
            workspaceId: input.workspaceId,
            resourceKind: requested.resourceKind,
            resourceId: requested.resourceId,
            version: frozen.version,
            digest: frozen.canonicalDigest,
          },
          projectionKind: requested.projectionKind,
          projectedContentDigest: digest(frozen.content),
          projectedSizeBytes: contentBytes.byteLength,
        },
        content: frozen.content,
      });
    }

    const selections = frozenItems.map((item) => item.selection);
    const payload = {
      schema: "support-bundle-payload/v1",
      selections: frozenItems.map(({ selection, content }) => ({
        reference: selection.reference,
        projectionKind: selection.projectionKind,
        content,
      })),
    };
    const bytes = new TextEncoder().encode(canonicalJson(payload));
    if (bytes.byteLength < 1 || bytes.byteLength > 10_000_000) {
      throw new ObservabilityError(
        "OBSERVABILITY_INVALID_INPUT",
        "Support Bundle payload size is invalid.",
      );
    }
    const contentDigest = digest(payload);
    const storageKey = supportBundleStorageKey(
      input.workspaceId,
      input.idempotencyKey,
      contentDigest,
    );
    const consent = {
      schema: "support-bundle-consent/v1" as const,
      grantedByUserId: input.actorUserId,
      purpose: input.purpose,
      selectionDigest: supportBundleSelectionDigest(selections),
      grantedAt: input.recordedAt,
      expiresAt: input.consentExpiresAt,
    };
    const acquired = await this.intents.acquirePrepared({
      schema: "support-bundle-bind-intent/v1",
      id: `sbi_${digest({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest }).slice(7, 39)}`,
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      state: "pending",
      selections,
      consent,
      contentDigest,
      sizeBytes: bytes.byteLength,
      storageKey,
      payloadJson: canonicalJson(payload),
      bundleId: null,
      createdAt: input.recordedAt,
      updatedAt: input.recordedAt,
    });
    if (acquired.kind === "conflict") {
      throw new ObservabilityError(
        "OBSERVABILITY_CONFLICT",
        "Support Bundle conflicts with prior consent evidence.",
      );
    }
    if (acquired.kind === "unavailable") {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "Support Bundle intent persistence is unavailable.",
      );
    }
    if (!("intent" in acquired)) {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "Support Bundle intent persistence is unavailable.",
      );
    }
    return this.bindIntent(acquired.intent, input.recordedAt);
  }

  private async bindIntent(
    intent: SupportBundleBindIntent,
    attemptedAt: Date,
  ): Promise<SupportBundleDto> {
    return this.intents.withBindLock({
      workspaceId: intent.workspaceId,
      idempotencyKey: intent.idempotencyKey,
    }, async () => {
      const refreshed = await this.intents.acquirePrepared(intent);
      if (!("intent" in refreshed)) {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "Support Bundle intent persistence is unavailable.",
        );
      }
      return await this.bindIntentUnlocked(refreshed.intent, attemptedAt);
    });
  }

  private async bindIntentUnlocked(
    intent: SupportBundleBindIntent,
    attemptedAt: Date,
  ): Promise<SupportBundleDto> {
    if (intent.state === "abandoned") {
      try {
        await this.contentStore.delete({ key: intent.storageKey });
        await this.intents.deferCleanup({ id: intent.id, retryAt: new Date(attemptedAt.getTime() + 60_000) });
      } catch {}
      throw new SupportBundleIntentAbandonedError();
    }
    if (intent.state === "pending") {
      if (attemptedAt >= intent.consent.expiresAt) {
        const abandoned = await this.intents.markAbandoned({
          workspaceId: intent.workspaceId,
          idempotencyKey: intent.idempotencyKey,
          requestDigest: intent.requestDigest,
          abandonedAt: attemptedAt,
        });
        if (abandoned !== "abandoned" && abandoned !== "replayed") {
          throw new ObservabilityError(
            "OBSERVABILITY_UNAVAILABLE",
            "Support Bundle intent persistence is unavailable.",
          );
        }
        try {
          await this.contentStore.delete({ key: intent.storageKey });
          await this.intents.deferCleanup({ id: intent.id, retryAt: new Date(attemptedAt.getTime() + 60_000) });
        } catch {}
        throw new SupportBundleIntentAbandonedError();
      }
      if (!intent.payloadJson) throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "Support Bundle frozen intent is unavailable.",
      );
      const bytes = new TextEncoder().encode(intent.payloadJson);
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(intent.payloadJson);
      } catch {
        parsedPayload = null;
      }
      if (bytes.byteLength < 1 || bytes.byteLength > 10_000_000 || bytes.byteLength !== intent.sizeBytes || !parsedPayload || digest(parsedPayload) !== intent.contentDigest) {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "Support Bundle frozen intent is unavailable.",
        );
      }
      try {
        await this.contentStore.put({ key: intent.storageKey, bytes });
      } catch {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "Support Bundle content storage is unavailable.",
        );
      }
    }
    const bundle = await this.service.createStoredSupportBundle({
      workspaceId: intent.workspaceId,
      selections: intent.selections,
      consent: intent.consent,
      contentDigest: intent.contentDigest,
      sizeBytes: intent.sizeBytes,
      idempotencyKey: intent.idempotencyKey,
      storedAt: intent.createdAt,
      recordedAt: intent.createdAt,
      bindIntentRequestDigest: intent.requestDigest,
    });
    const bound = await this.intents.markBound({
      workspaceId: intent.workspaceId,
      idempotencyKey: intent.idempotencyKey,
      requestDigest: intent.requestDigest,
      bundleId: bundle.id,
      boundAt: attemptedAt,
    });
    if (bound !== "bound" && bound !== "replayed") {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "Support Bundle intent persistence is unavailable.",
      );
    }
    if (bundle.state !== "stored") {
      try {
        await this.contentStore.delete({ key: intent.storageKey });
      } catch {
        throw new ObservabilityError(
          "OBSERVABILITY_UNAVAILABLE",
          "Support Bundle content cleanup is unavailable.",
        );
      }
    }
    return bundle;
  }

  async readPayload(input: {
    workspaceId: string;
    bundleId: string;
    operatorGrantId: string;
    operatorId: string;
    at: Date;
  }): Promise<{ bundle: SupportBundleDto; payload: JsonRecord } | null> {
    const locator = await this.service.readSupportBundlePayload(input);
    if (!locator) return null;
    let bytes: Uint8Array;
    try {
      bytes = await this.contentStore.get({ key: locator.storageKey });
    } catch {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "The selected observability resource is unavailable.",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      payload = null;
    }
    if (
      bytes.byteLength !== locator.sizeBytes ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      digest(payload) !== locator.contentDigest
    ) {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "The selected observability resource is unavailable.",
      );
    }
    const payloadRecord = payload as JsonRecord;
    const items = Array.isArray(payloadRecord.selections)
      ? payloadRecord.selections
      : [];
    const manifestMatches =
      payloadRecord.schema === "support-bundle-payload/v1" &&
      items.length === locator.bundle.selections.length &&
      items.every((value, index) => {
        const item = record(value);
        const selected = locator.bundle.selections[index];
        const content = record(item.content);
        const contentBytes = new TextEncoder().encode(canonicalJson(content));
        return (
          canonicalJson(item.reference) === canonicalJson(selected.reference) &&
          item.projectionKind === selected.projectionKind &&
          digest(content) === selected.projectedContentDigest &&
          contentBytes.byteLength === selected.projectedSizeBytes
        );
      });
    if (!manifestMatches) {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "The selected observability resource is unavailable.",
      );
    }
    return { bundle: locator.bundle, payload: payloadRecord };
  }

  async revoke(input: {
    workspaceId: string;
    bundleId: string;
    actorUserId: string;
    actorRole: "owner" | "admin" | "member";
    recordedAt: Date;
  }) {
    const result = await this.service.revokeSupportBundle(input);
    const cleanup = await this.drainCleanup({ at: input.recordedAt, limit: 100 });
    if (cleanup.errors > 0) {
      throw new ObservabilityError(
        "OBSERVABILITY_UNAVAILABLE",
        "Support Bundle content cleanup is unavailable.",
      );
    }
    return result;
  }

  async drainCleanup(input: { at: Date; limit: number }) {
    const tombstones = await this.intents.listCleanup(input);
    let errors = 0;
    for (const tombstone of tombstones) {
      try {
        await this.contentStore.delete({ key: tombstone.storageKey });
        await this.intents.deferCleanup({
          id: tombstone.id,
          retryAt: new Date(input.at.getTime() + 60_000),
        });
      } catch {
        errors += 1;
        try {
          await this.intents.deferCleanup({
            id: tombstone.id,
            retryAt: new Date(input.at.getTime() + 60_000),
          });
        } catch {}
      }
    }
    const targets = await this.service.listSupportBundleCleanup(input);
    let deleted = 0;
    let acknowledged = 0;
    for (const target of targets) {
      try {
        const intentCleanup = await this.intents.markCleanup({
          workspaceId: target.workspaceId,
          bundleId: target.bundleId,
          retryAt: new Date(input.at.getTime() + 60_000),
        });
        if (!["cleanup", "replayed", "not_found"].includes(intentCleanup)) throw new Error("intent cleanup unavailable");
        await this.contentStore.delete({ key: target.storageKey });
        deleted += 1;
        const result = await this.service.acknowledgeSupportBundleCleanup(target);
        if (result === "cleared" || result === "replayed") {
          acknowledged += 1;
        } else {
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }
    return { scanned: targets.length + tombstones.length, deleted, acknowledged, errors };
  }

  async reconcilePending(input: { at: Date; limit: number }) {
    if (!Number.isFinite(input.at.getTime()) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ObservabilityError(
        "OBSERVABILITY_INVALID_INPUT",
        "Support Bundle reconciliation page is invalid.",
      );
    }
    const pending = await this.intents.listPending(input);
    let bound = 0;
    let abandoned = 0;
    let errors = 0;
    for (const intent of pending) {
      try {
        await this.bindIntent(intent, input.at);
        bound += 1;
      } catch (error) {
        if (error instanceof SupportBundleIntentAbandonedError) {
          abandoned += 1;
          continue;
        }
        errors += 1;
        await this.intents.deferPending({
          workspaceId: intent.workspaceId,
          idempotencyKey: intent.idempotencyKey,
          requestDigest: intent.requestDigest,
          retryAt: new Date(input.at.getTime() + 1_000),
        });
      }
    }
    return { scanned: pending.length, bound, abandoned, errors };
  }

  async expireAndDrain(input: { at: Date; limit: number }) {
    const intents = await this.reconcilePending(input);
    const expired = await this.service.expire(input.at, input.limit);
    const cleanup = await this.drainCleanup(input);
    return { intents, expired, cleanup };
  }
}
