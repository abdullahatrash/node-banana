import { describe, expect, it } from "vitest";
import {
  AesGcmCredentialSecretCipher,
  EnvironmentCredentialVaultKeyProvider,
  type CredentialVaultKeyProvider,
} from "@/lib/credential-vault/crypto";
import { afterEach } from "vitest";

const originalActive = process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID;
const originalKeyring = process.env.CREDENTIAL_VAULT_KEYRING;

afterEach(() => {
  if (originalActive === undefined) {
    delete process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID;
  } else {
    process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID = originalActive;
  }
  if (originalKeyring === undefined) {
    delete process.env.CREDENTIAL_VAULT_KEYRING;
  } else {
    process.env.CREDENTIAL_VAULT_KEYRING = originalKeyring;
  }
});

function keyring(
  activeId = "vault-2026",
  retained = true,
): CredentialVaultKeyProvider {
  const keys = [
    { id: "vault-2025", version: 1, key: Buffer.alloc(32, 1) },
    { id: "vault-2026", version: 2, key: Buffer.alloc(32, 2) },
  ];
  return {
    activeKey: () => keys.find((key) => key.id === activeId)!,
    keyById: (id, version) =>
      (retained
        ? keys.find((key) => key.id === id && key.version === version)
        : keys.find(
            (key) =>
              key.id === activeId &&
              key.id === id &&
              key.version === version,
          )) ?? null,
  };
}

describe("credentialSecretCipher", () => {
  it("envelopes ciphertext with a non-secret key ID and version", () => {
    const cipher = new AesGcmCredentialSecretCipher(keyring());
    const secret = "replicate-private-key";
    const ciphertext = cipher.encrypt(secret);

    expect(ciphertext).toMatch(/^v2\.vault-2026\.2\./);
    expect(ciphertext).not.toContain(secret);
    expect(cipher.decrypt(ciphertext)).toBe(secret);
  });

  it("retains prior keys so rotation can decrypt historical envelopes", () => {
    const oldCipher = new AesGcmCredentialSecretCipher(keyring("vault-2025"));
    const ciphertext = oldCipher.encrypt("historical-key");
    const currentCipher = new AesGcmCredentialSecretCipher(keyring());
    expect(currentCipher.decrypt(ciphertext)).toBe("historical-key");
  });

  it("fails closed when the referenced key version is unavailable", () => {
    const oldCipher = new AesGcmCredentialSecretCipher(keyring("vault-2025"));
    const ciphertext = oldCipher.encrypt("historical-key");
    const missingRetainedKey = new AesGcmCredentialSecretCipher(
      keyring("vault-2026", false),
    );
    expect(() => missingRetainedKey.decrypt(ciphertext)).toThrow(
      "key version is unavailable",
    );
  });

  it("rejects tampered ciphertext", () => {
    const cipher = new AesGcmCredentialSecretCipher(keyring());
    const ciphertext = cipher.encrypt("private-key");
    const parts = ciphertext.split(".");
    parts[4] = `${parts[4].startsWith("A") ? "B" : "A"}${parts[4].slice(1)}`;
    const tampered = parts.join(".");
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("fails closed unless the environment keyring has one explicit active retained key", () => {
    const provider = new EnvironmentCredentialVaultKeyProvider();
    delete process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID;
    delete process.env.CREDENTIAL_VAULT_KEYRING;
    expect(() => provider.activeKey()).toThrow("are required");

    process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID = "vault-2026";
    process.env.CREDENTIAL_VAULT_KEYRING = JSON.stringify({
      "vault-2026": { version: 2, key: "ab".repeat(32) },
      "vault-2025": { version: 1, key: "cd".repeat(32) },
    });
    expect(provider.activeKey()).toMatchObject({
      id: "vault-2026",
      version: 2,
    });
    expect(provider.keyById("vault-2025", 1)).toMatchObject({
      id: "vault-2025",
      version: 1,
    });
  });
});
