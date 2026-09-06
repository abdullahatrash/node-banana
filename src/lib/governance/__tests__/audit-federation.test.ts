import { describe, expect, it } from "vitest";
import { GOVERNANCE_AUDIT_FEDERATION_SOURCES } from "../audit-federation";

describe("governance audit federation", () => {
  it("declares every authoritative security, spend, publishing, telemetry, and support ledger", () => {
    expect(GOVERNANCE_AUDIT_FEDERATION_SOURCES).toEqual(expect.arrayContaining([
      "credential_spend",
      "usage_receipt",
      "spend_control",
      "quota",
      "artifact",
      "automation",
      "publishing_authority_grant",
      "publishing_authority_revocation",
      "telemetry_operator_grant",
      "diagnostic_access",
      "support_access",
      "support_bundle_lifecycle",
    ]));
    expect(new Set(GOVERNANCE_AUDIT_FEDERATION_SOURCES).size).toBe(GOVERNANCE_AUDIT_FEDERATION_SOURCES.length);
  });
});
