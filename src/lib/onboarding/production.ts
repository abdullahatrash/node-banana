import { getDb } from "@/lib/db";
import { DefaultOnboardingAnalysisWorker } from "./analysis-worker";
import { createConfiguredBrandProfileGenerator } from "./brand-profile/ai-sdk-adapter";
import { DescriptionBrandSourceReader } from "./brand-source/description-adapter";
import { WebsiteBrandSourceReader } from "./brand-source/website-adapter";
import { PostgresOnboardingRepository } from "./postgres-repository";

export function createProductionOnboardingAnalysisWorker() {
  const repository = new PostgresOnboardingRepository(getDb());
  return new DefaultOnboardingAnalysisWorker({
    repository,
    readerFor(kind) {
      return kind === "website"
        ? new WebsiteBrandSourceReader()
        : new DescriptionBrandSourceReader();
    },
    generator: () => createConfiguredBrandProfileGenerator(),
  });
}
