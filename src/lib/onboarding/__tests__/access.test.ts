import { describe, expect, it } from "vitest";
import { hasCompletedOnboarding, resolveProductDestination } from "../access";
import { InMemoryOnboardingRepository } from "../memory-repository";

const now = new Date("2026-08-31T12:00:00.000Z");

describe("onboarding access", () => {
  it("requires onboarding when a verified user has no completion record", async () => {
    const repository = new InMemoryOnboardingRepository();
    expect(
      await resolveProductDestination({
        repository,
        userId: "user_1",
        emailVerified: true,
        requestedPath: "/social/calendar",
      }),
    ).toBe("/onboarding?next=%2Fsocial%2Fcalendar");
  });

  it("allows completed legacy users to keep their requested destination", async () => {
    const repository = new InMemoryOnboardingRepository();
    const session = await repository.getOrCreateSession({
      sessionId: "onb_1",
      userId: "user_1",
      interfaceLocale: "ar",
      contentLanguage: "ar",
      now,
    });
    repository.sessions.set(session.id, {
      ...session,
      status: "completed_legacy",
      revision: 1,
      completedAt: now,
    });
    expect(await hasCompletedOnboarding(repository, "user_1")).toBe(true);
    expect(
      await resolveProductDestination({
        repository,
        userId: "user_1",
        emailVerified: true,
        requestedPath: "/studio",
      }),
    ).toBe("/studio");
  });
});

