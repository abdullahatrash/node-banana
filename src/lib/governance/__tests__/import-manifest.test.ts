import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/agent-tools/canonical";
import {
  governanceImportManifestPayload,
  HmacGovernanceImportManifestVerifier,
} from "../import-manifest";

describe("HmacGovernanceImportManifestVerifier", () => {
  it("authenticates the exact source, digest, item kinds, omissions, and destinations", () => {
    const key = Buffer.alloc(32, 13);
    const verifier = new HmacGovernanceImportManifestVerifier(
      new Map([["workspace-export-v1", key]]),
    );
    const unsigned = {
      source: "workspace-export:source:export_1",
      sourceManifestDigest: `sha256:${"1".repeat(64)}`,
      items: [
        {
          kind: "media",
          sourceId: "asset_1",
          destinationId: "asset_import_1",
          digest: `sha256:${"2".repeat(64)}`,
          transferable: true,
        },
        {
          kind: "credential_material",
          sourceId: "credentials",
          digest: `sha256:${"3".repeat(64)}`,
          transferable: false,
          omissionReason: "secrets are never portable",
        },
      ],
    };
    const manifestSignature = createHmac("sha256", key)
      .update(canonicalJson(governanceImportManifestPayload(unsigned)))
      .digest("base64url");
    const input = { ...unsigned, manifestKeyId: "workspace-export-v1", manifestSignature };
    expect(verifier.verify(input)).toBe(true);
    expect(verifier.verify({ ...input, source: "attacker-export" })).toBe(false);
    expect(verifier.verify({
      ...input,
      items: [{ ...unsigned.items[0]!, kind: "custom_role" }],
    })).toBe(false);
    expect(new HmacGovernanceImportManifestVerifier(new Map()).verify(input)).toBe(false);
  });
});
