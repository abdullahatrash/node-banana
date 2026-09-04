import { beforeEach, describe, expect, it, vi } from "vitest";
import { endOfDay, startOfDay } from "date-fns";

const listCalendarItems = vi.fn();
vi.mock("@/lib/social/client", () => ({
  listCalendarItems: (...args: unknown[]) => listCalendarItems(...args),
}));

import { useSocialCalendarStore } from "@/store/socialCalendarStore";

describe("social calendar canonical store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSocialCalendarStore.setState({
      currentDate: new Date("2026-09-08T12:00:00.000Z"),
      viewMode: "day",
      channelFilter: "channel_1",
      posts: [],
      isLoading: false,
      timezone: "UTC",
      weekStartsOn: 1,
    });
  });

  it("loads the canonical projection rather than legacy social posts", async () => {
    const item = {
      id: "canonical:plan_1:target_1",
      scheduledAt: "2026-09-08T14:00:00.000Z",
      authority: { kind: "canonical", binding: { revisionId: "revision_2", revision: 2 } },
    };
    listCalendarItems.mockResolvedValue([item]);

    await useSocialCalendarStore.getState().fetchPosts();

    expect(listCalendarItems).toHaveBeenCalledWith({
      startDate: startOfDay(new Date("2026-09-08T12:00:00.000Z")).toISOString(),
      endDate: endOfDay(new Date("2026-09-08T12:00:00.000Z")).toISOString(),
      socialAccountId: "channel_1",
    });
    expect(useSocialCalendarStore.getState().posts).toEqual([item]);
  });

  it("replaces an optimistic schedule with the newer canonical binding returned by refetch", async () => {
    useSocialCalendarStore.setState({
      posts: [{
        id: "canonical:plan_1:target_1",
        scheduledAt: "2026-09-08T14:00:00.000Z",
        authority: { kind: "canonical", binding: { revisionId: "revision_1", revision: 1 } },
      }] as never,
    });
    const projected = {
      id: "canonical:plan_1:target_1",
      scheduledAt: "2026-09-09T15:00:00.000Z",
      authority: { kind: "canonical", binding: { revisionId: "revision_2", revision: 2 } },
    };
    listCalendarItems.mockResolvedValue([projected]);

    useSocialCalendarStore.getState().applyOptimisticReschedule(
      "canonical:plan_1:target_1",
      "2026-09-09T15:00:00.000Z",
    );
    await useSocialCalendarStore.getState().fetchPosts();

    expect(useSocialCalendarStore.getState().posts).toEqual([projected]);
  });

  it("lets the post-reschedule refetch supersede an older in-flight read", async () => {
    let releaseOlder!: (value: unknown[]) => void;
    listCalendarItems
      .mockReturnValueOnce(new Promise((resolve) => { releaseOlder = resolve; }))
      .mockResolvedValueOnce([{ id: "canonical:plan_1:target_1", scheduledAt: "2026-09-10T15:00:00.000Z" }]);

    const older = useSocialCalendarStore.getState().fetchPosts();
    const authoritative = useSocialCalendarStore.getState().fetchPosts();
    await authoritative;
    releaseOlder([{ id: "canonical:plan_1:target_1", scheduledAt: "2026-09-08T14:00:00.000Z" }]);
    await older;

    expect(listCalendarItems).toHaveBeenCalledTimes(2);
    expect(useSocialCalendarStore.getState().posts[0]?.scheduledAt).toBe("2026-09-10T15:00:00.000Z");
  });
});
