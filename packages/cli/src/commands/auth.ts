import { DEFAULT_API_URL } from "../constants";
import { UsageError } from "../errors/errors";
import { formatJson } from "../output/output";
import type { AppDeps } from "./context";

/** Mask a token for display so `nb auth status` never prints it in full. */
function maskToken(token: string): string {
  if (token.length <= 6) return "***";
  return `${token.slice(0, 3)}…${token.slice(-2)}`;
}

/**
 * `nb auth login` — resolve a token (from `--token` or a hidden prompt) and a
 * URL (from `--url`, the existing config, or the default), verify it against
 * the API, and only then persist it. A rejected token is never written, so a
 * stored credential always works.
 */
export async function authLogin(
  deps: AppDeps,
  opts: { token?: string; url?: string; json: boolean },
): Promise<void> {
  const url = opts.url ?? deps.loadConfig()?.url ?? DEFAULT_API_URL;
  const rawToken = opts.token ?? (await deps.promptSecret("API token: "));
  const token = rawToken.trim();

  if (token.length === 0) {
    throw new UsageError("No token provided. Pass --token or enter one when prompted.");
  }

  // Verify before persisting; verifyToken throws ApiError on rejection.
  const client = deps.createClient({ token, url });
  await client.verifyToken();

  deps.saveConfig({ token, url });

  if (opts.json) {
    deps.io.out(formatJson({ authenticated: true, url }));
  } else {
    deps.io.out(`Logged in to ${url}.`);
  }
}

/**
 * `nb auth status` — report whether a token is stored and for which URL, with
 * the token masked. Offline by design (no network), so it is fast and usable
 * even when the API is unreachable.
 */
export async function authStatus(
  deps: AppDeps,
  opts: { json: boolean },
): Promise<void> {
  const config = deps.loadConfig();

  if (!config) {
    if (opts.json) {
      deps.io.out(formatJson({ authenticated: false, url: null }));
    } else {
      deps.io.out("Not logged in. Run `nb auth login` to authenticate.");
    }
    return;
  }

  const masked = maskToken(config.token);
  if (opts.json) {
    deps.io.out(
      formatJson({ authenticated: true, url: config.url, token: masked }),
    );
  } else {
    deps.io.out(`Logged in to ${config.url} (token ${masked}).`);
  }
}
