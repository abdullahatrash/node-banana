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

import { CalendarDay } from "../CalendarDay";
import { CalendarListView } from "../CalendarListView";
import { CalendarMonth } from "../CalendarMonth";
import { CalendarWeek } from "../CalendarWeek";

const canonical: CalendarItem = {
  id: "canonical:plan_1:target_1",
  workspaceId: "workspace_1",
  socialAccountId: "channel_1",
  status: "draft",
  content: "Projected canonical item",
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
  authority: {
    kind: "canonical",
    binding: {
      schema: "canonical-calendar-binding/v1",
      planId: "plan_1",
      revisionId: "revision_2",
      revision: 2,
      revisionDigest: `sha256:${"a".repeat(64)}`,
      targetId: "target_1",
    },
    approvalStatus: null,
    deliveryState: null,
  },
};

describe("calendar views share the canonical projection", () => {
  beforeEach(() => {
    useSocialCalendarStore.setState({
      currentDate: new Date("2026-09-08T12:00:00.000Z"),
      posts: [canonical],
      weekStartsOn: 1,
    });
  });

  it.each([
    ["day", CalendarDay],
    ["week", CalendarWeek],
    ["month", CalendarMonth],
    ["list", CalendarListView],
  ] as const)("renders the projected item in the %s view", (_name, View) => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <View />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Projected canonical item/)).toBeInTheDocument();
  });
});
