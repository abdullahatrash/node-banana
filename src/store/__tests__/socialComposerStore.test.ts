import { beforeEach, describe, expect, it } from "vitest";
import { useSocialComposerStore } from "@/store/socialComposerStore";

describe("useSocialComposerStore", () => {
  beforeEach(() => {
    useSocialComposerStore.getState().reset();
  });

  it("hydrates safe Publishing Settings when a Channel is selected and preserves them when deselected", () => {
    const store = useSocialComposerStore.getState();

    store.toggleAccount("channel-youtube", "youtube");

    expect(useSocialComposerStore.getState().selectedAccountIds).toEqual([
      "channel-youtube",
    ]);
    expect(
      useSocialComposerStore.getState().platformSettings["channel-youtube"],
    ).toEqual({
      privacyStatus: "private",
      madeForKids: false,
      tags: [],
    });

    useSocialComposerStore
      .getState()
      .setPlatformSettings("channel-youtube", { title: "Launch video" });
    useSocialComposerStore.getState().toggleAccount("channel-youtube", "youtube");

    expect(useSocialComposerStore.getState().selectedAccountIds).toEqual([]);
    expect(
      useSocialComposerStore.getState().platformSettings["channel-youtube"],
    ).toEqual({
      title: "Launch video",
    });
  });

  it("hydrates missing Publishing Settings for display without marking the draft dirty", () => {
    useSocialComposerStore.setState({ isDirty: false });

    useSocialComposerStore
      .getState()
      .hydratePlatformSettings("channel-youtube", "youtube");

    expect(useSocialComposerStore.getState().platformSettings["channel-youtube"]).toEqual({
      privacyStatus: "private",
      madeForKids: false,
      tags: [],
    });
    expect(useSocialComposerStore.getState().isDirty).toBe(false);
  });

  it("loads saved Publishing Settings when editing a draft", () => {
    useSocialComposerStore.getState().loadDraft({
      postId: "post-1",
      socialAccountId: "channel-youtube",
      content: "Saved draft",
      platformSettings: {
        title: "Saved video title",
        privacyStatus: "unlisted",
      },
    });

    expect(useSocialComposerStore.getState().platformSettings).toEqual({
      "channel-youtube": {
        title: "Saved video title",
        privacyStatus: "unlisted",
      },
    });
    expect(useSocialComposerStore.getState().isDirty).toBe(false);
  });
});
