import "server-only";
import { CommercialRepository } from "./repository";
import { ConfiguredMerchantOfRecordAdapter } from "./merchant";
import { PaddleMerchantOfRecordAdapter } from "./paddle";
import { MerchantSubscriptionLifecycleService } from "./subscription-lifecycle";
import { MerchantFinancialEvidenceService } from "./financial-evidence";
import { MerchantAdjustmentInboxService } from "./adjustment-inbox";
import { MerchantCheckoutService } from "./checkout";
import { CHANNEL_ONBOARDING } from "@/lib/channel-onboarding/production";
import { getDb } from "@/lib/db";
import { recordMarketingAttributionBestEffort } from "@/lib/marketing-attribution/record-best-effort";
import { WORKSPACE_NOTIFICATIONS } from "@/lib/product-notifications/production";
export const COMMERCIAL = new CommercialRepository();
export const MERCHANT_OF_RECORD = process.env.MERCHANT_OF_RECORD_PROVIDER?.trim().toLowerCase() === "paddle"
  ? new PaddleMerchantOfRecordAdapter()
  : new ConfiguredMerchantOfRecordAdapter();
export const MERCHANT_FINANCIALS = new MerchantFinancialEvidenceService();
export const MERCHANT_CHECKOUTS = new MerchantCheckoutService(getDb(), MERCHANT_OF_RECORD, COMMERCIAL, CHANNEL_ONBOARDING, undefined, { record: recordMarketingAttributionBestEffort }, MERCHANT_FINANCIALS);
export const MERCHANT_SUBSCRIPTIONS = new MerchantSubscriptionLifecycleService();
export const MERCHANT_ADJUSTMENT_INBOX = new MerchantAdjustmentInboxService(getDb(), MERCHANT_FINANCIALS, undefined, WORKSPACE_NOTIFICATIONS);
