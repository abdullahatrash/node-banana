import { getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { listProductRecords } from "@/lib/product-surfaces/repository";
import { listInspirationTrendFeed } from "@/lib/product-surfaces/trend-feed";
import { listWorkspaceOwnedPerformanceSources } from "@/lib/product-surfaces/workspace-owned-trend-adapter";
import { InspirationClient } from "./InspirationClient";

export const dynamic = "force-dynamic";

export default async function InspirationPage() {
  const { aggregate } = await requireOnboardingComplete("/inspiration");
  const t = await getTranslations("product.inspiration");
  const workspaceId = aggregate?.session.workspaceId;
  if (!workspaceId) return null;
  const [rows, trends, performanceSources] = await Promise.all([
    listProductRecords({ workspaceId, kinds: ["inspiration_item"] }),
    listInspirationTrendFeed({ workspaceId, filters: { limit: 60 } }),
    listWorkspaceOwnedPerformanceSources({ workspaceId }),
  ]);
  const manual = rows.filter((row) => !row.payload.trendEvidence).map(({ id, title, revision, state, payload }) => ({
    id, title, revision, state, payload, score: null, freshness: null,
    metricsObservedAt: String(payload.metricsObservedAt), sourcePublishedAt: null,
    eligibleForBlitz: Boolean(payload.sourceAssetId && payload.sourceMediaType && payload.rightsSnapshot && payload.rightsStatus !== "restricted" && payload.rightsStatus !== "metadata_only"),
    origin: "manual" as const,
  }));
  const items = [...trends.map((item) => ({ ...item, origin: "trend" as const })), ...manual];

  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><header className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t("title")}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></header><InspirationClient items={items} performanceSources={performanceSources} /></div></main>;
}
