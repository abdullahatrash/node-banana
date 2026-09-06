import "server-only";
import { loadXAdsAttributionConfig } from "./config";
import { MarketingAttributionRepository } from "./repository";
import { MarketingAttributionService } from "./service";
import { XAdsConversionAdapter } from "./x-ads-adapter";
import { MarketingAttributionCommercialReconciler, PostgresMarketingAttributionCommercialSourceRepository } from "./commercial-reconciliation";

export function getMarketingAttributionService(): MarketingAttributionService {
  const config = loadXAdsAttributionConfig();
  return new MarketingAttributionService(new MarketingAttributionRepository(), config, new XAdsConversionAdapter(config));
}

export function getMarketingAttributionCommercialReconciler(): MarketingAttributionCommercialReconciler {
  const config = loadXAdsAttributionConfig();
  const service = new MarketingAttributionService(new MarketingAttributionRepository(), config, new XAdsConversionAdapter(config));
  return new MarketingAttributionCommercialReconciler(new PostgresMarketingAttributionCommercialSourceRepository(), service, config);
}
