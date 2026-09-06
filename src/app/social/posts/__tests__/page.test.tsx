import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render as testingRender, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import arMessages from "@/i18n/messages/ar.json"
import enMessages from "@/i18n/messages/en.json"

const listSocialPosts = vi.fn()

vi.mock("@/lib/social/client", () => ({
  listSocialPosts: (...args: unknown[]) => listSocialPosts(...args),
}))

vi.mock("@/components/social/posts/PostRow", () => ({
  PostRow: ({ post }: { post: { id: string } }) => <div>{post.id}</div>,
}))

import PostsPage from "../page"

function render(locale: "ar" | "en" = "en") {
  return testingRender(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? arMessages : enMessages}
      timeZone="UTC"
    >
      <PostsPage />
    </NextIntlClientProvider>,
  )
}

describe("social posts page localization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSocialPosts.mockResolvedValue([])
  })

  it("renders the primary workflow and empty state in Arabic", async () => {
    render("ar")

    expect(await screen.findByText("لا توجد منشورات بعد. أنشئ منشورًا من صفحة التأليف.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "الكل" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "المسودات" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "المجدولة" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "المنشورة" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "المتعذرة" })).toBeInTheDocument()
  })

  it("uses the localized status in filtered empty states", async () => {
    render("en")
    await screen.findByText("No posts yet. Create one from the Compose page.")

    fireEvent.click(screen.getByRole("button", { name: "Drafts" }))

    expect(await screen.findByText("No Drafts posts.")).toBeInTheDocument()
    await waitFor(() => expect(listSocialPosts).toHaveBeenLastCalledWith({ status: "draft" }))
  })

  it("does not expose raw backend errors in the Arabic interface", async () => {
    listSocialPosts.mockRejectedValue(new Error("provider database detail"))
    render("ar")

    expect(await screen.findByText("تعذر تحميل المنشورات. حاول مجددًا.")).toBeInTheDocument()
    expect(screen.queryByText("provider database detail")).not.toBeInTheDocument()
  })
})
