import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSocialComposerStore } from "@/store/socialComposerStore";
import { ComposeView } from "../ComposeView";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), publish: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/social/client", () => ({ createSocialPost: mocks.create, updateSocialPost: mocks.update, publishSocialPost: mocks.publish }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: mocks.toast }) }));
vi.mock("@/store/socialAccountsStore", () => ({ useSocialAccountsStore: (select: (state: unknown) => unknown) => select({ accounts: [
  { id: "a", platform: "x", displayName: "Channel A" },
  { id: "b", platform: "x", displayName: "Channel B" },
] }) }));
vi.mock("../PostEditor", () => ({ PostEditor: () => null }));
vi.mock("../PreviewPanel", () => ({ PreviewPanel: () => null }));
vi.mock("../MediaPool", () => ({ MediaPool: () => null }));
vi.mock("../SchedulePicker", () => ({ SchedulePicker: () => null }));
vi.mock("../MediaAttachments", () => ({ MediaAttachments: () => null }));
vi.mock("../PublishingSettingsPanels", () => ({ PublishingSettingsPanels: () => null }));

describe("edited draft publishing intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSocialComposerStore.getState().reset();
    useSocialComposerStore.getState().loadDraft({ postId: "original", socialAccountId: "a", content: "Hello", mediaUrls: [{ type: "image", url: "https://example.com/old.png", assetId: "asset_1", resourceKind: "studio_asset", assetDigest: "sha256:" + "a".repeat(64) }] });
    useSocialComposerStore.getState().setScheduledAt(new Date(Date.now() + 86400000));
    mocks.create.mockResolvedValue({ id: "new-b" });
    mocks.update.mockResolvedValue({ id: "original" });
    mocks.publish.mockResolvedValue({});
  });

  it.each(["Save draft", "Schedule", "Publish now"])("%s acts only on the channels currently selected", async (action) => {
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><ComposeView /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Channel A" }));
    fireEvent.click(screen.getByRole("button", { name: "Channel B" }));
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ socialAccountId: "b", mediaReferences: [{ resourceKind: "studio_asset", id: "asset_1", digest: "sha256:" + "a".repeat(64) }] }));
    if (action !== "Save draft") {
      expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("new-b");
    }
  });

  it.each(["Save draft", "Schedule", "Publish now"])("%s persists removal of the last attachment", async (action) => {
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><ComposeView /></NextIntlClientProvider>);
    act(() => useSocialComposerStore.getState().removeMedia(0));
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith("original", expect.objectContaining({ mediaUrls: [], mediaReferences: [] }));
  });
});
