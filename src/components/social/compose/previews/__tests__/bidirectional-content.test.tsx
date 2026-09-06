import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import messages from "@/i18n/messages/ar.json"
import { BlueskyPreview } from "../BlueskyPreview"
import { FacebookPreview } from "../FacebookPreview"
import { InstagramPreview } from "../InstagramPreview"
import { LinkedInPreview } from "../LinkedInPreview"
import { MastodonPreview } from "../MastodonPreview"
import { TikTokPreview } from "../TikTokPreview"
import { XPreview } from "../XPreview"
import { YouTubePreview } from "../YouTubePreview"

describe("social compose preview bidirectional content", () => {
  it("auto-detects post direction and isolates handles under Arabic UI", () => {
    const content = "Launch اليوم at 5 PM"
    const commonProps = {
      displayName: "Acme شركة",
      content,
      media: [],
    }

    render(
      <NextIntlClientProvider locale="ar" messages={messages}>
        <div dir="rtl">
          <BlueskyPreview {...commonProps} username="creator_123" />
          <FacebookPreview {...commonProps} />
          <InstagramPreview {...commonProps} />
          <LinkedInPreview {...commonProps} />
          <MastodonPreview {...commonProps} username="creator_123" />
          <TikTokPreview {...commonProps} username="creator_123" />
          <XPreview {...commonProps} username="creator_123" />
          <YouTubePreview {...commonProps} />
        </div>
      </NextIntlClientProvider>,
    )

    expect(screen.getAllByText(content)).toHaveLength(8)
    for (const postContent of screen.getAllByText(content)) {
      expect(postContent).toHaveAttribute("dir", "auto")
    }

    expect(screen.getAllByText("@creator_123")).toHaveLength(4)
    for (const handle of screen.getAllByText("@creator_123")) {
      expect(handle.tagName).toBe("BDI")
      expect(handle).toHaveAttribute("dir", "ltr")
    }
  })

  it("does not force an Arabic display-name fallback into LTR", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={messages}>
        <div dir="rtl">
          <TikTokPreview displayName="علامة تجارية" username="" content="محتوى" media={[]} />
        </div>
      </NextIntlClientProvider>,
    )

    expect(screen.getByText("@علامة تجارية")).toHaveAttribute("dir", "auto")
  })
})
