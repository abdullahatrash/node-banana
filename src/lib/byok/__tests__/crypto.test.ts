import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Generate a valid 32-byte hex key for tests
const TEST_KEY = randomBytes(32).toString("hex");

describe("byok/crypto", () => {
  beforeEach(() => {
    vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", TEST_KEY);
    vi.stubEnv("DEV_AUTH_BYPASS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadCrypto() {
    return import("../crypto");
  }

  describe("encryptProviderKey / decryptProviderKey", () => {
    it("round-trips a provider key correctly", async () => {
      const { encryptProviderKey, decryptProviderKey } = await loadCrypto();
      const rawKey = "sk-test-1234567890abcdef";
      const encrypted = encryptProviderKey(rawKey);
      expect(encrypted).not.toBe(rawKey);
      expect(encrypted).not.toContain(rawKey);
      expect(decryptProviderKey(encrypted)).toBe(rawKey);
    });

    it("produces different ciphertexts for the same plaintext", async () => {
      const { encryptProviderKey } = await loadCrypto();
      const rawKey = "same-key";
      const a = encryptProviderKey(rawKey);
      const b = encryptProviderKey(rawKey);
      expect(a).not.toBe(b);
    });

    it("handles unicode content", async () => {
      const { encryptProviderKey, decryptProviderKey } = await loadCrypto();
      const rawKey = "key-with-émoji-🔑-and-日本語";
      expect(decryptProviderKey(encryptProviderKey(rawKey))).toBe(rawKey);
    });
  });

  describe("tamper detection", () => {
    it("throws on tampered ciphertext", async () => {
      const { encryptProviderKey, decryptProviderKey } = await loadCrypto();
      const encrypted = encryptProviderKey("real-key");
      const parts = encrypted.split(":");
      const tamperedCiphertext = Buffer.from("tampered-data").toString(
        "base64",
      );
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;
      expect(() => decryptProviderKey(tampered)).toThrow();
    });

    it("throws on invalid format", async () => {
      const { decryptProviderKey } = await loadCrypto();
      expect(() => decryptProviderKey("not-valid-format")).toThrow(
        "Invalid encrypted provider key format",
      );
    });
  });

  describe("missing encryption key", () => {
    it("throws when encrypting without key and not in dev bypass", async () => {
      vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", "");
      vi.stubEnv("DEV_AUTH_BYPASS", "");
      const { encryptProviderKey } = await loadCrypto();
      expect(() => encryptProviderKey("key")).toThrow(
        "BYOK_KEY_ENCRYPTION_KEY is required",
      );
    });

    it("stores plaintext in dev bypass mode without key", async () => {
      vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", "");
      vi.stubEnv("DEV_AUTH_BYPASS", "true");
      const { encryptProviderKey, decryptProviderKey } = await loadCrypto();
      const encrypted = encryptProviderKey("dev-key");
      expect(encrypted).toBe("plain:dev-key");
      expect(decryptProviderKey(encrypted)).toBe("dev-key");
    });
  });

  describe("invalid key format", () => {
    it("throws on short key", async () => {
      vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", "aabbcc");
      const { encryptProviderKey } = await loadCrypto();
      expect(() => encryptProviderKey("key")).toThrow(
        "64-character hex string",
      );
    });
  });

  describe("isProviderKeyEncryptionConfigured", () => {
    it("returns true when key is set", async () => {
      const { isProviderKeyEncryptionConfigured } = await loadCrypto();
      expect(isProviderKeyEncryptionConfigured()).toBe(true);
    });

    it("returns false when key is not set", async () => {
      vi.stubEnv("BYOK_KEY_ENCRYPTION_KEY", "");
      const { isProviderKeyEncryptionConfigured } = await loadCrypto();
      expect(isProviderKeyEncryptionConfigured()).toBe(false);
    });
  });
});
