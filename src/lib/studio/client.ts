import { WorkflowFile } from "@/store/workflowStore";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readApiError(data: unknown): string {
  const record = asRecord(data);
  const error = record?.error;
  return typeof error === "string" && error.trim()
    ? error
    : "Unexpected API response";
}

async function fetchApi(input: RequestInfo, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(input, init);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const record = asRecord(data);
  if (!record) {
    throw new Error(`Invalid API response for ${typeof input === "string" ? input : "request"}`);
  }

  const success = record.success;
  if (typeof success !== "boolean") {
    throw new Error(readApiError(record));
  }

  if (!response.ok || !success) {
    throw new Error(readApiError(record));
  }

  return record;
}

export interface StudioProjectSummary {
  id: string;
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
  type: string | null;
  storageProvider: string | null;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  createdAt: string | null;
}

function parseProjectSummary(value: unknown): StudioProjectSummary | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row?.id);
  const name = asString(row?.name);
  if (!id || !name) return null;

  return {
    id,
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
    workflowJson: asRecord(row?.workflowJson),
    createdAt: asString(row?.createdAt),
  };
}

function parseAsset(value: unknown): StudioAsset | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row?.id);
  if (!id) return null;

  return {
    id,
    type: asString(row?.type),
    storageProvider: asString(row?.storageProvider),
    storageKey: asString(row?.storageKey),
    mimeType: asString(row?.mimeType),
    sizeBytes: typeof row?.sizeBytes === "number" ? row.sizeBytes : null,
    updatedAt: asString(row?.updatedAt),
    createdAt: asString(row?.createdAt),
  };
}

export async function listStudioProjects(): Promise<StudioProjectSummary[]> {
  const data = await fetchApi("/api/studio/projects");
  const projects = Array.isArray(data.projects) ? data.projects : [];
  return projects
    .map(parseProjectSummary)
    .filter((project): project is StudioProjectSummary => Boolean(project));
}

export async function getStudioProject(projectId: string): Promise<StudioProjectDetail> {
  const data = await fetchApi(`/api/studio/projects/${encodeURIComponent(projectId)}`);
  const project = parseProjectDetail(data.project);
  if (!project) {
    throw new Error("Project detail payload is invalid");
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
  return assets
    .map(parseAsset)
    .filter((asset): asset is StudioAsset => Boolean(asset));
}

export async function deleteStudioAsset(assetId: string): Promise<void> {
  await fetchApi(`/api/studio/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
  });
}

export function isWorkflowFile(value: unknown): value is WorkflowFile {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.version === 1 &&
      typeof record.name === "string" &&
      Array.isArray(record.nodes) &&
      Array.isArray(record.edges),
  );
}
