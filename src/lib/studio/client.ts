import type { CredentialHumanCapabilityIdentity } from "@/lib/credential-vault/application-capabilities";
import type { UsageCapabilityIdentity } from "@/lib/agent-runtime/usage/capabilities";
import type { BudgetHumanCapabilityIdentity } from "@/lib/agent-runtime/budgets/capabilities";
import type { QuotaCapabilityIdentity } from "@/lib/agent-runtime/quotas/capabilities";
import type { ObservabilityCapabilityIdentity } from "@/lib/agent-runtime/observability/capabilities";
import type {
  WorkflowRunDto,
  WorkflowRunEventDto,
  WorkflowStepAttemptDto,
} from "@/lib/agent-runtime/runs/types";
import type { ArtifactMetadata } from "@/lib/agent-runtime/artifacts/types";
import type { WorkflowRevisionDto } from "@/lib/agent-runtime/workflows/types";
import type { BudgetReservation } from "@/lib/agent-runtime/budgets/types";
import type { QuotaReservation, QuotaWait } from "@/lib/agent-runtime/quotas/types";
import type { CostValuation, UsageRecord, UsageSource, UsageUnit } from "@/lib/agent-runtime/usage/types";
import type { DiagnosticTrace } from "@/lib/agent-runtime/observability/types";
import type {
  PublishingDeliveryCancellationDto,
  PublishingDeliveryDto,
  PublishingDeliveryEventDto,
  PublishingDeliveryReconciliationDto,
} from "@/lib/agent-runtime/publishing-deliveries/types";
import type { PublishingPlanRevisionDto } from "@/lib/agent-runtime/publishing-plans/types";
import type { PublishingApprovalDto } from "@/lib/agent-runtime/publishing-approvals/types";
import type { BudgetPolicy, BudgetPolicyRevision } from "@/lib/agent-runtime/budgets/types";
import type { EffectiveQuotaCapacity } from "@/lib/agent-runtime/quotas/types";

export type QuotaApplicationCapabilityIdentity =
  | QuotaCapabilityIdentity
  | Extract<BudgetHumanCapabilityIdentity, `spend_controls.${string}@1`>;

type JsonRecord = Record<string, unknown>;

const ACTIVE_WORKSPACE_STORAGE_KEY = "node-banana-active-workspace-id";

export class StudioApiError extends Error {
  status: number;
  code: string | null;
  operatorTraceRef: string | null;

  constructor(
    status: number,
    message: string,
    options: { code?: string | null; operatorTraceRef?: string | null } = {},
  ) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = options.code ?? null;
    this.operatorTraceRef = options.operatorTraceRef ?? null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readApiError(data: unknown): string {
  const record = asRecord(data);
  const error = record?.error;
  return typeof error === "string" && error.trim()
    ? error
    : "Unexpected API response";
}

function getFriendlyStatusMessage(status: number, fallback: string): string {
  if (status === 401) return "Please sign in to access AI Studio.";
  if (status === 403) return "You do not have access to this workspace.";
  return fallback;
}

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  if (typeof window === "undefined") return;
  if (!workspaceId || !workspaceId.trim()) {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId.trim());
}

function mergeHeaders(init?: RequestInit, requireWorkspace = true): Headers {
  const headers = new Headers(init?.headers || {});
  if (requireWorkspace) {
    const activeWorkspaceId = getActiveWorkspaceId();
    if (activeWorkspaceId) {
      headers.set("x-workspace-id", activeWorkspaceId);
    }
  }
  return headers;
}

async function fetchApi(
  input: RequestInfo,
  init?: RequestInit,
  options?: { requireWorkspace?: boolean; preserveForbiddenMessage?: boolean },
): Promise<JsonRecord> {
  const requireWorkspace = options?.requireWorkspace ?? true;
  const activeWorkspaceId = getActiveWorkspaceId();
  if (requireWorkspace && !activeWorkspaceId) {
    throw new StudioApiError(403, "Select a workspace to continue.");
  }

  const response = await fetch(input, {
    ...init,
    headers: mergeHeaders(init, requireWorkspace),
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new StudioApiError(
      response.status,
      getFriendlyStatusMessage(
        response.status,
        `Request failed with status ${response.status}`,
      ),
    );
  }

  const record = asRecord(data);
  if (!record) {
    throw new StudioApiError(
      response.status,
      getFriendlyStatusMessage(
        response.status,
        `Invalid API response for ${typeof input === "string" ? input : "request"}`,
      ),
    );
  }

  const success = record.success;
  if (typeof success !== "boolean") {
    const message = readApiError(record);
    throw new StudioApiError(
      response.status,
      getFriendlyStatusMessage(response.status, message),
    );
  }

  if (!response.ok || !success) {
    const message = readApiError(record);
    throw new StudioApiError(response.status,
      response.status === 403 && options?.preserveForbiddenMessage
        ? message
        : getFriendlyStatusMessage(response.status, message), {
      code: asString(record.code),
      operatorTraceRef: asString(record.operatorTraceRef),
    });
  }

  return record;
}

export type RunInspectionCapabilityIdentity =
  | "workflow_runs.get@2"
  | "workflow_run_events.list@2"
  | "workflow_step_attempts.list@2"
  | "workflow_run_artifacts.get@2"
  | "workflow_versions.get@2"
  | "usage_records.list@1"
  | "cost_valuations.list@1"
  | "usage_summaries.get@1"
  | "budget_reservations.list@1"
  | "quota_reservations.list@1"
  | "quota_waits.list@1"
  | "diagnostic_traces.get@1";

export type PublicJson<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? PublicJson<Item>[]
    : T extends object
      ? { [Key in keyof T]: PublicJson<T[Key]> }
      : T;

export interface UsageSummaryDto {
  schema: "usage-summary/v1";
  quantityTotals: Array<{
    dimension: string;
    unit: UsageUnit;
    source: UsageSource;
    quantity: string | null;
    unknownCount: number;
  }>;
  costSubtotals: Array<{ currency: string; amount: string; knownCount: number }>;
  unknownValuationCount: number;
  complete: boolean;
}

export type DiagnosticTraceDto = PublicJson<Omit<DiagnosticTrace, "workspaceId">>;

export interface RunInspectionInputMap {
  "workflow_runs.get@2": { workflowId: string; runId: string };
  "workflow_run_events.list@2": { workflowId: string; runId: string; cursor?: string };
  "workflow_step_attempts.list@2": { workflowId: string; runId: string };
  "workflow_run_artifacts.get@2": { workflowId: string; runId: string; artifactId: string };
  "workflow_versions.get@2": { workflowId: string; revisionId: string };
  "usage_records.list@1": { runId: string; limit: number; cursor?: string };
  "cost_valuations.list@1": { runId: string; limit: number; cursor?: string };
  "usage_summaries.get@1": { runId: string };
  "budget_reservations.list@1": { runId: string };
  "quota_reservations.list@1": { runId: string; limit: number };
  "quota_waits.list@1": { runId: string; limit: number };
  "diagnostic_traces.get@1": { operatorTraceRef: string; operatorGrantId: string };
}

export interface RunInspectionResultMap {
  "workflow_runs.get@2": WorkflowRunDto;
  "workflow_run_events.list@2": {
    items: WorkflowRunEventDto[];
    nextCursor: string;
  };
  "workflow_step_attempts.list@2": { items: WorkflowStepAttemptDto[] };
  "workflow_run_artifacts.get@2": {
    artifact: ArtifactMetadata;
    textContent: string | null;
  };
  "workflow_versions.get@2": WorkflowRevisionDto;
  "usage_records.list@1": {
    schema: "usage-record-page/v1";
    items: PublicJson<UsageRecord>[];
    nextCursor: string | null;
  };
  "cost_valuations.list@1": {
    schema: "cost-valuation-page/v1";
    items: PublicJson<CostValuation>[];
    nextCursor: string | null;
  };
  "usage_summaries.get@1": UsageSummaryDto;
  "budget_reservations.list@1": {
    schema: "budget-reservation-list/v1";
    items: PublicJson<BudgetReservation>[];
  };
  "quota_reservations.list@1": {
    schema: "quota-reservation-list/v1";
    items: PublicJson<QuotaReservation>[];
  };
  "quota_waits.list@1": {
    schema: "quota-wait-list/v1";
    items: PublicJson<QuotaWait>[];
  };
  "diagnostic_traces.get@1": DiagnosticTraceDto;
}

export async function invokeRunInspectionApplicationCapability<
  Capability extends RunInspectionCapabilityIdentity,
>(
  capability: Capability,
  input: RunInspectionInputMap[Capability],
): Promise<RunInspectionResultMap[Capability]> {
  const response = await fetchApi("/api/studio/runs/capabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for Run inspection capability ${capability}.`,
    );
  }
  return result as RunInspectionResultMap[Capability];
}

export type DeliveryOperationsCapabilityIdentity =
  | "publishing_deliveries.get@2"
  | "publishing_deliveries.list@2"
  | "publishing_delivery_events.list@2"
  | "publishing_plan_revisions.get@2"
  | "publishing_approvals.get@2"
  | "publishing_deliveries.cancel@1"
  | "publishing_deliveries.reconcile@1"
  | "budget_policies.get_effective@1"
  | "budget_reservations.list@1"
  | "budget_status.get@1"
  | "quota_policies.get_effective@1"
  | "quota_reservations.list@1"
  | "quota_waits.list@1"
  | "quota_waits.resume@1"
  | "spend_controls.get@2"
  | "spend_controls.suspend@2"
  | "spend_controls.resume@2";

interface DeliveryResourceManifest {
  deliveryId: string;
  channelIds: string[];
  artifactIds: string[];
}

export interface DeliveryOperationsInputMap {
  "publishing_deliveries.get@2": {
    deliveryId: string;
    channelIds?: string[];
    artifactIds?: string[];
  };
  "publishing_deliveries.list@2": {
    channelIds?: string[];
    artifactIds?: string[];
    planRevisionId?: string;
    state?: PublishingDeliveryDto["state"];
    targetId?: string;
    limit?: number;
    cursor?: string;
  };
  "publishing_delivery_events.list@2": {
    deliveryId: string;
    channelIds?: string[];
    artifactIds?: string[];
    afterSequence?: number;
    limit?: number;
  };
  "publishing_plan_revisions.get@2": { revisionId: string };
  "publishing_approvals.get@2": { approvalRequestId: string };
  "publishing_deliveries.cancel@1": DeliveryResourceManifest;
  "publishing_deliveries.reconcile@1": DeliveryResourceManifest & {
    expectedUnknownEvidenceDigest: string;
  };
  "budget_policies.get_effective@1": { principalId: string };
  "budget_reservations.list@1": { principalId?: string };
  "budget_status.get@1": { principalId: string };
  "quota_policies.get_effective@1": { principalId: string };
  "quota_reservations.list@1": { principalId?: string; limit?: number };
  "quota_waits.list@1": {
    principalId?: string;
    state?: "waiting" | "resumed" | "cancelled";
    limit?: number;
  };
  "quota_waits.resume@1": { waitId: string };
  "spend_controls.get@2": Record<string, never>;
  "spend_controls.suspend@2": { reason: string };
  "spend_controls.resume@2": { reason: string };
}

export interface WorkspaceSpendControlEvidenceDto {
  schema: "workspace-spend-control/v2";
  workspaceId: string;
  suspended: boolean;
  revision: number;
  reason: string | null;
  actorUserId: string | null;
  recordedAt: string | null;
  policyEventId: string | null;
  authorizationEvidenceRef: string | null;
}

export interface DeliveryOperationsResultMap {
  "publishing_deliveries.get@2": {
    schema: "publishing-delivery-inspection/v2";
    delivery: PublishingDeliveryDto;
    cancellation: PublishingDeliveryCancellationDto | null;
  };
  "publishing_deliveries.list@2": {
    schema: "publishing-delivery-page/v1";
    items: PublishingDeliveryDto[];
    nextCursor: string | null;
  };
  "publishing_delivery_events.list@2": {
    schema: "publishing-delivery-event-page/v1";
    items: PublishingDeliveryEventDto[];
    nextAfterSequence: number | null;
  };
  "publishing_plan_revisions.get@2": PublishingPlanRevisionDto;
  "publishing_approvals.get@2": {
    projection: "human";
    approval: PublicJson<PublishingApprovalDto>;
  };
  "publishing_deliveries.cancel@1": PublishingDeliveryCancellationDto;
  "publishing_deliveries.reconcile@1": PublishingDeliveryReconciliationDto;
  "budget_policies.get_effective@1": {
    schema: "effective-budget-policy-list/v1";
    items: Array<{
      policy: PublicJson<BudgetPolicy>;
      revision: PublicJson<Omit<BudgetPolicyRevision, "createdByUserId">>;
    }>;
  };
  "budget_reservations.list@1": {
    schema: "budget-reservation-list/v1";
    items: PublicJson<BudgetReservation>[];
  };
  "budget_status.get@1": {
    schema: "budget-status/v1";
    workspaceId: string;
    principalId: string;
    evaluatedAt: string;
    items: Array<{
      scope: "workspace" | "principal";
      policyId: string;
      policyRevisionId: string;
      currency: string;
      period: {
        kind: "calendar_day" | "calendar_week" | "calendar_month" | "lifetime";
        timezone: string;
        startsAt: string;
        endsAt: string | null;
      };
      warningThreshold: string;
      hardLimit: string;
      committed: string;
      available: string;
      warningState: "below_warning" | "warning" | "hard_limit_reached";
      certainty: "known" | "contains_unknown_cost";
      unknownReservationCount: number;
    }>;
  };
  "quota_policies.get_effective@1": {
    schema: "effective-quota-capacity-list/v1";
    items: PublicJson<EffectiveQuotaCapacity>[];
  };
  "quota_reservations.list@1": {
    schema: "quota-reservation-list/v1";
    items: PublicJson<QuotaReservation>[];
  };
  "quota_waits.list@1": {
    schema: "quota-wait-list/v1";
    items: PublicJson<QuotaWait>[];
  };
  "quota_waits.resume@1": { wait: PublicJson<QuotaWait> };
  "spend_controls.get@2": WorkspaceSpendControlEvidenceDto;
  "spend_controls.suspend@2": WorkspaceSpendControlEvidenceDto;
  "spend_controls.resume@2": WorkspaceSpendControlEvidenceDto;
}

export async function invokeDeliveryOperationsApplicationCapability<
  Capability extends DeliveryOperationsCapabilityIdentity,
>(
  capability: Capability,
  input: DeliveryOperationsInputMap[Capability],
  options: { idempotencyKey?: string } = {},
): Promise<DeliveryOperationsResultMap[Capability]> {
  const response = await fetchApi("/api/studio/publishing-deliveries/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  }, { preserveForbiddenMessage: true });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for Delivery operations capability ${capability}.`,
    );
  }
  return result as DeliveryOperationsResultMap[Capability];
}

export async function invokeCredentialApplicationCapability(
  capability: CredentialHumanCapabilityIdentity,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const response = await fetchApi("/api/studio/credentials/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for credential capability ${capability}.`,
    );
  }
  return result;
}

export async function invokeUsageApplicationCapability(
  capability: UsageCapabilityIdentity,
  input: Record<string, unknown> = {},
): Promise<JsonRecord> {
  const response = await fetchApi("/api/studio/usage/capabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(500, `Invalid output for usage capability ${capability}.`);
  }
  return result;
}

export async function invokeBudgetApplicationCapability(
  capability: BudgetHumanCapabilityIdentity,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const response = await fetchApi("/api/studio/budgets/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for Budget capability ${capability}.`,
    );
  }
  return result;
}

export async function invokeQuotaApplicationCapability(
  capability: QuotaApplicationCapabilityIdentity,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const response = await fetchApi("/api/studio/quotas/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for Quota capability ${capability}.`,
    );
  }
  return result;
}

export async function invokeObservabilityApplicationCapability(
  capability: ObservabilityCapabilityIdentity,
  input: Record<string, unknown> = {},
  options: { idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const response = await fetchApi("/api/studio/observability/capabilities", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({ capability, input }),
    cache: "no-store",
  });
  const result = asRecord(response.result);
  if (!result) {
    throw new StudioApiError(
      500,
      `Invalid output for observability capability ${capability}.`,
    );
  }
  return result;
}


export interface StudioWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface StudioAsset {
  id: string;
  workspaceId: string;
  type: string | null;
  storageProvider: string | null;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface StudioAssetPresignInput {
  projectId?: string | null;
  assetType: "image" | "video" | "audio" | "model3d";
  fileName?: string;
  contentType: string;
  expectedSizeBytes: number;
}

export interface StudioAssetPresignResult {
  assetId: string;
  key: string;
  uploadUrl: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface StudioAssetFinalizeInput {
  uploadState: "ready" | "failed";
  sizeBytes?: number;
  checksum?: string;
  mimeType?: string;
  error?: string;
}

export interface StudioAssetDownloadResult {
  assetId: string;
  key: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface StudioAssetIngestInput {
  projectId?: string | null;
  assetType: "image" | "video" | "audio" | "model3d";
  sourceDataUrl?: string;
  sourceUrl?: string;
  fileName?: string;
  contentType?: string;
}

export interface StudioAssetIngestResult {
  assetId: string;
  key: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

function parseWorkspace(value: unknown): StudioWorkspace | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const slug = asString(row.slug);
  const role = asString(row.role);
  if (!id || !name || !slug || !role) return null;
  return { id, name, slug, role };
}

function parseAsset(value: unknown): StudioAsset | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row.id);
  const workspaceId = asString(row.workspaceId);
  if (!id || !workspaceId) return null;

  return {
    id,
    workspaceId,
    type: asString(row.type),
    storageProvider: asString(row.storageProvider),
    storageKey: asString(row.storageKey),
    mimeType: asString(row.mimeType),
    sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
    updatedAt: asString(row.updatedAt),
    createdAt: asString(row.createdAt),
  };
}

export async function listStudioWorkspaces(): Promise<StudioWorkspace[]> {
  const data = await fetchApi(
    "/api/studio/workspaces",
    undefined,
    { requireWorkspace: false },
  );
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  const parsed = workspaces
    .map(parseWorkspace)
    .filter((workspace): workspace is StudioWorkspace => Boolean(workspace));

  const activeWorkspaceId = getActiveWorkspaceId();
  if (!activeWorkspaceId && parsed[0]) {
    setActiveWorkspaceId(parsed[0].id);
  }

  return parsed;
}

export async function listStudioAssets(projectId: string): Promise<StudioAsset[]> {
  const data = await fetchApi(`/api/studio/assets?projectId=${encodeURIComponent(projectId)}`);
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const parsed = assets
    .map(parseAsset)
    .filter((asset): asset is StudioAsset => Boolean(asset));
  if (parsed[0]?.workspaceId) {
    setActiveWorkspaceId(parsed[0].workspaceId);
  }
  return parsed;
}

export async function deleteStudioAsset(assetId: string): Promise<void> {
  await fetchApi(`/api/studio/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
  });
}

export async function createStudioAssetPresign(
  input: StudioAssetPresignInput,
): Promise<StudioAssetPresignResult> {
  const data = await fetchApi("/api/studio/assets/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const assetId = asString(data.assetId);
  const key = asString(data.key);
  const uploadUrl = asString(data.uploadUrl);
  const downloadUrl = asString(data.downloadUrl);
  const expiresInSeconds = asNumber(data.expiresInSeconds);

  if (!assetId || !key || !uploadUrl || !downloadUrl || expiresInSeconds === null) {
    throw new Error("Presign payload is invalid");
  }

  return {
    assetId,
    key,
    uploadUrl,
    downloadUrl,
    expiresInSeconds,
  };
}

export async function finalizeStudioAssetUpload(
  assetId: string,
  input: StudioAssetFinalizeInput,
): Promise<StudioAsset> {
  const data = await fetchApi(`/api/studio/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const asset = parseAsset(data.asset);
  if (!asset) {
    throw new Error("Asset finalize payload is invalid");
  }

  setActiveWorkspaceId(asset.workspaceId);
  return asset;
}

export async function getStudioAssetDownloadUrl(
  assetId: string,
): Promise<StudioAssetDownloadResult> {
  const data = await fetchApi(
    `/api/studio/assets/${encodeURIComponent(assetId)}/download`,
  );

  const parsedAssetId = asString(data.assetId);
  const key = asString(data.key);
  const downloadUrl = asString(data.downloadUrl);
  const expiresInSeconds = asNumber(data.expiresInSeconds);

  if (!parsedAssetId || !key || !downloadUrl || expiresInSeconds === null) {
    throw new Error("Asset download payload is invalid");
  }

  return {
    assetId: parsedAssetId,
    key,
    downloadUrl,
    expiresInSeconds,
  };
}

export async function ingestStudioAsset(
  input: StudioAssetIngestInput,
): Promise<StudioAssetIngestResult> {
  const data = await fetchApi("/api/studio/assets/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const assetId = asString(data.assetId);
  const key = asString(data.key);
  const downloadUrl = asString(data.downloadUrl);
  const expiresInSeconds = asNumber(data.expiresInSeconds);

  if (!assetId || !key || !downloadUrl || expiresInSeconds === null) {
    throw new Error("Asset ingest payload is invalid");
  }

  return {
    assetId,
    key,
    downloadUrl,
    expiresInSeconds,
  };
}
