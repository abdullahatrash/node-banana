import "server-only";
import { CommercialRepository } from "./repository";
import { ConfiguredMerchantOfRecordAdapter } from "./merchant";
import { MerchantCheckoutService } from "./checkout";
import { CHANNEL_ONBOARDING } from "@/lib/channel-onboarding/production";
import { getDb } from "@/lib/db";
export const COMMERCIAL = new CommercialRepository();
export const MERCHANT_OF_RECORD = new ConfiguredMerchantOfRecordAdapter();
export const MERCHANT_CHECKOUTS = new MerchantCheckoutService(getDb(), MERCHANT_OF_RECORD, COMMERCIAL, CHANNEL_ONBOARDING);
