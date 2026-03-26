import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Generate a valid 32-byte hex key for tests
const TEST_KEY = randomBytes(32).toString("hex");

describe("social/crypto", () => {
  beforeEach(() => {
    vi.stubEnv("SOCIAL_TOKEN_ENCRYPTION_KEY", TEST_KEY);
    vi.stubEnv("DEV_AUTH_BYPASS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadCrypto() {
    return import("@/lib/social/crypto");
  }

  describe("encryptToken / decryptToken", () => {
    it("round-trips a token correctly", async () => {
      const { encryptToken, decryptToken } = await loadCrypto();
      const token = "sk-test-1234567890abcdef";
      const encrypted = encryptToken(token);
      expect(encrypted).not.toBe(token);
      expect(encrypted).not.toContain(token);
      expect(decryptToken(encrypted)).toBe(token);
    });

    it("produces different ciphertexts for the same plaintext", async () => {
      const { encryptToken } = await loadCrypto();
      const token = "same-token";
      const a = encryptToken(token);
      const b = encryptToken(token);
      expect(a).not.toBe(b);
    });

    it("handles empty string", async () => {
      const { encryptToken, decryptToken } = await loadCrypto();
      const encrypted = encryptToken("");
      expect(decryptToken(encrypted)).toBe("");
    });

    it("handles unicode content", async () => {
      const { encryptToken, decryptToken } = await loadCrypto();
      const token = "token-with-émoji-🔑-and-日本語";
      expect(decryptToken(encryptToken(token))).toBe(token);
    });
  });

  describe("tamper detection", () => {
    it("throws on tampered ciphertext", async () => {
      const { encryptToken, decryptToken } = await loadCrypto();
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");
      // Tamper with the ciphertext portion
      const tamperedCiphertext = Buffer.from("tampered-data").toString(
        "base64",
      );
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws on tampered auth tag", async () => {
      const { encryptToken, decryptToken } = await loadCrypto();
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");
      const fakeTag = randomBytes(16).toString("base64");
      const tampered = `${parts[0]}:${fakeTag}:${parts[2]}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws on invalid format", async () => {
      const { decryptToken } = await loadCrypto();
      expect(() => decryptToken("not-valid-format")).toThrow(
        "Invalid encrypted token format",
      );
    });
  });

  describe("missing encryption key", () => {
    it("throws when encrypting without key and not in dev bypass", async () => {
      vi.stubEnv("SOCIAL_TOKEN_ENCRYPTION_KEY", "");
      vi.stubEnv("DEV_AUTH_BYPASS", "");
      const { encryptToken } = await loadCrypto();
      expect(() => encryptToken("token")).toThrow(
        "SOCIAL_TOKEN_ENCRYPTION_KEY is required",
      );
    });

    it("stores plaintext in dev bypass mode without key", async () => {
      vi.stubEnv("SOCIAL_TOKEN_ENCRYPTION_KEY", "");
      vi.stubEnv("DEV_AUTH_BYPASS", "true");
      const { encryptToken, decryptToken } = await loadCrypto();
      const encrypted = encryptToken("dev-token");
      expect(encrypted).toBe("plain:dev-token");
      expect(decryptToken(encrypted)).toBe("dev-token");
    });
  });

  describe("invalid key format", () => {
    it("throws on short key", async () => {
      vi.stubEnv("SOCIAL_TOKEN_ENCRYPTION_KEY", "aabbcc");
      const { encryptToken } = await loadCrypto();
      expect(() => encryptToken("token")).toThrow("64-character hex string");
    });
  });

  describe("isTokenEncryptionConfigured", () => {
    it("returns true when key is set", async () => {
      const { isTokenEncryptionConfigured } = await loadCrypto();
      expect(isTokenEncryptionConfigured()).toBe(true);
    });

    it("returns false when key is not set", async () => {
      vi.stubEnv("SOCIAL_TOKEN_ENCRYPTION_KEY", "");
      const { isTokenEncryptionConfigured } = await loadCrypto();
      expect(isTokenEncryptionConfigured()).toBe(false);
    });
  });
});
