import { describe, expect, it } from "vitest";
import {
  isSafeLocalPath,
  resolvePostAuthDestination,
} from "../post-auth-destination";

describe("post-auth destination", () => {
  it("sends unverified users to verification and preserves a safe destination", () => {
    expect(
      resolvePostAuthDestination({
        emailVerified: false,
        onboardingStatus: null,
        requestedPath: "/social/calendar",
      }),
    ).toBe("/verify-email?next=%2Fsocial%2Fcalendar");
  });

  it("sends verified incomplete users to onboarding", () => {
    expect(
      resolvePostAuthDestination({
        emailVerified: true,
        onboardingStatus: "in_progress",
      }),
    ).toBe("/onboarding");
  });

  it("sends newly completed users to first value", () => {
    expect(
      resolvePostAuthDestination({
        emailVerified: true,
        onboardingStatus: "completed",
      }),
    ).toBe("/blitz");
  });

  it("does not disrupt completed legacy users", () => {
    expect(
      resolvePostAuthDestination({
        emailVerified: true,
        onboardingStatus: "completed_legacy",
      }),
    ).toBe("/simple-studio/images");
  });

  it("honors safe requested product paths after completion", () => {
    expect(
      resolvePostAuthDestination({
        emailVerified: true,
        onboardingStatus: "completed",
        requestedPath: "/studio/projects/one",
      }),
    ).toBe("/studio/projects/one");
  });

  it("rejects external, protocol-relative, and API redirect targets", () => {
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/api/auth/sign-out",
      "javascript:alert(1)",
    ]) {
      expect(isSafeLocalPath(unsafe)).toBe(false);
    }
  });
});

