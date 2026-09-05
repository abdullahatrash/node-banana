import { describe, expect, it } from "vitest";
import { classifyCreditBalance, credentialNotificationPolicy } from "../projector";

describe("workspace notification projector policies", () => {
  it("maps append-only credential security evidence to customer-visible severity", () => {
    expect(credentialNotificationPolicy("profile.created", null)).toEqual({ eventType: "security.credential_created", severity: "info", change: "created" });
    expect(credentialNotificationPolicy("profile.reprovisioned", null)).toEqual({ eventType: "security.credential_created", severity: "warning", change: "reprovisioned" });
    expect(credentialNotificationPolicy("profile.status_changed", "disabled")).toEqual({ eventType: "security.credential_status_changed", severity: "critical", change: "disabled" });
    expect(credentialNotificationPolicy("spend_grant.revoked", null)).toEqual({ eventType: "security.spend_authority_changed", severity: "critical", change: "revoked" });
  });

  it("uses explicit healthy, low, and exhausted credit boundaries", () => {
    expect(classifyCreditBalance(11)).toBe("healthy");
    expect(classifyCreditBalance(10)).toBe("low");
    expect(classifyCreditBalance(1)).toBe("low");
    expect(classifyCreditBalance(0)).toBe("exhausted");
    expect(() => classifyCreditBalance(-1)).toThrow("CREDIT_NOTIFICATION_BALANCE_INVALID");
  });
});
