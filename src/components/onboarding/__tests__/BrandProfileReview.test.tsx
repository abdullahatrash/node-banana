import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrandProfileCorrection, BrandProfileV1 } from "@/lib/onboarding/schemas";
import { BrandProfileReview } from "../BrandProfileReview";

const profile: BrandProfileV1 = {
  schemaVersion: 1,
  contentLanguage: "ar",
  identity: { companyName: "تصميم", coreIdentity: "منصة محتوى", logoAssetId: null },
  offering: ["إنشاء المحتوى"],
  audiences: [{ name: "فرق التسويق", description: "فرق صغيرة", weight: 100 }],
  problems: ["بطء الإنتاج"],
  benefits: ["سرعة أكبر"],
  differentiators: ["العربية أولاً"],
  mission: "تسهيل صناعة المحتوى",
  positioning: "مساعد محتوى للمنطقة",
  ownedSpace: "محتوى عربي موثوق",
  businessModel: "b2b",
  categories: ["saas"],
  voice: { descriptors: ["واضح"], do: [], doNot: [] },
  prohibitedClaims: [],
  prohibitedTopics: [],
  competitors: [],
  contentAngles: ["ابدأ من هوية موثوقة"],
  uncertainties: [],
  evidence: [],
  sourceIds: ["source_1"],
};

describe("BrandProfileReview", () => {
  it("lets the user correct material facts before acceptance", async () => {
    const onSave = vi.fn(async (_correction: BrandProfileCorrection) => true);
    render(
      <BrandProfileReview profile={profile} locale="ar" saving={false} onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "تصحيح الملف" }));
    fireEvent.change(screen.getByLabelText("جوهر العلامة"), {
      target: { value: "منصة عربية لمحتوى موثوق" },
    });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التصحيحات" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].coreIdentity).toBe("منصة عربية لمحتوى موثوق");
  });
});
