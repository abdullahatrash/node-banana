// Side-effecting module: load node-banana's .env files for standalone scripts
// (the CLI and MCP server). Next loads these in-app, but a tsx process does not.
// Imported FIRST in the entrypoints so env is set before the db module reads
// DATABASE_URL. No-op if a file is missing.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env", ".env.local"]) {
  const path = join(root, file);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {
      // ignore a malformed/unreadable env file — resolveAgentContext will
      // surface any missing required values with a clear message.
    }
  }
}
