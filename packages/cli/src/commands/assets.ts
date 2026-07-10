import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

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
