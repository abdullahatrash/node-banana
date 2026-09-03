import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@/lib/agent-tools/canonical";

export interface GovernanceImportManifestItem {
  kind: string;
  sourceId: string;
  destinationId?: string;
  digest: string;
  transferable: boolean;
  omissionReason?: string;
}

export interface GovernanceImportManifestVerificationPort {
  verify(input: {
    source: string;
    sourceManifestDigest: string;
    manifestKeyId: string;
    manifestSignature: string;
    items: GovernanceImportManifestItem[];
  }): boolean;
}

export function governanceImportManifestPayload(input: {
  source: string;
  sourceManifestDigest: string;
  items: GovernanceImportManifestItem[];
}) {
  return {
    schema: "workspace-import-manifest-authorization/v1" as const,
    source: input.source,
    sourceManifestDigest: input.sourceManifestDigest,
    items: input.items.map((item) => ({
      kind: item.kind,
      sourceId: item.sourceId,
      destinationId: item.destinationId ?? null,
      digest: item.digest,
      transferable: item.transferable,
      omissionReason: item.omissionReason ?? null,
    })),
  };
}

export const UNCONFIGURED_GOVERNANCE_IMPORT_MANIFEST_VERIFIER:
  GovernanceImportManifestVerificationPort = { verify: () => false };

export class HmacGovernanceImportManifestVerifier
  implements GovernanceImportManifestVerificationPort {
  constructor(private readonly keys: ReadonlyMap<string, Uint8Array>) {}

  verify(input: Parameters<GovernanceImportManifestVerificationPort["verify"]>[0]) {
    const key = this.keys.get(input.manifestKeyId);
    if (!key || key.byteLength < 32 || !/^[A-Za-z0-9_-]{43}$/.test(input.manifestSignature)) {
      return false;
    }
    const expected = createHmac("sha256", key)
      .update(canonicalJson(governanceImportManifestPayload(input)))
      .digest();
    const supplied = Buffer.from(input.manifestSignature, "base64url");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}
