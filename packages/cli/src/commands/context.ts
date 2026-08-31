import type { ApiClient, ApiClientOptions } from "../api/client";
import type { StoredConfig } from "../config/config";
import { UsageError } from "../errors/errors";

/** Sink for user-facing output — stdout for data, stderr for diagnostics. */
export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Everything a command needs, injected rather than imported, so commands are
 * pure and unit-testable: no real filesystem, network, or TTY in tests.
 */
export interface AppDeps {
  loadConfig: () => StoredConfig | null;
  saveConfig: (config: StoredConfig) => void;
  clearConfig: () => void;
  createClient: (options: ApiClientOptions) => ApiClient;
  /** Read a secret (the API token) from the terminal without echoing it. */
  promptSecret: (question: string) => Promise<string>;
  /** Read a local file's raw bytes, for `assets upload <file>`. */
  readFile: (path: string) => Buffer;
  /** Wait `ms` milliseconds — injected so `--wait` polling is instant in tests. */
  sleep: (ms: number) => Promise<void>;
  io: Io;
}

/**
 * Build an API client from the stored credentials, or fail with a usage error
 * (exit 2) telling the user to log in. Every read command begins here.
 */
export function resolveClient(deps: AppDeps): ApiClient {
  const config = deps.loadConfig();
  if (!config) {
    throw new UsageError(
      "Not logged in. Run `nb auth login --token <token> --url <url>` first.",
    );
  }
  return deps.createClient({ token: config.token, url: config.url });
}
