import { getDb } from "@/lib/db";
import { ReleaseControlRepository } from "./repository";
import { ReleaseControlService } from "./service";
import { parseReleaseAttestationKeyring } from "./attestation";
import { loadReleaseManifest } from "./manifest";

const secret = process.env.TELEMETRY_PSEUDONYM_SECRET || process.env.BETTER_AUTH_SECRET;
export function getReleaseControlService(): ReleaseControlService {
  if (!secret && process.env.NODE_ENV === "production") throw new Error("TELEMETRY_PSEUDONYM_SECRET is required.");
  const keyring = parseReleaseAttestationKeyring(process.env.RELEASE_ATTESTATION_KEYS_JSON);
  return new ReleaseControlService(new ReleaseControlRepository(getDb), secret || "development-only-telemetry-secret", { keyring, automationUserId: process.env.RELEASE_AUTOMATION_USER_ID?.trim(), manifest: (workspaceId, now) => loadReleaseManifest({ raw: process.env.RELEASE_MANIFEST_JSON, signature: process.env.RELEASE_MANIFEST_SIGNATURE, secret: process.env.RELEASE_MANIFEST_SECRET, workspaceId, now }) });
}
