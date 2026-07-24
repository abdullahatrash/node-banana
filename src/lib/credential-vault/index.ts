import { getDb } from "@/lib/db";
import { credentialSecretCipher } from "./crypto";
import { DrizzleCredentialVaultRepository } from "./repository";
import { CredentialVaultService } from "./service";

export {
  CredentialVaultError,
  CredentialVaultService,
} from "./service";
export {
  CREDENTIAL_HUMAN_IDENTITIES,
  createCredentialHumanRegistrations,
} from "./application-capabilities";

export const CREDENTIAL_VAULT_SERVICE = new CredentialVaultService(
  new DrizzleCredentialVaultRepository(getDb),
  credentialSecretCipher,
);
