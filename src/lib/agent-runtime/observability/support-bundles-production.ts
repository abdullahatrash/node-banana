import { DrizzleObservabilityRepository } from "./postgres-repository";
import { ObservabilityService } from "./service";
import { getObservabilityCursorCodec } from "./production";
import {
  ProductionSupportBundleProjectionReader,
  S3SupportBundleContentStore,
  SupportBundleApplication,
} from "./support-bundles";
import { DrizzleSupportBundleBindIntentRepository } from "./support-bundles-postgres";
import { getSupportBundleDbExecutor } from "./support-bundles-db-context";

let application: SupportBundleApplication | null = null;

export function getSupportBundleApplication(): SupportBundleApplication {
  const database = getSupportBundleDbExecutor;
  application ??= new SupportBundleApplication(
    new ObservabilityService(
      new DrizzleObservabilityRepository(database),
      getObservabilityCursorCodec(),
    ),
    new ProductionSupportBundleProjectionReader(),
    new S3SupportBundleContentStore(),
    new DrizzleSupportBundleBindIntentRepository(database),
  );
  return application;
}
