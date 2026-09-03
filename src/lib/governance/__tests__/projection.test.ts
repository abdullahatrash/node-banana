import { describe, expect, it } from "vitest";
import {
  canViewGovernanceResource,
  deepRedactGovernanceValue,
} from "../projection";

describe("governance customer projections", () => {
  it("deeply removes bearer material and recipient identifiers", () => {
    const projected = deepRedactGovernanceValue({
      email: "person@example.com",
      nested: {
        tokenDigest: "sha256:secret",
        codeSalt: "salt",
        verificationCode: "123456",
        revisionDigest: "sha256:public-revision",
      },
      rows: [{ apiKey: "secret", status: "active" }],
    });

    expect(projected).toEqual({
      nested: { revisionDigest: "sha256:public-revision" },
      rows: [{ status: "active" }],
    });
  });

  it("hides security sessions and filters resources by exact role capability", () => {
    expect(canViewGovernanceResource("step_up_session", ["audit.view"])).toBe(false);
    expect(canViewGovernanceResource("invitation_binding", ["governance.view"])).toBe(false);
    expect(canViewGovernanceResource("invitation_binding", ["members.invite"])).toBe(true);
    expect(canViewGovernanceResource("retention_hold", ["audit.view"])).toBe(false);
    expect(canViewGovernanceResource("retention_hold", ["retention.manage"])).toBe(true);
    expect(canViewGovernanceResource("membership_projection", ["governance.view"])).toBe(false);
    expect(canViewGovernanceResource("membership_projection", ["members.manage"])).toBe(true);
  });
});
