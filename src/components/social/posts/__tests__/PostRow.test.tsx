import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/ar.json"
import type { SocialPost } from "@/lib/social/client"
import { StudioApiError } from "@/lib/studio/client"

const { mockRetrySocialPost, mockShowToast } = vi.hoisted(() => ({
  mockRetrySocialPost: vi.fn(),
  mockShowToast: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: mockShowToast }) }))
vi.mock("@/lib/social/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/client")>("@/lib/social/client")
  return { ...actual, retrySocialPost: mockRetrySocialPost }
})

import { PostRow } from "../PostRow"

describe("PostRow bidirectional content", () => {
  it("renders a persisted unavailable-channel code using authored Arabic copy", () => {
    const post: SocialPost = {
      id: "post_missing_channel", workspaceId: "workspace_1", socialAccountId: "foreign",
      status: "failed", content: "محتوى", mediaUrls: null, stableMediaRefs: [],
      platformSettings: null, scheduledAt: null, publishedAt: null, platformPostId: null,
      platformPostUrl: null, errorMessage: "channel_not_found", retryCount: 0,
      createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z",
    }
    render(
      <NextIntlClientProvider locale="ar" messages={messages} timeZone="UTC">
        <PostRow post={post} onMutate={vi.fn()} />
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: messages.social.posts.showError }))
    expect(screen.getByText(messages.social.calendarUi.destinationUnavailable)).toBeInTheDocument()
    expect(screen.queryByText("channel_not_found")).not.toBeInTheDocument()
  })

  it("auto-detects English post content direction under Arabic UI", () => {
    const content = "Launch the campaign at 5 PM"
    const post: SocialPost = {
      id: "post_1",
      workspaceId: "workspace_1",
      socialAccountId: "account_1",
      status: "draft",
      content,
      mediaUrls: null,
      stableMediaRefs: [],
      platformSettings: null,
      scheduledAt: null,
      publishedAt: null,
      platformPostId: null,
      platformPostUrl: null,
      errorMessage: null,
      retryCount: 0,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    }

    render(
      <NextIntlClientProvider locale="ar" messages={messages} timeZone="UTC">
        <div dir="rtl">
          <PostRow post={post} onMutate={vi.fn()} />
        </div>
      </NextIntlClientProvider>,
    )

    expect(screen.getByText(content)).toHaveAttribute("dir", "auto")
  })

  it("shows authored Arabic copy and an isolated reference for provider failures", async () => {
    mockRetrySocialPost.mockRejectedValueOnce(
      new StudioApiError(503, "raw provider failure in English"),
    )
    const post: SocialPost = {
      id: "post_failed",
      workspaceId: "workspace_1",
      socialAccountId: "account_1",
      status: "failed",
      content: "محتوى",
      mediaUrls: null,
      stableMediaRefs: [],
      platformSettings: null,
      scheduledAt: null,
      publishedAt: null,
      platformPostId: null,
      platformPostUrl: null,
      errorMessage: null,
      retryCount: 1,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    }

    render(
      <NextIntlClientProvider locale="ar" messages={messages} timeZone="UTC">
        <PostRow post={post} onMutate={vi.fn()} />
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "إعادة محاولة المنشور" }))

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
      "مزوّد الخدمة غير متاح مؤقتًا. لم نفقد عملك.",
      "error",
      false,
      "HTTP:503",
    ))
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.stringContaining("raw provider failure"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })
})
