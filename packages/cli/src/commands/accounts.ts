import type { SocialAccount } from "../api/schemas";
import { formatJson, renderTable } from "../output/output";
import { resolveClient, type AppDeps } from "./context";

/** Connection status for the human table, collapsing the boolean flags. */
function statusOf(account: SocialAccount): string {
  if (account.disabled) return "disabled";
  if (account.requiresReauth) return "needs-reauth";
  return "connected";
}

/**
 * `nb accounts list` — the connected social accounts (channels) for the
 * token's workspace. Ids are used to target posts.
 */
export async function accountsList(
  deps: AppDeps,
  opts: { json: boolean },
): Promise<void> {
  const client = resolveClient(deps);
  const accounts = await client.listSocialAccounts();

  if (opts.json) {
    deps.io.out(formatJson(accounts));
    return;
  }

  if (accounts.length === 0) {
    deps.io.out("No social accounts connected to this workspace.");
    return;
  }

  const rows = accounts.map((a) => [
    a.id,
    a.platform,
    a.username ?? "-",
    a.displayName,
    statusOf(a),
  ]);
  deps.io.out(
    renderTable(["ID", "PLATFORM", "USERNAME", "DISPLAY NAME", "STATUS"], rows),
  );
}
