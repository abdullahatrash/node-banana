import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { PricingSnapshot } from "../usage/types";
import type {
  WorkflowStepAdmissionExposure,
  WorkflowStepAdmissionExposureIdentity,
} from "../runs/types";

export const ADMISSION_EXPOSURE_CATALOG_VERSION =
  "node-banana-admission-exposure-2026-08-01";

const EFFECTIVE_FROM = new Date("2026-08-01T00:00:00.000Z");
const CATALOG_REFERENCE =
  `catalog:${ADMISSION_EXPOSURE_CATALOG_VERSION}`;
const GEMINI_PRICING_REFERENCE =
  "https://ai.google.dev/gemini-api/docs/pricing";

interface ExactCatalogEntry extends WorkflowStepAdmissionExposureIdentity {
  perAttemptCeiling: string;
  currency: string;
  sourceReference: string;
}

const EXACT_ENTRIES: readonly ExactCatalogEntry[] = Object.freeze([
  Object.freeze({
    provider: "runtime",
    providerOperation: "digest_text",
    model: "sha256",
    serviceTier: "local",
    perAttemptCeiling: "0",
    currency: "USD",
    sourceReference: "runtime-contract:runtime.digest_text@1",
  }),
  Object.freeze({
    provider: "conformance",
    providerOperation: "generate_text",
    model: "golden-v1",
    serviceTier: "test",
    perAttemptCeiling: "0",
    currency: "USD",
    sourceReference: "fixture-contract:golden-conformance-v1",
  }),
  Object.freeze({
    provider: "conformance",
    providerOperation: "generate_image",
    model: "golden-v1",
    serviceTier: "test",
    perAttemptCeiling: "0",
    currency: "USD",
    sourceReference: "fixture-contract:golden-conformance-v1",
  }),
]);

function sameIdentity(
  left: WorkflowStepAdmissionExposureIdentity,
  right: WorkflowStepAdmissionExposureIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    left.providerOperation === right.providerOperation &&
    left.model === right.model &&
    left.serviceTier === right.serviceTier
  );
}

function snapshotFor(entry: ExactCatalogEntry): PricingSnapshot {
  const identity = {
    schema: "admission-exposure-pricing/v1",
    catalogVersion: ADMISSION_EXPOSURE_CATALOG_VERSION,
    provider: entry.provider,
    providerOperation: entry.providerOperation,
    model: entry.model,
    serviceTier: entry.serviceTier,
    perAttemptCeiling: entry.perAttemptCeiling,
    currency: entry.currency,
    sourceReference: entry.sourceReference,
  };
  return {
    schema: "pricing-snapshot/v1",
    id: `price_${canonicalDigest(identity).slice(7, 39)}`,
    workspaceId: null,
    source: "builtin_catalog",
    provider: entry.provider,
    providerOperation: entry.providerOperation,
    model: entry.model,
    dimension: "runtime.provider_operation@1",
    unit: "count",
    price: entry.perAttemptCeiling,
    currency: entry.currency,
    perQuantity: "1",
    version: ADMISSION_EXPOSURE_CATALOG_VERSION,
    sourceUrl: entry.sourceReference,
    effectiveFrom: new Date(EFFECTIVE_FROM),
    effectiveTo: null,
    recordedAt: new Date(EFFECTIVE_FROM),
  };
}

const SNAPSHOTS = EXACT_ENTRIES.map(snapshotFor);

function cloneSnapshot(snapshot: PricingSnapshot): PricingSnapshot {
  return {
    ...snapshot,
    effectiveFrom: new Date(snapshot.effectiveFrom),
    effectiveTo: snapshot.effectiveTo
      ? new Date(snapshot.effectiveTo)
      : null,
    recordedAt: new Date(snapshot.recordedAt),
  };
}

export function admissionExposureFor(
  identity: WorkflowStepAdmissionExposureIdentity,
): WorkflowStepAdmissionExposure {
  const entry = EXACT_ENTRIES.find((candidate) =>
    sameIdentity(candidate, identity),
  );
  if (entry) {
    const snapshot = snapshotFor(entry);
    return {
      schema: "workflow-step-admission-exposure/v1",
      ...identity,
      certainty: "exact",
      perAttemptCeiling: entry.perAttemptCeiling,
      currency: entry.currency,
      pricingSnapshotIds: [snapshot.id],
      catalogVersion: ADMISSION_EXPOSURE_CATALOG_VERSION,
      sourceReferences: [CATALOG_REFERENCE, entry.sourceReference],
    };
  }

  const isUnboundedGemini =
    identity.provider === "gemini" &&
    identity.providerOperation ===
      "generativelanguage.v1beta.models.generateContent";
  return {
    schema: "workflow-step-admission-exposure/v1",
    ...identity,
    certainty: "unknown",
    reason: isUnboundedGemini
      ? "provider_contract_has_unbounded_billable_usage"
      : "pricing_catalog_entry_unavailable",
    perAttemptCeiling: null,
    currency: null,
    pricingSnapshotIds: [],
    catalogVersion: ADMISSION_EXPOSURE_CATALOG_VERSION,
    sourceReferences: [
      CATALOG_REFERENCE,
      ...(isUnboundedGemini ? [GEMINI_PRICING_REFERENCE] : []),
    ],
  };
}

export function admissionPricingSnapshots(
  ids: readonly string[],
): PricingSnapshot[] {
  const requested = new Set(ids);
  return SNAPSHOTS.filter((snapshot) => requested.has(snapshot.id)).map(
    cloneSnapshot,
  );
}
