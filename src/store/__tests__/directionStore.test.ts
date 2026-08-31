import { beforeEach, describe, expect, it } from "vitest";
import { useDirectionStore } from "@/store/directionStore";

describe("useDirectionStore", () => {
  beforeEach(() => {
    useDirectionStore.setState({ locale: "ar", direction: "rtl" });
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  });

  it("starts from the Arabic-first product default", () => {
    expect(useDirectionStore.getState()).toMatchObject({
      locale: "ar",
      direction: "rtl",
    });
  });

  it("switches the document to English when explicitly selected", () => {
    useDirectionStore.getState().setLocale("en");

    expect(useDirectionStore.getState()).toMatchObject({
      locale: "en",
      direction: "ltr",
    });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
