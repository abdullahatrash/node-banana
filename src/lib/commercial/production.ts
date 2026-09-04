import "server-only";
import { CommercialRepository } from "./repository";
import { UnavailableMerchantOfRecordAdapter } from "./merchant";
export const COMMERCIAL = new CommercialRepository();
export const MERCHANT_OF_RECORD = new UnavailableMerchantOfRecordAdapter();
