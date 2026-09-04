import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";
import type { CalendarItem } from "@/lib/product-surfaces/calendar-projection";
import { useSocialCalendarStore } from "@/store/socialCalendarStore";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/store/socialAccountsStore", () => ({
  useSocialAccountsStore: (selector: (state: { accounts: never[] }) => unknown) => selector({ accounts: [] }),
}));

import { CalendarListView } from "../CalendarListView";

function item(id: string, authority: CalendarItem["authority"]): CalendarItem {
  return {
    id,
    workspaceId: "workspace_1",
    socialAccountId: "channel_1",
    status: "draft",
    content: id,
    mediaUrls: null,
    stableMediaRefs: [],
    platformSettings: null,
    scheduledAt: "2026-09-08T14:00:00.000Z",
    publishedAt: null,
    platformPostId: null,
    platformPostUrl: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    authority,
  };
}

describe("CalendarListView authority", () => {
  beforeEach(() => {
    useSocialCalendarStore.setState({
      posts: [
        item("canonical item", {
          kind: "canonical",
          binding: {
            schema: "canonical-calendar-binding/v1",
            planId: "plan_1",
            revisionId: "revision_2",
            revision: 2,
            revisionDigest: `sha256:${"a".repeat(64)}`,
            targetId: "target_1",
          },
          approvalStatus: "pending",
          deliveryState: null,
        }),
        item("legacy item", { kind: "legacy_compatibility" }),
      ],
    });
  });

  it("labels canonical and compatibility rows and withholds legacy mutation actions from canonical rows", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CalendarListView />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Canonical Publishing Plan")).toBeInTheDocument();
    expect(screen.getByText("Compatibility post (legacy)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });
});
