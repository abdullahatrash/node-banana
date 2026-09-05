import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/ar.json"
import type { SocialPost } from "@/lib/social/client"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }))

import { PostRow } from "../PostRow"

describe("PostRow bidirectional content", () => {
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
})
