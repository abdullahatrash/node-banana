const SAFE_KEY = /^(count|attempt|durationMs|progress|providerFamily|modelFamily|provider|model|version|inputSchemaDigest|region|language|contentLanguage|arabicVariety|format|aspectRatio|sourceAdapter|sourceUpdatedAt|intentId|predictionId|providerState|providerCode|nextAction|brandRevision|quoteAmountUsd|quoteQuantity|quoteBasis|reservationIds|rightsEvidenceRefs|provenanceRefs|artifactCount)$/;
const SAFE_ARRAY_KEY = /^(reservationIds|rightsEvidenceRefs|provenanceRefs)$/;

export function redactOperationMetadata(value: Record<string, unknown>): Record<string, string | number | boolean | null | string[]> {
  const safe: Array<[string, string | number | boolean | null | string[]]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_KEY.test(key)) continue;
    if (SAFE_ARRAY_KEY.test(key) && Array.isArray(item) && item.length <= 100 && item.every((entry) => typeof entry === "string")) { safe.push([key, item.map((entry) => entry.slice(0, 200))]); continue; }
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe.push([key, typeof item === "string" ? item.slice(0, 200) : item]);
    }
  }
  return Object.fromEntries(safe);
}
