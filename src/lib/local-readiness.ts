export type LocalReadinessStatus = "ready" | "blocked" | "optional";

export interface LocalReadinessCheck {
  id: string;
  label: string;
  status: LocalReadinessStatus;
  detail: string;
  action?: string;
}

export interface LocalReadinessReport {
  generatedAt: string;
  workspaceId: string | null;
  coreReady: boolean;
  byokReady: boolean;
  managedReady: boolean;
  trendIntelligenceReady: boolean;
  xAdsAttributionReady: boolean;
  checks: LocalReadinessCheck[];
}

const ready = (id: string, label: string, detail: string): LocalReadinessCheck => ({
  id,
  label,
  status: "ready",
  detail,
});

const blocked = (
  id: string,
  label: string,
  detail: string,
  action: string,
): LocalReadinessCheck => ({ id, label, status: "blocked", detail, action });

export interface LocalReadinessFacts {
  generatedAt: Date;
  workspaceId: string | null;
  workspaceExists: boolean;
  databaseConnected: boolean;
  databaseDetail: string;
  canonicalStorageConfigured: boolean;
  encryptionKeyConfigured: boolean;
  encryptionKeyValid: boolean;
  stepUpDeliveryConfigured: boolean;
  qualifiedReplicateModels: number;
  qualificationDedicatedTokenConfigured: boolean;
  qualificationHarnessConfigured: boolean;
  qualificationSpendTrustConfigured: boolean;
  qualificationSigningTrustConfigured: boolean;
  legacyReplicateKeyConfigured: boolean;
  acceptedBrand: boolean;
  verifiedReplicateRegion: boolean;
  replicateVaultKey: boolean;
  replicateVaultKeyValidated: boolean;
  managedReplicateKey: boolean;
  managedReplicateRevision: boolean;
  activePlans: number;
  activeCreditPacks: number;
  availableCredits: number;
  merchantConfigured: boolean;
  referralPayoutGatewayConfigured: boolean;
  trendWorkerAuthConfigured: boolean;
  youtubeTrendDiscoveryEnabled: boolean;
  youtubeTrendApiKeyConfigured: boolean;
  youtubeTrendDisclosuresConfigured: boolean;
  activeYoutubeTrendSources: number;
  activeLicensedTrendEntitlements: number;
  xAdsAttributionAvailable: boolean;
  xAdsAttributionBlockers: string[];
}

/** Converts secret-free infrastructure facts into actionable local readiness. */
export function buildLocalReadinessReport(
  facts: LocalReadinessFacts,
): LocalReadinessReport {
  const checks: LocalReadinessCheck[] = [
    facts.databaseConnected
      ? ready("database", "PostgreSQL", facts.databaseDetail)
      : blocked(
          "database",
          "PostgreSQL",
          facts.databaseDetail,
          "Start the local stack with `pnpm infra:up`, then apply migrations.",
        ),
    facts.canonicalStorageConfigured
      ? ready("storage", "Canonical media storage", "S3-compatible storage is configured.")
      : blocked(
          "storage",
          "Canonical media storage",
          "Image and video results cannot be admitted with local metadata-only storage.",
          "Use the documented MinIO STORAGE_BACKEND=s3 profile and restart the app.",
        ),
    facts.encryptionKeyConfigured && facts.encryptionKeyValid
      ? ready("byok_encryption", "BYOK encryption", "A valid AES-256-GCM master key is configured.")
      : blocked(
          "byok_encryption",
          "BYOK encryption",
          facts.encryptionKeyConfigured
            ? "BYOK_KEY_ENCRYPTION_KEY is present but is not 64 hexadecimal characters."
            : "No BYOK vault encryption key is configured.",
          "Generate one with `openssl rand -hex 32`, store it in .env.local, and keep it stable.",
        ),
    facts.stepUpDeliveryConfigured
      ? ready("step_up_delivery", "Step-up delivery", "Verification codes can be delivered for sensitive settings changes.")
      : {
          id: "step_up_delivery",
          label: "Step-up delivery",
          status: "optional",
          detail: "New Provider keys cannot be saved interactively until verification-code delivery is configured.",
          action: "For local testing only, set AUTH_ALLOW_CONSOLE_EMAIL_LINKS=true and read the code from the dev-server terminal.",
        },
    facts.workspaceId && facts.workspaceExists
      ? ready("workspace", "Workspace", `Inspecting ${facts.workspaceId}.`)
      : blocked(
          "workspace",
          "Workspace",
          facts.workspaceId
            ? `Configured Workspace ${facts.workspaceId} does not exist or is deleted.`
            : "No active local Workspace was found.",
          "Run `pnpm db:seed` or pass `--workspace <workspace-id>`.",
        ),
    facts.qualifiedReplicateModels > 0
      ? ready(
          "model_qualification",
          "Replicate model qualification",
          `${facts.qualifiedReplicateModels} signed, unexpired model qualification(s) loaded.`,
        )
      : blocked(
          "model_qualification",
          "Replicate model qualification",
          "The curated catalog is discovery-only; no model is executable.",
          "Complete the reviewed paid qualification procedure in docs/model-qualification-operations.md.",
        ),
    facts.qualificationDedicatedTokenConfigured &&
    facts.qualificationHarnessConfigured &&
    facts.qualificationSpendTrustConfigured &&
    facts.qualificationSigningTrustConfigured
      ? ready(
          "qualification_setup",
          "Qualification operator setup",
          "The dedicated token, observer endpoints, and independent signing trust roots are configured.",
        )
      : blocked(
          "qualification_setup",
          "Qualification operator setup",
          [
            !facts.qualificationDedicatedTokenConfigured ? "dedicated Replicate qualification token" : null,
            !facts.qualificationHarnessConfigured ? "webhook, ingestion, and spend-observer endpoints" : null,
            !facts.qualificationSpendTrustConfigured ? "spend-receipt trust root" : null,
            !facts.qualificationSigningTrustConfigured ? "model-qualification signing trust root" : null,
          ].filter(Boolean).join(", ") + " missing." +
            (facts.legacyReplicateKeyConfigured
              ? " The legacy REPLICATE_API_KEY is present but is intentionally not reused for paid qualification."
              : ""),
          "Complete the guarded qualification setup stages before reviewing a paid matrix.",
        ),
    facts.acceptedBrand
      ? ready("brand", "Brand context", "An accepted immutable Brand revision is active.")
      : blocked(
          "brand",
          "Brand context",
          "No accepted active Brand revision exists for this Workspace.",
          "Complete Brand onboarding and accept the exact revision.",
        ),
    facts.verifiedReplicateRegion
      ? ready("region", "Processing region", "An active verified Replicate processing route exists.")
      : blocked(
          "region",
          "Processing region",
          "The Workspace has no active verified region evidence for provider:replicate.",
          "Configure PROVIDER_REGION_REPLICATE and GOVERNANCE_REGION_TRUST_KEYS, then publish a signed, sourced provider:replicate processing route in Governance.",
        ),
    facts.replicateVaultKey && facts.replicateVaultKeyValidated
      ? ready("byok_provider", "Workspace Replicate key", "A validated durable Workspace key exists.")
      : blocked(
          "byok_provider",
          "Workspace Replicate key",
          facts.replicateVaultKey
            ? "The saved Workspace key has no successful validation timestamp."
            : "No Replicate key is stored in the Workspace vault.",
          "Open Settings → Provider keys and complete the exact-scope step-up flow.",
        ),
    facts.managedReplicateKey && facts.managedReplicateRevision
      ? ready("managed_provider", "Managed Replicate credential", "A revision-pinned managed credential exists.")
      : blocked(
          "managed_provider",
          "Managed Replicate credential",
          "Managed generation has no revision-pinned provider credential.",
          "Configure REPLICATE_MANAGED_API_TOKEN and REPLICATE_MANAGED_KEY_REVISION server-side.",
        ),
    facts.activePlans > 0
      ? ready("plans", "Billing catalog", `${facts.activePlans} active plan(s) and ${facts.activeCreditPacks} credit pack(s).`)
      : blocked(
          "plans",
          "Billing catalog",
          "No active versioned plan definitions are available.",
          "Run the idempotent local database seed after applying migrations.",
        ),
    facts.availableCredits > 0
      ? ready("credits", "Generation Credits", `${facts.availableCredits} credit(s) are available.`)
      : blocked(
          "credits",
          "Generation Credits",
          "This Workspace has no spendable managed-generation credits.",
          "Start an eligible trial or complete a configured credit purchase.",
        ),
    facts.merchantConfigured
      ? ready("merchant", "Merchant adapter", "A Merchant-of-Record checkout, webhook, and portal adapter is configured.")
      : {
          id: "merchant",
          label: "Merchant adapter",
          status: "optional",
          detail: "Checkout and the billing portal remain unavailable; BYOK generation is unaffected.",
          action: "Configure the Merchant-of-Record adapter when testing purchases.",
        },
    facts.referralPayoutGatewayConfigured
      ? ready("referral_payout_gateway", "Referral payout gateway", "The opaque-recipient payout dispatch and reconciliation boundary is configured.")
      : {
          id: "referral_payout_gateway",
          label: "Referral payout gateway",
          status: "optional",
          detail: "Cash referral requests remain durably submitted and their rewards remain held; no transfer can be dispatched.",
          action: "Configure the three REFERRAL_PAYOUT_GATEWAY_* variables documented in docs/operations/referral-payouts.md.",
        },
    facts.trendWorkerAuthConfigured
      ? ready("trend_workers", "Trend workers", "Local trend workers can authenticate to the internal maintenance routes.")
      : blocked(
          "trend_workers",
          "Trend workers",
          "The local content worker cannot authenticate to trend maintenance routes.",
          "Set STUDIO_INTERNAL_API_SECRET to a durable local secret and restart the app.",
        ),
    facts.youtubeTrendDiscoveryEnabled &&
    facts.youtubeTrendApiKeyConfigured &&
    facts.youtubeTrendDisclosuresConfigured &&
    facts.activeYoutubeTrendSources > 0
      ? ready(
          "youtube_trends",
          "YouTube trend discovery",
          `${facts.activeYoutubeTrendSources} active provider-ordered chart source(s) are configured.`,
        )
      : blocked(
          "youtube_trends",
          "YouTube trend discovery",
          "Missing: " + [
            !facts.youtubeTrendDiscoveryEnabled ? "the operator enable switch" : null,
            !facts.youtubeTrendApiKeyConfigured ? "a server-side YouTube Data API key" : null,
            !facts.youtubeTrendDisclosuresConfigured ? "public Terms and Privacy disclosures" : null,
            facts.activeYoutubeTrendSources === 0 ? "an active Workspace chart source" : null,
          ].filter(Boolean).join(", ") + ".",
          "Follow docs/operations/youtube-trend-discovery.md, then add a MENA chart from Inspiration.",
        ),
    facts.activeLicensedTrendEntitlements > 0
      ? ready(
          "licensed_trends",
          "Licensed remix catalog",
          `${facts.activeLicensedTrendEntitlements} active licensed trend entitlement(s) can be imported for Remix and Blitz.`,
        )
      : blocked(
          "licensed_trends",
          "Licensed remix catalog",
          "No active licensed trend entitlement is available to this Workspace.",
          "Publish a verified licensed catalog entry and grant the Workspace an active entitlement.",
        ),
    facts.xAdsAttributionAvailable
      ? ready("x_ads_attribution", "X Ads attribution", "The server Conversion API adapter, event IDs, public notice, and operator reviews are configured.")
      : {
          id: "x_ads_attribution",
          label: "X Ads attribution",
          status: "optional",
          detail: `Advertising attribution is unavailable and fails closed: ${facts.xAdsAttributionBlockers.join(", ") || "configuration incomplete"}.`,
          action: "Follow docs/operations/x-ads-attribution.md. Do not reuse customer social-publishing credentials.",
        },
  ];

  const status = (id: string) => checks.find((check) => check.id === id)?.status === "ready";
  const common = status("database") && status("storage") && status("workspace") &&
    status("model_qualification") && status("brand") && status("region");

  return {
    generatedAt: facts.generatedAt.toISOString(),
    workspaceId: facts.workspaceId,
    coreReady: status("database") && status("storage") && status("workspace"),
    byokReady: common && status("byok_encryption") && status("byok_provider"),
    managedReady: common && status("managed_provider") && status("plans") && status("credits"),
    trendIntelligenceReady: status("trend_workers") && status("youtube_trends") && status("licensed_trends"),
    xAdsAttributionReady: status("x_ads_attribution"),
    checks,
  };
}
