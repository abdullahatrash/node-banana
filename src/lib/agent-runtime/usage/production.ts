import { getDb } from "@/lib/db";
import { DrizzleUsageRepository } from "./postgres-repository";
import { UsageLedgerService } from "./service";
import { AesGcmUsageCursorCodec, usageCursorKeysFromEnvironment } from "./cursor";

export const PRODUCTION_USAGE_REPOSITORY = new DrizzleUsageRepository(getDb);
export const PRODUCTION_USAGE_SERVICE = new UsageLedgerService(
  PRODUCTION_USAGE_REPOSITORY,
);
export const PRODUCTION_USAGE_CURSOR = new AesGcmUsageCursorCodec(
  usageCursorKeysFromEnvironment,
);
