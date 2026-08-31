import { getDb } from "@/lib/db";
import { DrizzleObservabilityRepository } from "./postgres-repository";
import { ObservabilityService } from "./service";
import type { DiagnosticTrace, ObservabilityCursorCodec, OperationalMetricsSink } from "./types";
import { AesGcmObservabilityCursorCodec, observabilityCursorKeysFromEnvironment } from "./cursor";

let repository: DrizzleObservabilityRepository | null = null;
function productionRepository(): DrizzleObservabilityRepository {
  repository ??= new DrizzleObservabilityRepository(() => getDb());
  return repository;
}
let cursorCodec: ObservabilityCursorCodec = new AesGcmObservabilityCursorCodec(observabilityCursorKeysFromEnvironment);
export function configureObservabilityCursorCodec(codec: ObservabilityCursorCodec): void { cursorCodec = codec; }
export function getObservabilityCursorCodec(): ObservabilityCursorCodec { return cursorCodec; }
export function getObservabilityService(): ObservabilityService {
  return new ObservabilityService(productionRepository(), cursorCodec);
}
export function getObservabilityRepository(): DrizzleObservabilityRepository { return productionRepository(); }

/** Best-effort production port: telemetry can never replace the caller's canonical error. */
export async function recordOperationalTrace(
  trace: Omit<DiagnosticTrace, "schema" | "operatorTraceRef" | "expiresAt">,
): Promise<string | null> {
  try { return await getObservabilityService().recordTrace(trace); }
  catch { return null; }
}

export const operationalMetricsSink: OperationalMetricsSink = {
  async emit(input) { try { await getObservabilityService().recordMetricDelta(input); } catch {} },
};
