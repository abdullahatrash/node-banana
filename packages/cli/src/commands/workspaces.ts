import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

/**
 * `nb workspaces list` — the agent's first call, confirming which brand the
 * token is scoped to. `--json` emits the exact API array; otherwise a table.
 */
export async function workspacesList(
  deps: AppDeps,
  opts: { json: boolean },
): Promise<void> {
  const client = resolveClient(deps);
  const workspaces = await client.listWorkspaces();

  if (opts.json) {
    deps.io.out(formatJson(workspaces));
    return;
  }

  if (workspaces.length === 0) {
    deps.io.out("No workspaces found for this token.");
    return;
  }

  const rows = workspaces.map((w) => [w.id, w.name, w.slug]);
  deps.io.out(renderTable(["ID", "NAME", "SLUG"], rows));
}
