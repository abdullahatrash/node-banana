import { describe, expect, it } from "vitest";
import * as vault from "../index";

describe("credential vault public surface", () => {
  it("does not export secret-bearing infrastructure", () => {
    expect(vault).not.toHaveProperty("credentialSecretCipher");
    expect(vault).not.toHaveProperty("CredentialEffectExecutor");
    expect(vault).not.toHaveProperty("InMemoryCredentialVaultRepository");
    expect(vault).not.toHaveProperty("DrizzleCredentialVaultRepository");
  });
});
