import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const TEST_KEY = randomBytes(32).toString("hex");

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

function setupChainableMock() {
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockValues });

  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  mockWhere.mockReturnValue({
    orderBy: mockOrderBy,
    limit: mockLimit,
    returning: mockReturning,
  });
  mockOrderBy.mockReturnValue(Promise.resolve([]));
  mockLimit.mockReturnValue(Promise.resolve([]));

  mockDelete.mockReturnValue({ where: mockWhere });
}

// Partial mock: keep the real `schema`/`isDatabaseConfigured` exports (so the
// unrelated Better Auth import chain pulled in transitively by ../crypto
// keeps working) and only replace `getDb` with our chainable query mocks.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: mockInsert,
      select: mockSelect,
      delete: mockDelete,
    }),
  };
});

describe("byok/repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChainableMock();
    vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", TEST_KEY);
    vi.stubEnv("DEV_AUTH_BYPASS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadRepository() {
    return import("../repository");
  }

  describe("upsertProviderKey", () => {
    it("encrypts the raw key and stores only a masked hint in the summary", async () => {
      const { upsertProviderKey } = await loadRepository();
      const now = new Date("2026-07-10T00:00:00.000Z");
      mockReturning.mockResolvedValue([
        {
          provider: "openai",
          keyHint: "sk-…test",
          lastValidatedAt: now,
          updatedAt: now,
        },
      ]);

      const summary = await upsertProviderKey({
        workspaceId: "ws_1",
        provider: "openai",
        rawKey: "sk-abcdefghijklmnoptest",
        createdByUserId: "user_1",
      });

      expect(summary).toEqual({
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: now,
        updatedAt: now,
      });

      // The raw key must never be handed to the DB layer verbatim.
      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.keyEncrypted).not.toContain(
        "sk-abcdefghijklmnoptest",
      );
      expect(insertedValues.workspaceId).toBe("ws_1");
      expect(insertedValues.provider).toBe("openai");
    });

    it("upserts on the (workspaceId, provider) unique constraint", async () => {
      const { upsertProviderKey } = await loadRepository();
      mockReturning.mockResolvedValue([
        {
          provider: "openai",
          keyHint: "sk-…test",
          lastValidatedAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await upsertProviderKey({
        workspaceId: "ws_1",
        provider: "openai",
        rawKey: "sk-newkeyvalue1234",
        createdByUserId: "user_1",
      });

      const { workspaceProviderKeys } = await import("@/lib/db/schema");
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: [
            workspaceProviderKeys.workspaceId,
            workspaceProviderKeys.provider,
          ],
        }),
      );
    });
  });

  describe("listProviderKeys", () => {
    it("never includes keyEncrypted in the returned rows", async () => {
      const { listProviderKeys } = await loadRepository();
      const now = new Date("2026-07-10T00:00:00.000Z");
      mockOrderBy.mockResolvedValue([
        { provider: "openai", keyHint: "sk-…test", lastValidatedAt: now, updatedAt: now },
      ]);

      const keys = await listProviderKeys("ws_1");

      expect(keys).toEqual([
        { provider: "openai", hint: "sk-…test", lastValidatedAt: now, updatedAt: now },
      ]);
      expect(JSON.stringify(keys)).not.toContain("keyEncrypted");
    });
  });

  describe("deleteProviderKey", () => {
    it("returns true when a row was deleted", async () => {
      const { deleteProviderKey } = await loadRepository();
      mockReturning.mockResolvedValue([{ id: "provkey_1" }]);

      const deleted = await deleteProviderKey({
        workspaceId: "ws_1",
        provider: "openai",
      });

      expect(deleted).toBe(true);
    });

    it("returns false when no matching row exists", async () => {
      const { deleteProviderKey } = await loadRepository();
      mockReturning.mockResolvedValue([]);

      const deleted = await deleteProviderKey({
        workspaceId: "ws_1",
        provider: "anthropic",
      });

      expect(deleted).toBe(false);
    });
  });

  describe("resolveProviderKey", () => {
    it("returns the decrypted raw key when a row exists", async () => {
      const { resolveProviderKey } = await loadRepository();
      const { encryptProviderKey } = await import("../crypto");
      const encrypted = encryptProviderKey("sk-realsecretvalue");

      mockLimit.mockResolvedValue([{ keyEncrypted: encrypted }]);

      const resolved = await resolveProviderKey("ws_1", "openai");

      expect(resolved).toBe("sk-realsecretvalue");
    });

    it("returns null (not an error) when the workspace has no stored key", async () => {
      const { resolveProviderKey } = await loadRepository();
      mockLimit.mockResolvedValue([]);

      const resolved = await resolveProviderKey("ws_1", "kie");

      expect(resolved).toBeNull();
    });
  });

  describe("durable async credential resolution", () => {
    it("pins a managed Replicate key to an operator revision without exposing it to Workspace storage", async () => {
      const { resolveManagedProviderKey, resolveProviderKeyByRef } = await loadRepository();
      vi.stubEnv("REPLICATE_MANAGED_API_TOKEN", "r8_managed_secret");
      vi.stubEnv("REPLICATE_MANAGED_KEY_REVISION", "vault-revision-7");
      const credential = resolveManagedProviderKey("replicate");
      expect(credential).toEqual({ key: "r8_managed_secret", ref: { id: "managed:replicate", provider: "replicate", source: "managed", revision: "vault-revision-7" } });
      await expect(resolveProviderKeyByRef("unrelated-workspace", credential!.ref)).resolves.toBe("r8_managed_secret");
    });

    it("fails closed after a managed key revision rotates", async () => {
      const { resolveProviderKeyByRef } = await loadRepository();
      vi.stubEnv("REPLICATE_MANAGED_API_TOKEN", "r8_managed_secret");
      vi.stubEnv("REPLICATE_MANAGED_KEY_REVISION", "vault-revision-8");
      await expect(resolveProviderKeyByRef("ws_1", { id: "managed:replicate", provider: "replicate", source: "managed", revision: "vault-revision-7" })).resolves.toBeNull();
    });

    it("does not resolve an example-file placeholder as a managed credential", async () => {
      const { resolveManagedProviderKey } = await loadRepository();
      vi.stubEnv("REPLICATE_MANAGED_API_TOKEN", "your_replicate_api_key_here");
      vi.stubEnv("REPLICATE_MANAGED_KEY_REVISION", "vault-revision-8");
      expect(resolveManagedProviderKey("replicate")).toBeNull();
    });

    it("returns the exact stored key revision as a non-secret reference", async () => {
      const { resolveDurableProviderKey } = await loadRepository();
      const { encryptProviderKey } = await import("../crypto");
      const updatedAt = new Date("2026-09-04T00:00:00.000Z");
      mockLimit.mockResolvedValue([{ id: "provkey_1", keyEncrypted: encryptProviderKey("r8_test_secret"), updatedAt }]);
      await expect(resolveDurableProviderKey("ws_1", "replicate")).resolves.toEqual({ key: "r8_test_secret", ref: { id: "provkey_1", provider: "replicate", updatedAt: updatedAt.toISOString() } });
    });

    it("fails closed when the exact stored revision no longer exists", async () => {
      const { resolveProviderKeyByRef } = await loadRepository();
      mockLimit.mockResolvedValue([]);
      await expect(resolveProviderKeyByRef("ws_1", { id: "provkey_1", provider: "replicate", updatedAt: "2026-09-04T00:00:00.000Z" })).resolves.toBeNull();
    });
  });
});
