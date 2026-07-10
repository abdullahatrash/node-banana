/**
 * MSW (Mock Service Worker) Node harness for social-provider contract tests.
 *
 * This is deliberately OPT-IN: it is NOT wired into the global Vitest
 * `setupFiles` (see `vitest.config.ts`). The vast majority of the suite mocks
 * the network with `vi.mock` / `vi.stubGlobal("fetch", ...)`, and a globally
 * active request interceptor would fight those stubs. Contract tests that want
 * real request/response handling call `setupMswServer()` from inside their own
 * file, which scopes the interceptor to that file's lifecycle only.
 *
 * See `src/test/msw/README.md` for the per-provider contract-test pattern.
 */

import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer, type SetupServerApi } from "msw/node";
import type { RequestHandler } from "msw";

/**
 * Create a scoped MSW server for the calling test file and register its
 * Vitest lifecycle hooks.
 *
 * - `beforeAll`  → start intercepting; `onUnhandledRequest: "error"` makes any
 *                  un-mocked outbound request fail the test loudly, so a
 *                  contract test can never accidentally hit the real platform.
 * - `afterEach`  → reset to the default handlers so per-test `server.use(...)`
 *                  overrides do not leak between tests.
 * - `afterAll`   → stop intercepting and restore the network.
 *
 * @param defaultHandlers Handlers applied to every test in the file. Individual
 *   tests layer scenario-specific overrides with `server.use(...)`.
 * @returns The MSW server instance (for `server.use(...)` overrides).
 */
export function setupMswServer(
  ...defaultHandlers: RequestHandler[]
): SetupServerApi {
  const server = setupServer(...defaultHandlers);

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  return server;
}
