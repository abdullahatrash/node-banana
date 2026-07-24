import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CredentialVaultKey {
  id: string;
  version: number;
  key: Buffer;
}

export interface CredentialVaultKeyProvider {
  activeKey(): CredentialVaultKey;
  keyById(id: string, version: number): CredentialVaultKey | null;
}

export interface CredentialSecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

function parseKey(id: string, version: number, hex: unknown): CredentialVaultKey {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof hex !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(hex)
  ) {
    throw new Error("Credential vault keyring contains an invalid key.");
  }
  return { id, version, key: Buffer.from(hex, "hex") };
}

/**
 * Production adapter for a retained, versioned keyring. Deployments may source
 * these two variables from an OS credential manager or KMS secret injection.
 */
export class EnvironmentCredentialVaultKeyProvider
  implements CredentialVaultKeyProvider
{
  private read(): {
    active: CredentialVaultKey;
    keys: Map<string, CredentialVaultKey>;
  } {
    const activeId = process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID?.trim();
    const raw = process.env.CREDENTIAL_VAULT_KEYRING?.trim();
    if (!activeId || !raw) {
      throw new Error(
        "CREDENTIAL_VAULT_ACTIVE_KEY_ID and CREDENTIAL_VAULT_KEYRING are required.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("CREDENTIAL_VAULT_KEYRING must be valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("CREDENTIAL_VAULT_KEYRING must be a JSON object.");
    }
    const keys = new Map<string, CredentialVaultKey>();
    for (const [id, value] of Object.entries(parsed)) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new Error("Credential vault keyring contains an invalid key.");
      }
      const record = value as Record<string, unknown>;
      const key = parseKey(id, Number(record.version), record.key);
      keys.set(`${key.id}:${key.version}`, key);
    }
    const activeCandidates = [...keys.values()].filter(
      (candidate) => candidate.id === activeId,
    );
    if (activeCandidates.length !== 1) {
      throw new Error("The active Credential vault key is unavailable.");
    }
    return { active: activeCandidates[0], keys };
  }

  activeKey(): CredentialVaultKey {
    return this.read().active;
  }

  keyById(id: string, version: number): CredentialVaultKey | null {
    return this.read().keys.get(`${id}:${version}`) ?? null;
  }
}

export class AesGcmCredentialSecretCipher implements CredentialSecretCipher {
  constructor(private readonly keys: CredentialVaultKeyProvider) {}

  encrypt(plaintext: string): string {
    const active = this.keys.activeKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", active.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v2",
      active.id,
      String(active.version),
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    const [envelope, keyId, versionValue, ivValue, tagValue, ciphertextValue] =
      value.split(".");
    const version = Number(versionValue);
    if (
      envelope !== "v2" ||
      !keyId ||
      !Number.isInteger(version) ||
      !ivValue ||
      !tagValue ||
      ciphertextValue === undefined
    ) {
      throw new Error("Invalid credential ciphertext.");
    }
    const key = this.keys.keyById(keyId, version);
    if (!key) throw new Error("Credential vault key version is unavailable.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export const credentialVaultKeyProvider =
  new EnvironmentCredentialVaultKeyProvider();
export const credentialSecretCipher = new AesGcmCredentialSecretCipher(
  credentialVaultKeyProvider,
);
