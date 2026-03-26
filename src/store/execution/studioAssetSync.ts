import {
  createStudioAssetPresign,
  finalizeStudioAssetUpload,
  getActiveWorkspaceId,
  listStudioWorkspaces,
  StudioApiError,
} from "@/lib/studio/client";

type StudioAssetType = "image" | "video" | "audio" | "model3d";

const EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "model/obj",
  usdz: "model/vnd.usdz+zip",
  fbx: "model/fbx",
  stl: "model/stl",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

function getMimeFromPath(filePath: string, assetType: StudioAssetType): string {
  const parts = filePath.split(".");
  const extension = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  if (extension && EXTENSION_TO_MIME[extension]) {
    return EXTENSION_TO_MIME[extension];
  }

  if (assetType === "image") return "image/png";
  if (assetType === "video") return "video/mp4";
  if (assetType === "audio") return "audio/mpeg";
  return "model/gltf-binary";
}

interface SaveGenerationResult {
  success?: boolean;
  filePath?: string;
}

interface WorkflowStoreLike {
  workflowId?: string | null;
}

function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || `asset-${Date.now()}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Upload failed";
}

function isS3ConfigFallbackError(error: unknown): boolean {
  if (!(error instanceof StudioApiError)) return false;
  if (error.status !== 400) return false;
  return error.message.includes("S3 storage is not configured");
}

async function recordLocalStudioAsset(params: {
  workspaceId: string;
  projectId: string | null;
  assetType: StudioAssetType;
  filePath: string;
  mimeType: string;
  prompt?: string | null;
}): Promise<void> {
  const response = await fetch("/api/studio/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": params.workspaceId,
    },
    body: JSON.stringify({
      projectId: params.projectId,
      type: params.assetType,
      storageProvider: "local",
      storageKey: params.filePath,
      mimeType: params.mimeType,
      metadata: {
        source: "save-generation",
        prompt: params.prompt || null,
      },
    }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const errorMessage =
    typeof record?.error === "string" && record.error.trim()
      ? record.error
      : `Studio asset sync failed (${response.status})`;

  if (!response.ok || record?.success !== true) {
    throw new Error(errorMessage);
  }
}

async function readSavedFileBlob(filePath: string, mimeType: string): Promise<Blob> {
  const response = await fetch("/api/load-file", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filePath }),
  });

  if (!response.ok) {
    let message = `Failed to load file content (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parse failure and keep fallback status-based message.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  if (blob.type === mimeType) {
    return blob;
  }

  const bytes = await blob.arrayBuffer();
  return new Blob([bytes], { type: mimeType });
}

export async function syncStudioAssetFromSaveResult(params: {
  saveResult: SaveGenerationResult;
  assetType: StudioAssetType;
  prompt?: string | null;
  getStoreState: () => unknown;
}): Promise<void> {
  if (!params.saveResult?.success) return;
  const filePath = params.saveResult.filePath;
  if (!filePath || typeof filePath !== "string") return;

  if (!getActiveWorkspaceId()) {
    await listStudioWorkspaces();
  }
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) return;

  const state = params.getStoreState() as WorkflowStoreLike;
  const projectId =
    typeof state.workflowId === "string" && state.workflowId.trim()
      ? state.workflowId
      : null;
  const mimeType = getMimeFromPath(filePath, params.assetType);
  const fileName = getFileNameFromPath(filePath);
  let presignedAssetId: string | null = null;

  try {
    const blob = await readSavedFileBlob(filePath, mimeType);

    const presign = await createStudioAssetPresign({
      projectId,
      assetType: params.assetType,
      fileName,
      contentType: mimeType,
      expectedSizeBytes: blob.size,
    });
    presignedAssetId = presign.assetId;

    const uploadResponse = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }

    await finalizeStudioAssetUpload(presign.assetId, {
      uploadState: "ready",
      sizeBytes: blob.size,
      mimeType,
    });
    return;
  } catch (error) {
    if (isS3ConfigFallbackError(error)) {
      await recordLocalStudioAsset({
        workspaceId,
        projectId,
        assetType: params.assetType,
        filePath,
        mimeType,
        prompt: params.prompt,
      });
      return;
    }

    if (
      error instanceof Error &&
      error.message.includes("Select a workspace to continue.")
    ) {
      throw error;
    }

    if (error instanceof StudioApiError && error.status === 403) {
      throw error;
    }

    const uploadError = getErrorMessage(error);
    if (presignedAssetId) {
      try {
        await finalizeStudioAssetUpload(presignedAssetId, {
          uploadState: "failed",
          mimeType,
          error: uploadError,
        });
      } catch (finalizeError) {
        console.warn("Failed to finalize studio asset upload as failed:", finalizeError);
      }
    }

    throw new Error(`Studio asset upload failed: ${uploadError}`);
  }
}
