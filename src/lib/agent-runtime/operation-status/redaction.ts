const SAFE_KEY = /^(count|attempt|durationMs|progress|providerFamily|modelFamily|provider|model|version|inputSchemaDigest|qualificationDigest|region|regionPolicyId|regionPolicyVersion|regionEvidenceDigest|language|contentLanguage|arabicVariety|format|aspectRatio|width|height|fps|sourceAdapter|sourceUpdatedAt|intentId|predictionId|providerState|providerCode|providerOperationRef|nextAction|reasonCode|retryable|principalId|authorizationEvidenceRef|workflowId|automationId|channelId|personaId|trainingJobId|sourceId|resourceVersion|brandProfileId|brandRevision|brandContextDigest|quoteAmountUsd|quoteQuantity|quoteBasis|actualAmountUsd|releasedAmountUsd|reservationIds|rightsSnapshotId|rightsSnapshotRevision|rightsEvidenceRefs|provenanceRefs|brandReferenceAssetIds|artifactIds|artifactCount|textOutputIds|textOutputCount)$/;
const SAFE_ARRAY_KEY = /^(reservationIds|rightsEvidenceRefs|provenanceRefs|brandReferenceAssetIds|artifactIds|textOutputIds)$/;

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
