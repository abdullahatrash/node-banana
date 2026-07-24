import type { WorkflowFile } from "@/store/workflowStore";
import { parseWorkflowCredentialSlots } from "@/types";
import type { CredentialHumanCapabilityIdentity } from "@/lib/credential-vault/application-capabilities";

type JsonRecord = Record<string, unknown>;

const ACTIVE_WORKSPACE_STORAGE_KEY = "node-banana-active-workspace-id";

export class StudioApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
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
  options?: { requireWorkspace?: boolean },
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
    throw new StudioApiError(
      response.status,
      getFriendlyStatusMessage(response.status, message),
    );
  }

  return record;
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

export interface StudioWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface StudioProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string | null;
  sourceDirectoryPath: string | null;
  updatedAt: string | null;
}

export interface StudioProjectDetail extends StudioProjectSummary {
  workflowJson: JsonRecord | null;
  createdAt: string | null;
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
  assetType: "image" | "video" | "audio" | "model3d" | "workflow";
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
  assetType: "image" | "video" | "audio" | "model3d" | "workflow";
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

function parseProjectSummary(value: unknown): StudioProjectSummary | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row.id);
  const workspaceId = asString(row.workspaceId);
  const name = asString(row.name);
  if (!id || !workspaceId || !name) return null;

  return {
    id,
    workspaceId,
    name,
    slug: asString(row.slug),
    description: asString(row.description),
    status: asString(row.status),
    sourceDirectoryPath: asString(row.sourceDirectoryPath),
    updatedAt: asString(row.updatedAt),
  };
}

function parseProjectDetail(value: unknown): StudioProjectDetail | null {
  const row = asRecord(value);
  if (!row) return null;
  const summary = parseProjectSummary(row);
  if (!summary) return null;

  return {
    ...summary,
    workflowJson: asRecord(row.workflowJson),
    createdAt: asString(row.createdAt),
  };
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

export async function listStudioProjects(): Promise<StudioProjectSummary[]> {
  const data = await fetchApi("/api/studio/projects");
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const parsed = projects
    .map(parseProjectSummary)
    .filter((project): project is StudioProjectSummary => Boolean(project));

  if (parsed[0]?.workspaceId) {
    setActiveWorkspaceId(parsed[0].workspaceId);
  }

  return parsed;
}

export async function getStudioProjectCount(): Promise<{
  count: number;
  max: number;
}> {
  const data = await fetchApi("/api/studio/projects");
  const count = typeof data.projectCount === "number" ? data.projectCount : 0;
  const max = typeof data.maxProjects === "number" ? data.maxProjects : Infinity;
  return { count, max };
}

export async function getStudioProject(projectId: string): Promise<StudioProjectDetail> {
  const data = await fetchApi(`/api/studio/projects/${encodeURIComponent(projectId)}`);
  const project = parseProjectDetail(data.project);
  if (!project) {
    throw new Error("Project detail payload is invalid");
  }
  setActiveWorkspaceId(project.workspaceId);
  return project;
}

export async function upsertStudioProject(input: {
  projectId?: string;
  name: string;
  description?: string | null;
  workflowJson?: Record<string, unknown> | null;
  sourceDirectoryPath?: string | null;
}): Promise<StudioProjectDetail | null> {
  const data = await fetchApi("/api/studio/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const project = parseProjectDetail(data.project);
  if (project?.workspaceId) {
    setActiveWorkspaceId(project.workspaceId);
  }
  return project;
}

export async function deleteStudioProject(projectId: string): Promise<void> {
  await fetchApi(`/api/studio/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
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

export async function getLegacyStudioAssetDownloadUrl(
  input: { projectId: string; legacyKey: string },
): Promise<{ key: string; downloadUrl: string; expiresInSeconds: number }> {
  const data = await fetchApi("/api/studio/assets/legacy-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const key = asString(data.key);
  const downloadUrl = asString(data.downloadUrl);
  const expiresInSeconds = asNumber(data.expiresInSeconds);

  if (!key || !downloadUrl || expiresInSeconds === null) {
    throw new Error("Legacy asset download payload is invalid");
  }

  return {
    key,
    downloadUrl,
    expiresInSeconds,
  };
}

export function isWorkflowFile(value: unknown): value is WorkflowFile {
  const record = asRecord(value);
  const credentialSlots = record?.credentialSlots;
  const hasValidCredentialSlots =
    credentialSlots === undefined ||
    (Array.isArray(credentialSlots) &&
      parseWorkflowCredentialSlots(credentialSlots, record?.nodes).length ===
        credentialSlots.length);
  return Boolean(
    record &&
      record.version === 1 &&
      typeof record.name === "string" &&
      Array.isArray(record.nodes) &&
      Array.isArray(record.edges) &&
      hasValidCredentialSlots,
  );
}
