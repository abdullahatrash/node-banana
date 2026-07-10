import { basename } from "node:path";

import type { AssetType } from "../api/schemas";
import { UsageError } from "../errors/errors";
import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

/**
 * Infer the asset type and content type from a file extension, mirroring the
 * server's own mime<->extension mapping (see `getExtensionForMimeType` in
 * `/api/studio/assets/ingest`). `--type`/`--mime-type` always win over this.
 */
const EXTENSION_INFO: Record<string, { assetType: AssetType; mimeType: string }> = {
  png: { assetType: "image", mimeType: "image/png" },
  jpg: { assetType: "image", mimeType: "image/jpeg" },
  jpeg: { assetType: "image", mimeType: "image/jpeg" },
  gif: { assetType: "image", mimeType: "image/gif" },
  webp: { assetType: "image", mimeType: "image/webp" },
  svg: { assetType: "image", mimeType: "image/svg+xml" },
  mp4: { assetType: "video", mimeType: "video/mp4" },
  webm: { assetType: "video", mimeType: "video/webm" },
  mov: { assetType: "video", mimeType: "video/quicktime" },
  mp3: { assetType: "audio", mimeType: "audio/mpeg" },
  wav: { assetType: "audio", mimeType: "audio/wav" },
  ogg: { assetType: "audio", mimeType: "audio/ogg" },
  flac: { assetType: "audio", mimeType: "audio/flac" },
  aac: { assetType: "audio", mimeType: "audio/aac" },
  glb: { assetType: "model3d", mimeType: "model/gltf-binary" },
  gltf: { assetType: "model3d", mimeType: "model/gltf+json" },
  obj: { assetType: "model3d", mimeType: "model/obj" },
  usdz: { assetType: "model3d", mimeType: "model/vnd.usdz+zip" },
  fbx: { assetType: "model3d", mimeType: "model/fbx" },
  stl: { assetType: "model3d", mimeType: "model/stl" },
};

function inferFromFileName(fileName: string): { assetType: AssetType; mimeType: string } | null {
  const parts = fileName.split(".");
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1]?.toLowerCase();
  return ext ? EXTENSION_INFO[ext] ?? null : null;
}

/**
 * `nb assets list` — media assets in the token's workspace, optionally filtered
 * by `--type` and capped by `--limit` (both forwarded to and validated by the
 * API). Ids are referenced when composing posts.
 */
export async function assetsList(
  deps: AppDeps,
  opts: { json: boolean; type?: string; limit?: number },
): Promise<void> {
  const client = resolveClient(deps);

  const listOptions: { type?: string; limit?: number } = {};
  if (opts.type !== undefined) listOptions.type = opts.type;
  if (opts.limit !== undefined) listOptions.limit = opts.limit;

  const assets = await client.listAssets(listOptions);

  if (opts.json) {
    deps.io.out(formatJson(assets));
    return;
  }

  if (assets.length === 0) {
    deps.io.out("No assets found for this workspace.");
    return;
  }

  const rows = assets.map((a) => [
    a.id,
    a.type,
    a.mimeType ?? "-",
    a.sizeBytes === null ? "-" : String(a.sizeBytes),
    a.createdAt,
  ]);
  deps.io.out(renderTable(["ID", "TYPE", "MIME", "SIZE", "CREATED"], rows));
}

/**
 * `nb assets upload <file>` — reads a local file, base64-encodes it, and
 * uploads it via the `upload_asset` registry tool (through the public API).
 * Asset type and content type are inferred from the file extension unless
 * `--type`/`--mime-type` override them; workspace storage quota and type
 * rules are enforced server-side, identically to the app.
 */
export async function assetsUpload(
  deps: AppDeps,
  opts: {
    json: boolean;
    file: string;
    type?: string;
    projectId?: string;
    mimeType?: string;
  },
): Promise<void> {
  const client = resolveClient(deps);

  const fileName = basename(opts.file);
  const inferred = inferFromFileName(fileName);

  const assetType = (opts.type as AssetType | undefined) ?? inferred?.assetType;
  if (!assetType) {
    throw new UsageError(
      `Could not infer an asset type from "${fileName}". Pass --type <image|video|audio|model3d|workflow>.`,
    );
  }

  const mimeType = opts.mimeType ?? inferred?.mimeType;
  const bytes = deps.readFile(opts.file);

  const result = await client.uploadAsset({
    assetType,
    fileName,
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    base64Content: bytes.toString("base64"),
  });

  if (opts.json) {
    deps.io.out(formatJson(result));
    return;
  }

  deps.io.out(`Uploaded asset ${result.assetId}`);
  deps.io.out(`Download URL: ${result.downloadUrl}`);
}

/**
 * `nb assets download-url <assetId>` — a CDN or presigned URL for an asset
 * already in the workspace, optionally with a custom `--expires-in` lifetime
 * (only meaningful when the deployment has no CDN configured).
 */
export async function assetsDownloadUrl(
  deps: AppDeps,
  opts: { json: boolean; assetId: string; expiresInSeconds?: number },
): Promise<void> {
  const client = resolveClient(deps);

  const result = await client.getAssetDownloadUrl(
    opts.assetId,
    opts.expiresInSeconds !== undefined
      ? { expiresInSeconds: opts.expiresInSeconds }
      : undefined,
  );

  if (opts.json) {
    deps.io.out(formatJson(result));
    return;
  }

  deps.io.out(result.downloadUrl);
}
