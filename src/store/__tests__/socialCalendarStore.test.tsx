import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { CalendarFilters } from "@/components/social/calendar/CalendarFilters"
import { I18nTestProvider } from "@/test/i18n"
import { useDirectionStore } from "@/store/directionStore"
import {
  formatCalendarDateRange,
  getCalendarWeekEnd,
  getCalendarWeekStart,
  useSocialCalendarStore,
} from "@/store/socialCalendarStore"

const DATE = new Date(2026, 0, 7, 12)

describe("social calendar locale semantics", () => {
  beforeEach(() => {
    localStorage.clear()
    useSocialCalendarStore.setState({
      currentDate: DATE,
      viewMode: "week",
      channelFilter: null,
      posts: [],
      isLoading: false,
    })
  })

  it("uses the Arabic Saturday-to-Friday week and Gregorian Arabic labels", () => {
    expect(getCalendarWeekStart(DATE, "ar").getDay()).toBe(6)
    expect(getCalendarWeekEnd(DATE, "ar").getDay()).toBe(5)

    const label = formatCalendarDateRange(DATE, "week", "ar")
    expect(label).toMatch(/[\u0600-\u06ff]/u)
    expect(label).toContain("٢٠٢٦")
  })

  it("uses the English Sunday-to-Saturday week and Latin Gregorian labels", () => {
    expect(getCalendarWeekStart(DATE, "en").getDay()).toBe(0)
    expect(getCalendarWeekEnd(DATE, "en").getDay()).toBe(6)

    const label = formatCalendarDateRange(DATE, "week", "en")
    expect(label).toMatch(/Jan/u)
    expect(label).toContain("2026")
  })

  it.each([
    ["ar", "rtl"],
    ["en", "ltr"],
  ] as const)("renders the %s calendar controls with %s direction", (locale, direction) => {
    useDirectionStore.setState({ locale, direction })
    const { container } = render(
      <I18nTestProvider locale={locale}>
        <CalendarFilters />
      </I18nTestProvider>,
    )

    expect(container.firstElementChild).toHaveAttribute("dir", direction)
    const dateLabel = container.querySelector(`[lang="${locale}"]`)
    expect(dateLabel).toHaveTextContent(
      useSocialCalendarStore.getState().getDateRangeLabel(locale),
      { normalizeWhitespace: false },
    )
  })
})
