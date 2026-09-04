import { describe, expect, it } from "vitest";
import { generationRightsBlockingHoldIds } from "../retention-proof";

const now = new Date("2026-09-04T12:00:00.000Z");
const hold = (id: string, expiresAt: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  status: "active",
  body: { retentionClasses: ["security_evidence"], scopeReview: { schema: "retention-hold-scope-review/v2", reviewedAgainstPolicyRevision: 2, generationRightsEvidence: "not_applicable" }, expiresAt, ...extra },
});

describe("generationRightsBlockingHoldIds", () => {
  it("matches the fail-closed SQL expiry and scope rules", () => {
    expect(generationRightsBlockingHoldIds([
      hold("expired", "2026-09-04T11:59:59.000Z"),
      hold("future-unrelated", "2026-09-05T12:00:00.000Z"),
      hold("malformed-string", "not-a-date"),
      hold("postgres-special", "epoch"),
      hold("locale-date", "09/04/2026"),
      hold("malformed-number", 42),
      hold("rights", null, { retentionClasses: ["generation_rights_evidence"] }),
      { ...hold("released", null, { retentionClasses: ["generation_rights_evidence"] }), status: "released" },
    ], 2, now)).toEqual(["locale-date", "malformed-number", "malformed-string", "postgres-special", "rights"]);
  });
});
