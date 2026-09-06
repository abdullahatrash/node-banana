import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import messagesAr from "@/i18n/messages/ar.json";
import messagesEn from "@/i18n/messages/en.json";
import type { LicensedTrendCatalogCard } from "@/lib/product-surfaces/licensed-trend-types";
import { LicensedTrendCatalog } from "../LicensedTrendCatalog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => <img {...props} />,
}));

const digest = `sha256:${"a".repeat(64)}` as const;

function item(mediaType: "image" | "video"): LicensedTrendCatalogCard {
  return {
    catalogId: `catalog-${mediaType}`,
    revision: 1,
    entitlementId: `entitlement-${mediaType}`,
    state: "available",
    importJobId: null,
    inspirationItemId: null,
    previewUrl: `/api/product-inspiration/licensed-catalog/catalog-${mediaType}/1/preview`,
    document: {
      schema: "licensed-trend-catalog-entry/v1",
      id: `catalog-${mediaType}`,
      revision: 1,
      provider: {
        key: "licensed.test",
        itemId: `source-${mediaType}`,
        sourceUrl: "https://licensed.example/source",
        attribution: "Licensed Test Studio",
      },
      title: mediaType === "image" ? "Licensed launch image" : "فيديو إطلاق مرخّص",
      sourceName: "Licensed Test Studio",
      publishedAt: "2026-09-01T10:00:00.000Z",
      metrics: {
        views: 1200,
        likes: 100,
        comments: 10,
        observedAt: "2026-09-02T10:00:00.000Z",
      },
      media: {
        type: mediaType,
        mimeType: mediaType === "image" ? "image/png" : "video/mp4",
        sizeBytes: 1024,
        width: 1080,
        height: 1920,
        durationSeconds: mediaType === "video" ? 8 : null,
        storageKey: `licensed/${mediaType}`,
        versionId: "version-1",
        etag: "etag-1",
        digest,
      },
      evidenceDocument: {
        mimeType: "application/pdf",
        sizeBytes: 512,
        storageKey: "licensed/evidence",
        versionId: "version-1",
        etag: "etag-2",
        digest,
      },
      rights: {
        basis: "licensed",
        permittedRemix: "transform",
        issuer: { type: "license_authority", id: "licensed-test" },
        scope: {
          commercialUse: true,
          derivativeUse: false,
          modelInputUse: true,
          territories: ["worldwide"],
        },
        issuedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: null,
      },
      classification: {
        region: "GCC",
        contentLanguage: mediaType === "video" ? "ar" : "en",
        arabicVariety: mediaType === "video" ? "gulf" : null,
        format: "video_hook_demo",
        tags: ["launch"],
        creativePrimitives: {
          topics: ["launch"],
          hookPattern: "Open with the outcome",
          pacing: "Fast",
          structure: ["hook", "proof", "action"],
        },
      },
      digest,
    },
  };
}

function renderCatalog(mediaType: "image" | "video", locale: "ar" | "en" = "en") {
  const catalogItem = item(mediaType);
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? messagesAr : messagesEn} timeZone="UTC">
      <div dir={locale === "ar" ? "rtl" : "ltr"}>
        <LicensedTrendCatalog items={[catalogItem]} />
      </div>
    </NextIntlClientProvider>,
  );
  return catalogItem;
}

describe("LicensedTrendCatalog source-media admission", () => {
  it("keeps image import disabled until the source loads and fails closed after an error", async () => {
    const catalogItem = renderCatalog("image");
    const checking = screen.getByRole("button", { name: "Verifying source media" });
    expect(checking).toBeDisabled();

    const image = screen.getByRole("img", { name: catalogItem.document.title });
    await act(async () => fireEvent.load(image));
    expect(screen.getByRole("button", { name: "Import to Workspace" })).toBeEnabled();

    await act(async () => fireEvent.error(image));
    expect(screen.getByRole("alert")).toHaveTextContent("The licensed source media is unavailable");
    expect(screen.getByRole("button", { name: "Source unavailable" })).toBeDisabled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check again" })));
    expect(screen.getByRole("button", { name: "Verifying source media" })).toBeDisabled();
    await act(async () => fireEvent.load(screen.getByRole("img", { name: catalogItem.document.title })));
    expect(screen.getByRole("button", { name: "Import to Workspace" })).toBeEnabled();
  });

  it("authors the unavailable video state in Arabic and keeps import disabled", () => {
    const catalogItem = renderCatalog("video", "ar");
    const video = screen.getByLabelText(catalogItem.document.title);

    fireEvent.error(video);

    expect(screen.getByRole("alert")).toHaveTextContent("وسائط المصدر المرخّصة غير متاحة");
    expect(screen.getByRole("button", { name: "المصدر غير متاح" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "التحقق مجددًا" })).toBeEnabled();
  });
});
