import {
  getActiveWorkspaceId,
  listStudioWorkspaces,
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

  const response = await fetch("/api/studio/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify({
      projectId,
      type: params.assetType,
      storageProvider: "local",
      storageKey: filePath,
      mimeType: getMimeFromPath(filePath, params.assetType),
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
