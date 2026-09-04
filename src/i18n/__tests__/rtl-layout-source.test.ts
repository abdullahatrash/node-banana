import { describe, expect, it } from "vitest";

import { findPhysicalDirectionalUtilities } from "../../../scripts/rtl-layout-check.mjs";

describe("RTL layout source gate", () => {
  it("rejects physical spacing and border utilities through variants", () => {
    expect(findPhysicalDirectionalUtilities('className="pl-5 md:mr-2 border-l rounded-r-xl text-right"')).toEqual([
      "pl-5",
      "md:mr-2",
      "border-l",
      "rounded-r-xl",
      "text-right",
    ]);
  });

  it("accepts logical utilities and explicit physical-edge drawer contracts", () => {
    expect(findPhysicalDirectionalUtilities('className="ps-5 md:me-2 border-s rounded-e-xl text-start text-end"')).toEqual([]);
    expect(findPhysicalDirectionalUtilities('className="data-[vaul-drawer-direction=left]:rounded-r-xl data-[vaul-drawer-direction=right]:border-l"')).toEqual([]);
  });
});
