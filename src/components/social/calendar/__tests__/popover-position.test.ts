import { describe, expect, it } from "vitest"
import { getCalendarPopoverLeft } from "../CalendarPostDetailsPopover"

describe("calendar popover logical placement", () => {
  it("opens after an anchor in LTR and before it in RTL", () => {
    expect(getCalendarPopoverLeft({
      anchorLeft: 600,
      anchorRight: 680,
      viewportWidth: 1_200,
      direction: "ltr",
    })).toBe(688)
    expect(getCalendarPopoverLeft({
      anchorLeft: 600,
      anchorRight: 680,
      viewportWidth: 1_200,
      direction: "rtl",
    })).toBe(272)
  })

  it("keeps the panel inside a narrow viewport", () => {
    expect(getCalendarPopoverLeft({
      anchorLeft: 20,
      anchorRight: 80,
      viewportWidth: 360,
      direction: "rtl",
    })).toBe(32)
  })
})
