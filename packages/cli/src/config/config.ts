import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Persisted CLI credentials. Deliberately tiny: a workspace-scoped API token
 * and the API base URL it belongs to. Stored OUTSIDE any repo (see
 * {@link getConfigDir}) so a token never rides along in version control.
 */
export interface StoredConfig {
  token: string;
  url: string;
}

const CONFIG_FILE = "config.json";

/**
 * Resolve the directory holding the CLI config, honouring (in order):
 *  1. `NB_CONFIG_DIR` — explicit override, used by tests and power users.
 *  2. `XDG_CONFIG_HOME/node-banana` — the freedesktop convention.
 *  3. `~/.config/node-banana` — the portable default.
 *
 * Never a location inside the working repo, so credentials cannot be committed.
 */
export function getConfigDir(): string {
  const override = process.env.NB_CONFIG_DIR;
  if (override && override.length > 0) return override;

  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "node-banana");

  return join(homedir(), ".config", "node-banana");
}

/** Absolute path to the config JSON file. */
export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE);
}

/**
 * Load the stored config, or `null` when it is absent or unreadable. A corrupt
 * file is treated as "not logged in" rather than crashing every command — the
 * user recovers by running `nb auth login` again.
 */
export function loadConfig(): StoredConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredConfig).token === "string" &&
      typeof (parsed as StoredConfig).url === "string"
    ) {
      const { token, url } = parsed as StoredConfig;
      return { token, url };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist the config with owner-only permissions. The parent directory is
 * created 0700 and the file 0600 (and re-chmod'd, since an existing file keeps
 * its old mode through `writeFileSync`) so no other local user can read the
 * token.
 */
export function saveConfig(config: StoredConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Remove the stored config if present. A no-op when already absent. */
export function clearConfig(): void {
  const path = getConfigPath();
  rmSync(path, { force: true });
}
