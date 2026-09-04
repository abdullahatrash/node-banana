import { describe, expect, it } from "vitest"
import { admitSupportCaseTransition } from "../case-policy"

describe("support case transition policy", () => {
  it("admits typed support-owner transitions with a required resolution", () => {
    expect(admitSupportCaseTransition({ actorRole: "admin", from: "investigating", to: "resolved", resolution: "  Reconnected the channel. " })).toEqual({ state: "resolved", resolution: "Reconnected the channel." })
    expect(admitSupportCaseTransition({ actorRole: "owner", from: "resolved", to: "closed", resolution: "Confirmed by customer" })).toEqual({ state: "closed", resolution: "Confirmed by customer" })
  })

  it("rejects members, skipped lifecycle states, empty resolutions, and reopening closed cases", () => {
    expect(() => admitSupportCaseTransition({ actorRole: "member", from: "open", to: "investigating", resolution: "" })).toThrowError(expect.objectContaining({ code: "SUPPORT_CASE_ADMIN_REQUIRED" }))
    expect(() => admitSupportCaseTransition({ actorRole: "admin", from: "open", to: "closed", resolution: "done" })).toThrowError(expect.objectContaining({ code: "SUPPORT_CASE_TRANSITION_INVALID" }))
    expect(() => admitSupportCaseTransition({ actorRole: "admin", from: "investigating", to: "resolved", resolution: " " })).toThrowError(expect.objectContaining({ code: "SUPPORT_CASE_RESOLUTION_REQUIRED" }))
    expect(() => admitSupportCaseTransition({ actorRole: "admin", from: "closed", to: "investigating", resolution: "" })).toThrowError(expect.objectContaining({ code: "SUPPORT_CASE_TRANSITION_INVALID" }))
  })
})
