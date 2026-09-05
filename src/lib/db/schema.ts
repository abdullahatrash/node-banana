import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ResolvedWorkflowDefinition } from "@/lib/agent-runtime/workflows/types";
import type { ArtifactProviderMetadata } from "@/lib/agent-runtime/artifacts/types";
import type {
  WorkflowRunArtifactReference,
  WorkflowRunDerivation,
  WorkflowRunFinalSnapshot,
  WorkflowRunStartSnapshot,
  WorkflowStepAttemptInput,
  WorkflowStepAttemptRecord,
} from "@/lib/agent-runtime/runs/types";
import type { WorkflowRunAcceptedSpendQuote } from "@/lib/agent-runtime/runs/spend-quote";
import type {
  CostValuation,
  FxSnapshot,
  PricingSnapshot,
  UsageArtifactAttribution,
  UsageMeteringEvent,
  UsageRecord,
} from "@/lib/agent-runtime/usage/types";
import type {
  BudgetAdmissionPlan,
  BudgetAttemptAllocationInput,
  BudgetPolicy,
  BudgetPolicyRevision,
  BudgetReservation,
  RunStepExposure,
  WorkspacePricingOverride,
} from "@/lib/agent-runtime/budgets/types";
import type {
  QuotaClaimCommitResult,
  QuotaPolicy,
  QuotaPolicyRevision,
  QuotaReservation,
  QuotaTransitionCommitResult,
  QuotaUsageReconciliationCommitResult,
  QuotaWait,
} from "@/lib/agent-runtime/quotas/types";
import type {
  DiagnosticTrace,
  DiagnosticTraceAccessAuditEvent,
  ObservabilityRetentionPolicy,
  ObservabilityRetentionRevision,
  OperationalMetricAggregate,
  SupportBundleAuditEvent,
  SupportBundleAccessAuditEvent,
  SupportBundleRecord,
  WorkspaceTelemetryOperatorGrant,
  OperatorGrantAuditEvent,
} from "@/lib/agent-runtime/observability/types";
import type { SupportBundleBindIntent } from "@/lib/agent-runtime/observability/support-bundles";
import type { ContractEvidenceVersionRecord } from "@/lib/agent-runtime/contract-evidence/types";
import type {
  NormalizedPublishingPlanDefinition,
  PublishingPlanSuccessfulValidationEvidence,
} from "@/lib/agent-runtime/publishing-plans/types";
import type { PublishingApprovalGovernanceBinding } from "@/lib/agent-runtime/publishing-approvals/types";
import type {
  PublishingDeliveryAcceptedRef,
  PublishingDeliveryEvent,
  PublishingDeliveryTargetSnapshot,
} from "@/lib/agent-runtime/publishing-deliveries/types";
import type {
  AutomationEventRecord,
  AutomationOccurrenceCancellationRecord,
  AutomationOccurrenceRecord,
  AutomationOutboxIntentRecord,
  AutomationRecord,
  AutomationRevisionActivationRecord,
  AutomationRevisionRecord,
  AutomationStageAttemptRecord,
} from "@/lib/agent-runtime/automations/types";
import type {
  ActivationArtifactV1,
  BrandProfileV1,
  OnboardingAnswersV1,
} from "@/lib/onboarding/schemas";

/**
 * Better Auth tables (singular names expected by default adapter mapping).
 */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("user_email_unique").on(table.email),
  }),
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    tokenUnique: uniqueIndex("session_token_unique").on(table.token),
    userIdIdx: index("session_user_id_idx").on(table.userId),
  }),
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    slugUnique: uniqueIndex("organization_slug_unique").on(table.slug),
  }),
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    organizationUserUnique: uniqueIndex("member_organization_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    organizationIdx: index("member_organization_idx").on(table.organizationId),
    userIdx: index("member_user_idx").on(table.userId),
  }),
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").default("pending").notNull(),
    teamId: text("team_id"),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("invitation_organization_idx").on(table.organizationId),
    emailIdx: index("invitation_email_idx").on(table.email),
    statusIdx: index("invitation_status_idx").on(table.status),
  }),
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("account_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    userIdIdx: index("account_user_id_idx").on(table.userId),
  }),
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    identifierValueUnique: uniqueIndex("verification_identifier_value_unique").on(
      table.identifier,
      table.value,
    ),
  }),
);

/**
 * Minimal proof that personal authentication state was irreversibly erased.
 * The referenced user row is a pseudonymous tombstone retained only so
 * immutable Workspace, rights, audit, and financial evidence remains valid.
 */
export const identityErasureReceipts = pgTable(
  "identity_erasure_receipts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict" }),
    receiptId: text("receipt_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    result: jsonb("result").$type<Record<string, number>>().notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    receiptUnique: uniqueIndex("identity_erasure_receipts_receipt_id_unique").on(
      table.receiptId,
    ),
    valuesCheck: check(
      "identity_erasure_receipts_values_check",
      sql`${table.receiptId} ~ '^ier_[a-f0-9]{32}$'
        and ${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'
        and octet_length(${table.result}::text) between 2 and 4096
        and ${table.completedAt} >= ${table.requestedAt}`,
    ),
  }),
);

/**
 * ContentOS domain tables (workspace-scoped, multi-tenant aware).
 */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
]);
export const assetTypeEnum = pgEnum("asset_type", [
  "image",
  "video",
  "audio",
  "document",
  "model3d",
  "workflow",
]);
export const storageProviderEnum = pgEnum("storage_provider", [
  "local",
  "s3",
  "r2",
]);
export const generationStatusEnum = pgEnum("generation_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const planTierEnum = pgEnum("plan_tier", [
  "free",
  "pro",
  "enterprise",
]);
export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "not_started",
  "in_progress",
  "ready",
  "completed",
  "completed_legacy",
]);
export const onboardingStepEnum = pgEnum("onboarding_step", [
  "identity",
  "brand_source",
  "company_stage",
  "role",
  "business_classification",
  "goals",
  "attribution",
  "review",
  "education",
]);
export const brandSourceKindEnum = pgEnum("brand_source_kind", [
  "website",
  "description",
]);
export const brandAnalysisStageEnum = pgEnum("brand_analysis_stage", [
  "queued",
  "fetching_source",
  "extracting",
  "generating_profile",
  "generating_first_value",
  "ready",
]);
export const brandAnalysisStatusEnum = pgEnum("brand_analysis_status", [
  "queued",
  "running",
  "ready",
  "failed_retryable",
  "failed_terminal",
]);
export const brandProfileStatusEnum = pgEnum("brand_profile_status", [
  "draft",
  "active",
  "superseded",
]);
export const agentPrincipalStatusEnum = pgEnum("agent_principal_status", [
  "active",
  "suspended",
  "revoked",
]);
export const credentialSecurityEventTypeEnum = pgEnum(
  "credential_security_event_type",
  [
    "profile.created",
    "profile.reprovisioned",
    "profile.rotated",
    "version.revoked",
    "profile.status_changed",
    "spend_grant.created",
    "spend_grant.revoked",
    "effect.reserved",
    "effect.replayed",
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    brandKit: jsonb("brand_kit").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    slugUnique: uniqueIndex("workspaces_slug_unique").on(table.slug),
    ownerIdx: index("workspaces_owner_idx").on(table.ownerUserId),
  }),
);

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planTier: planTierEnum("plan_tier").default("free").notNull(),
    defaultContentLanguage: text("default_content_language")
      .default("ar")
      .notNull(),
    defaultInterfaceLocale: text("default_interface_locale").default("ar").notNull(),
    contentMarket: text("content_market").default("SA").notNull(),
    schedulingTimezone: text("scheduling_timezone").default("UTC").notNull(),
    schedulingWeekStart: integer("scheduling_week_start").default(1).notNull(),
    brandKit: jsonb("brand_kit").$type<Record<string, unknown>>(),
    billingCustomerId: text("billing_customer_id"),
    billingSubscriptionId: text("billing_subscription_id"),
    billingMetadata: jsonb("billing_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    organizationUnique: uniqueIndex("workspace_settings_organization_unique").on(
      table.organizationId,
    ),
    planTierIdx: index("workspace_settings_plan_tier_idx").on(table.planTier),
    schedulingPreferencesCheck: check(
      "workspace_settings_scheduling_preferences_check",
      sql`length(${table.schedulingTimezone}) between 1 and 100
        and ${table.schedulingWeekStart} between 0 and 6`,
    ),
    interfaceLocaleCheck: check(
      "workspace_settings_default_interface_locale_check",
      sql`${table.defaultInterfaceLocale} in ('ar', 'en')`,
    ),
    contentMarketCheck: check(
      "workspace_settings_content_market_check",
      sql`${table.contentMarket} in ('SA', 'AE', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'MA', 'DZ', 'TN', 'LY', 'YE', 'PS', 'SD', 'SY')`,
    ),
  }),
);

export const workspaceStorageLimits = pgTable(
  "workspace_storage_limits",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_members_pk",
      columns: [table.workspaceId, table.userId],
    }),
    userIdx: index("workspace_members_user_idx").on(table.userId),
  }),
);

/** Legacy pre-Workspace locale compatibility; authenticated product reads use the scoped table below. */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  interfaceLocale: text("interface_locale").default("ar").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  localeCheck: check(
    "user_preferences_interface_locale_check",
    sql`${table.interfaceLocale} in ('ar', 'en')`,
  ),
}));

/** A person's Interface Locale is scoped to a Workspace, never global content semantics. */
export const workspaceInterfaceLocalePreferences = pgTable(
  "workspace_interface_locale_preferences",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    interfaceLocale: text("interface_locale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_interface_locale_preferences_pk",
      columns: [table.workspaceId, table.userId],
    }),
    membershipFk: foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
      name: "workspace_interface_locale_preferences_membership_fk",
    }).onDelete("cascade"),
    userIdx: index("workspace_interface_locale_preferences_user_idx").on(table.userId, table.workspaceId),
    localeCheck: check(
      "workspace_interface_locale_preferences_locale_check",
      sql`${table.interfaceLocale} in ('ar', 'en')`,
    ),
  }),
);

/** Resumable, user-owned onboarding state. JSONB is parsed at repository edges. */
export const onboardingSessions = pgTable(
  "onboarding_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    status: onboardingStatusEnum("status").default("not_started").notNull(),
    currentStep: onboardingStepEnum("current_step").default("identity").notNull(),
    answers: jsonb("answers").$type<OnboardingAnswersV1>().notNull(),
    contentLanguage: text("content_language").default("ar").notNull(),
    revision: integer("revision").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userUnique: uniqueIndex("onboarding_sessions_user_unique").on(table.userId),
    workspaceIdx: index("onboarding_sessions_workspace_idx").on(table.workspaceId),
    statusIdx: index("onboarding_sessions_status_idx").on(table.status),
    revisionCheck: check(
      "onboarding_sessions_revision_check",
      sql`${table.revision} >= 0`,
    ),
  }),
);

/** Immutable input revisions used to derive Brand Profiles. */
export const brandSources = pgTable(
  "brand_sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: brandSourceKindEnum("kind").notNull(),
    submittedUrl: text("submitted_url"),
    finalUrl: text("final_url"),
    submittedDescription: text("submitted_description"),
    cleanedText: text("cleaned_text"),
    contentHash: text("content_hash"),
    sourceLanguage: text("source_language"),
    extractedBytes: integer("extracted_bytes"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceRevisionUnique: uniqueIndex(
      "brand_sources_workspace_revision_unique",
    ).on(table.workspaceId, table.revision),
    workspaceCreatedIdx: index("brand_sources_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    createdByIdx: index("brand_sources_created_by_idx").on(table.createdByUserId),
    revisionCheck: check("brand_sources_revision_check", sql`${table.revision} > 0`),
    byteCheck: check(
      "brand_sources_extracted_bytes_check",
      sql`${table.extractedBytes} is null or (${table.extractedBytes} >= 0 and ${table.extractedBytes} <= 6291456)`,
    ),
    sourceShapeCheck: check(
      "brand_sources_shape_check",
      sql`(${table.kind} = 'website' and ${table.submittedUrl} is not null and ${table.submittedDescription} is null) or (${table.kind} = 'description' and ${table.submittedDescription} is not null and ${table.submittedUrl} is null)`,
    ),
  }),
);

/** Canonical asynchronous analysis resource; external execution is an Adapter. */
export const brandAnalysisRuns = pgTable(
  "brand_analysis_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => brandSources.id, { onDelete: "restrict" }),
    retryOfRunId: text("retry_of_run_id"),
    status: brandAnalysisStatusEnum("status").default("queued").notNull(),
    stage: brandAnalysisStageEnum("stage").default("queued").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdempotencyUnique: uniqueIndex(
      "brand_analysis_runs_workspace_idempotency_unique",
    ).on(table.workspaceId, table.idempotencyKey),
    workspaceStatusIdx: index("brand_analysis_runs_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    sourceIdx: index("brand_analysis_runs_source_idx").on(table.sourceId),
    retryIdx: index("brand_analysis_runs_retry_idx").on(table.retryOfRunId),
  }),
);

/** Transactional dispatch intent prevents a committed analysis run from being lost. */
export const onboardingAnalysisDispatchIntents = pgTable(
  "onboarding_analysis_dispatch_intents",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => brandAnalysisRuns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index(
      "onboarding_analysis_dispatch_workspace_status_idx",
    ).on(table.workspaceId, table.status, table.createdAt),
    statusCheck: check(
      "onboarding_analysis_dispatch_status_check",
      sql`${table.status} in ('pending', 'dispatched')`,
    ),
    attemptsCheck: check(
      "onboarding_analysis_dispatch_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
  }),
);

/** Immutable, versioned Brand Profile revisions. */
export const brandProfiles = pgTable(
  "brand_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: brandProfileStatusEnum("status").default("draft").notNull(),
    schemaVersion: integer("schema_version").default(1).notNull(),
    profile: jsonb("profile").$type<BrandProfileV1>().notNull(),
    generatedFromRunId: text("generated_from_run_id")
      .references(() => brandAnalysisRuns.id, { onDelete: "restrict" }),
    sourceProfileId: text("source_profile_id"),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceRevisionUnique: uniqueIndex(
      "brand_profiles_workspace_revision_unique",
    ).on(table.workspaceId, table.revision),
    activeWorkspaceUnique: uniqueIndex(
      "brand_profiles_active_workspace_unique",
    )
      .on(table.workspaceId)
      .where(sql`${table.status} = 'active'`),
    runUnique: uniqueIndex("brand_profiles_run_unique").on(table.generatedFromRunId),
    acceptedByIdx: index("brand_profiles_accepted_by_idx").on(table.acceptedByUserId),
    sourceProfileIdx: index("brand_profiles_source_profile_idx").on(table.sourceProfileId),
    sourceProfileFk: foreignKey({
      columns: [table.sourceProfileId],
      foreignColumns: [table.id],
      name: "brand_profiles_source_profile_id_fk",
    }).onDelete("restrict"),
    revisionCheck: check("brand_profiles_revision_check", sql`${table.revision} > 0`),
    schemaVersionCheck: check(
      "brand_profiles_schema_version_check",
      sql`${table.schemaVersion} = 1`,
    ),
  }),
);

/** First-value output used until the full Blitz domain replaces this Adapter. */
export const onboardingActivationArtifacts = pgTable(
  "onboarding_activation_artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandProfileId: text("brand_profile_id")
      .notNull()
      .references(() => brandProfiles.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").default(1).notNull(),
    artifact: jsonb("artifact").$type<ActivationArtifactV1>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceProfileUnique: uniqueIndex(
      "onboarding_activation_artifacts_workspace_profile_unique",
    ).on(table.workspaceId, table.brandProfileId),
    profileIdx: index("onboarding_activation_artifacts_profile_idx").on(
      table.brandProfileId,
    ),
    schemaVersionCheck: check(
      "onboarding_activation_artifacts_schema_version_check",
      sql`${table.schemaVersion} = 1`,
    ),
  }),
);

/** Idempotent command receipts prevent duplicate workspaces, sources, and runs. */
export const onboardingCommandReceipts = pgTable(
  "onboarding_command_receipts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    commandType: text("command_type").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sessionRevision: integer("session_revision").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "onboarding_command_receipts_pk",
      columns: [table.userId, table.idempotencyKey],
    }),
    fingerprintCheck: check(
      "onboarding_command_receipts_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    revisionCheck: check(
      "onboarding_command_receipts_revision_check",
      sql`${table.sessionRevision} > 0`,
    ),
  }),
);

/** Privacy-bounded onboarding funnel telemetry; no arbitrary JSON or source text. */
export const onboardingAnalyticsEvents = pgTable(
  "onboarding_analytics_events",
  {
    id: text("id").primaryKey(),
    eventName: text("event_name").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id"),
    runId: text("run_id"),
    step: text("step"),
    sourceKind: text("source_kind"),
    stage: text("stage"),
    interfaceLocale: text("interface_locale"),
    contentLanguage: text("content_language"),
    durationMs: integer("duration_ms"),
    failureCode: text("failure_code"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    eventTimeIdx: index("onboarding_analytics_event_time_idx").on(
      table.eventName,
      table.occurredAt,
    ),
    workspaceTimeIdx: index("onboarding_analytics_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    userIdx: index("onboarding_analytics_user_idx").on(table.userId),
    eventCheck: check(
      "onboarding_analytics_event_name_check",
      sql`${table.eventName} in ('signup_submitted','verification_sent','verification_completed','step_viewed','step_completed','source_selected','analysis_stage_completed','analysis_failed','profile_accepted','profile_edited','first_value_viewed','onboarding_completed')`,
    ),
    stepCheck: check(
      "onboarding_analytics_step_check",
      sql`${table.step} is null or ${table.step} in ('identity','brand_source','company_stage','role','business_classification','goals','attribution','review','education')`,
    ),
    sourceKindCheck: check(
      "onboarding_analytics_source_kind_check",
      sql`${table.sourceKind} is null or ${table.sourceKind} in ('website','description')`,
    ),
    stageCheck: check(
      "onboarding_analytics_stage_check",
      sql`${table.stage} is null or ${table.stage} in ('queued','fetching_source','extracting','generating_profile','generating_first_value','ready')`,
    ),
    localeCheck: check(
      "onboarding_analytics_locale_check",
      sql`${table.interfaceLocale} is null or ${table.interfaceLocale} in ('ar','en')`,
    ),
    durationCheck: check(
      "onboarding_analytics_duration_check",
      sql`${table.durationMs} is null or (${table.durationMs} >= 0 and ${table.durationMs} <= 86400000)`,
    ),
    failureCodeCheck: check(
      "onboarding_analytics_failure_code_check",
      sql`${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$'`,
    ),
  }),
);

/**
 * Workspace-scoped API tokens for programmatic Bearer access.
 * Only a SHA-256 hash is persisted; the raw `nb_` token is shown once.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    revoked: boolean("revoked").default(false).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("api_tokens_token_hash_unique").on(
      table.tokenHash,
    ),
    workspaceIdx: index("api_tokens_workspace_idx").on(table.workspaceId),
    createdAtIdx: index("api_tokens_created_at_idx").on(table.createdAt),
  }),
);

/** AI inference providers supported by the workspace BYOK vault. */
export const byokProviderEnum = pgEnum("byok_provider", [
  "gemini",
  "openai",
  "anthropic",
  "kie",
  "fal",
  "replicate",
  "wavespeed",
]);

/** Encrypted, workspace-scoped provider credentials. */
export const workspaceProviderKeys = pgTable(
  "workspace_provider_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: byokProviderEnum("provider").notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    keyHint: text("key_hint").notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceProviderUnique: uniqueIndex(
      "workspace_provider_keys_workspace_provider_unique",
    ).on(table.workspaceId, table.provider),
    workspaceIdx: index("workspace_provider_keys_workspace_idx").on(
      table.workspaceId,
    ),
  }),
);

/**
 * Workspace Agent identities are deliberately separate from Better Auth
 * users. A human remains accountable as sponsor, while the Agent authenticates
 * with independently rotatable keys.
 */
export const agentPairingChallenges = pgTable(
  "agent_pairing_challenges",
  {
    id: text("id").primaryKey(),
    lookupPrefix: text("lookup_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    pepperVersion: integer("pepper_version").default(1).notNull(),
    agentName: text("agent_name").notNull(),
    keyName: text("key_name").notNull(),
    requestedAccess: jsonb("requested_access").$type<string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedWorkspaceId: text("approved_workspace_id").references(
      () => workspaces.id,
      { onDelete: "set null" },
    ),
    approvedByUserId: text("approved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    prefixUnique: uniqueIndex("agent_pairing_challenges_prefix_unique").on(
      table.lookupPrefix,
    ),
    expiryIdx: index("agent_pairing_challenges_expiry_idx").on(table.expiresAt),
  }),
);

export const agentPairingRateLimits = pgTable(
  "agent_pairing_rate_limits",
  {
    requesterFingerprint: text("requester_fingerprint").notNull(),
    action: text("action").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull(),
    requestCount: integer("request_count").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "agent_pairing_rate_limits_pk",
      columns: [table.requesterFingerprint, table.action],
    }),
    expiryIdx: index("agent_pairing_rate_limits_expiry_idx").on(table.expiresAt),
  }),
);

export const agentPrincipals = pgTable(
  "agent_principals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sponsorUserId: text("sponsor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    requestedAccess: jsonb("requested_access").$type<string[]>().notNull(),
    status: agentPrincipalStatusEnum("status").default("active").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("agent_principals_workspace_idx").on(table.workspaceId),
    workspaceIdUnique: uniqueIndex(
      "agent_principals_workspace_id_unique",
    ).on(table.workspaceId, table.id),
    sponsorIdx: index("agent_principals_sponsor_idx").on(table.sponsorUserId),
  }),
);

type StoredAgentResourceConstraints = {
  channelIds: string[];
  credentialProfileIds: string[];
  workflowIds: string[];
  automationIds: string[];
  studioAssetIds?: string[];
  artifactIds?: string[];
};

type StoredAgentCapabilityGrant = {
  capability: string;
  authorizationContractDigest: string;
  resources: StoredAgentResourceConstraints;
};

type StoredAgentKeyScope = {
  capability: string;
  authorizationContractDigest: string;
  resources: StoredAgentResourceConstraints;
};

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: text("id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    lookupPrefix: text("lookup_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    pepperVersion: integer("pepper_version").default(1).notNull(),
    authorizationScopes: jsonb("authorization_scopes")
      .$type<StoredAgentKeyScope[]>()
      .default([])
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    prefixUnique: uniqueIndex("agent_keys_prefix_unique").on(table.lookupPrefix),
    principalIdUnique: uniqueIndex("agent_keys_principal_id_unique").on(
      table.principalId,
      table.id,
    ),
    principalIdx: index("agent_keys_principal_idx").on(table.principalId),
    expiryIdx: index("agent_keys_expiry_idx").on(table.expiresAt),
  }),
);

export const agentGrantSets = pgTable(
  "agent_grant_sets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    activeRevision: integer("active_revision"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .references(() => user.id, { onDelete: "restrict" }),
    createdBySystemActorId: text("created_by_system_actor_id"),
    initiatingUserId: text("initiating_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    principalIdx: index("agent_grant_sets_principal_idx").on(
      table.principalId,
    ),
    workspaceIdx: index("agent_grant_sets_workspace_idx").on(
      table.workspaceId,
    ),
    principalUnique: uniqueIndex("agent_grant_sets_principal_unique").on(
      table.principalId,
    ),
    workspacePrincipalIdUnique: uniqueIndex("agent_grant_sets_workspace_principal_id_unique").on(table.workspaceId, table.principalId, table.id),
    actorCheck: check(
      "agent_grant_sets_actor_check",
      sql`(${table.createdByUserId} is not null and ${table.createdBySystemActorId} is null and ${table.initiatingUserId} is null)
        or (${table.createdByUserId} is null and ${table.createdBySystemActorId} = 'tasmeemai:builtin-service-authority@1' and ${table.initiatingUserId} is not null)`,
    ),
  }),
);

export const agentGrantRevisions = pgTable(
  "agent_grant_revisions",
  {
    id: text("id").primaryKey(),
    grantSetId: text("grant_set_id")
      .notNull()
      .references(() => agentGrantSets.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    grants: jsonb("grants").$type<StoredAgentCapabilityGrant[]>().notNull(),
    createdByUserId: text("created_by_user_id")
      .references(() => user.id, { onDelete: "restrict" }),
    createdBySystemActorId: text("created_by_system_actor_id"),
    initiatingUserId: text("initiating_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    revisionUnique: uniqueIndex("agent_grant_revisions_set_revision_unique").on(
      table.grantSetId,
      table.revision,
    ),
    setIdx: index("agent_grant_revisions_set_idx").on(table.grantSetId),
    setIdUnique: uniqueIndex("agent_grant_revisions_set_id_unique").on(table.grantSetId, table.id),
    actorCheck: check(
      "agent_grant_revisions_actor_check",
      sql`(${table.createdByUserId} is not null and ${table.createdBySystemActorId} is null and ${table.initiatingUserId} is null)
        or (${table.createdByUserId} is null and ${table.createdBySystemActorId} = 'tasmeemai:builtin-service-authority@1' and ${table.initiatingUserId} is not null)`,
    ),
  }),
);

export const workspaceAgentPolicyRevisions = pgTable(
  "workspace_agent_policy_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    enabled: boolean("enabled").notNull(),
    grants: jsonb("grants").$type<StoredAgentCapabilityGrant[]>().notNull(),
    createdByUserId: text("created_by_user_id")
      .references(() => user.id, { onDelete: "restrict" }),
    createdBySystemActorId: text("created_by_system_actor_id"),
    initiatingUserId: text("initiating_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceRevisionUnique: uniqueIndex(
      "workspace_agent_policy_revisions_workspace_revision_unique",
    ).on(table.workspaceId, table.revision),
    workspaceIdUnique: uniqueIndex(
      "workspace_agent_policy_revisions_workspace_id_unique",
    ).on(table.workspaceId, table.id),
    actorCheck: check(
      "workspace_agent_policy_revisions_actor_check",
      sql`(${table.createdByUserId} is not null and ${table.createdBySystemActorId} is null and ${table.initiatingUserId} is null)
        or (${table.createdByUserId} is null and ${table.createdBySystemActorId} = 'tasmeemai:builtin-service-authority@1' and ${table.initiatingUserId} is not null)`,
    ),
  }),
);

export const workspaceAgentPolicies = pgTable(
  "workspace_agent_policies",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    activeRevisionId: text("active_revision_id").notNull(),
    revision: integer("revision").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    grants: jsonb("grants").$type<StoredAgentCapabilityGrant[]>().notNull(),
    updatedByUserId: text("updated_by_user_id")
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBySystemActorId: text("updated_by_system_actor_id"),
    initiatingUserId: text("initiating_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    activeRevisionWorkspaceFk: foreignKey({
      columns: [table.workspaceId, table.activeRevisionId],
      foreignColumns: [
        workspaceAgentPolicyRevisions.workspaceId,
        workspaceAgentPolicyRevisions.id,
      ],
      name: "workspace_agent_policies_active_revision_workspace_fk",
    }).onDelete("restrict"),
    actorCheck: check(
      "workspace_agent_policies_actor_check",
      sql`(${table.updatedByUserId} is not null and ${table.updatedBySystemActorId} is null and ${table.initiatingUserId} is null)
        or (${table.updatedByUserId} is null and ${table.updatedBySystemActorId} = 'tasmeemai:builtin-service-authority@1' and ${table.initiatingUserId} is not null)`,
    ),
  }),
);

export const credentialProfiles = pgTable(
  "credential_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").default("generic").notNull(),
    status: text("status").default("active").notNull(),
    activeVersion: integer("active_version").default(1).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceIdx: index("credential_profiles_workspace_idx").on(
      table.workspaceId,
    ),
    workspaceNameUnique: uniqueIndex(
      "credential_profiles_workspace_name_unique",
    )
      .on(table.workspaceId, table.name)
      .where(sql`${table.status} = 'active'`),
    workspaceIdUnique: uniqueIndex(
      "credential_profiles_workspace_id_unique",
    ).on(table.workspaceId, table.id),
    statusCheck: check(
      "credential_profiles_status_check",
      sql`${table.status} in ('active', 'disabled')`,
    ),
    activeVersionCheck: check(
      "credential_profiles_active_version_check",
      sql`${table.activeVersion} > 0`,
    ),
  }),
);

/**
 * Completed human credential mutations. The receipt is inserted in the same
 * transaction as the protected mutation, so a retried request can recover the
 * exact redacted response after the original HTTP response is lost.
 */
export const credentialHumanMutationReceipts = pgTable(
  "credential_human_mutation_receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    capabilityIdentity: text("capability_identity").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    safeResult: jsonb("safe_result").$type<unknown>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    invocationUnique: uniqueIndex(
      "credential_human_mutation_receipts_invocation_unique",
    ).on(
      table.workspaceId,
      table.actorUserId,
      table.capabilityIdentity,
      table.idempotencyKey,
    ),
    workspaceCompletedIdx: index(
      "credential_human_mutation_receipts_workspace_completed_idx",
    ).on(table.workspaceId, table.completedAt),
    capabilityIdentityCheck: check(
      "credential_human_mutation_receipts_capability_identity_check",
      sql`${table.capabilityIdentity} ~ '^credentials\\.[a-z][a-z0-9_.]*@[1-9][0-9]*$'`,
    ),
    idempotencyKeyCheck: check(
      "credential_human_mutation_receipts_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 8 and 200`,
    ),
    fingerprintCheck: check(
      "credential_human_mutation_receipts_request_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    safeResultSizeCheck: check(
      "credential_human_mutation_receipts_safe_result_size_check",
      sql`octet_length(${table.safeResult}::text) <= 65536`,
    ),
    safeResultRedactionCheck: check(
      "credential_human_mutation_receipts_safe_result_redaction_check",
      sql`${table.safeResult}::text !~* '"(secret|token|password|ciphertext)"\\s*:'`,
    ),
  }),
);

export const credentialProfileVersions = pgTable(
  "credential_profile_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    profileId: text("profile_id").notNull(),
    version: integer("version").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretHint: text("secret_hint").notNull(),
    status: text("status").default("active").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    usableUntil: timestamp("usable_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId],
      foreignColumns: [credentialProfiles.workspaceId, credentialProfiles.id],
      name: "credential_profile_versions_workspace_profile_fk",
    }).onDelete("restrict"),
    profileVersionUnique: uniqueIndex(
      "credential_profile_versions_profile_version_unique",
    ).on(table.profileId, table.version),
    workspaceIdUnique: uniqueIndex(
      "credential_profile_versions_workspace_id_unique",
    ).on(table.workspaceId, table.id),
    workspaceProfileIdUnique: uniqueIndex(
      "credential_profile_versions_workspace_profile_id_unique",
    ).on(table.workspaceId, table.profileId, table.id),
    workspaceProfileVersionUnique: uniqueIndex(
      "credential_profile_versions_workspace_profile_version_unique",
    ).on(table.workspaceId, table.profileId, table.version),
    oneActiveVersionUnique: uniqueIndex(
      "credential_profile_versions_one_active_unique",
    )
      .on(table.workspaceId, table.profileId)
      .where(sql`${table.status} = 'active'`),
    profileStatusIdx: index(
      "credential_profile_versions_profile_status_idx",
    ).on(table.profileId, table.status),
    statusCheck: check(
      "credential_profile_versions_status_check",
      sql`${table.status} in ('active', 'superseded', 'revoked')`,
    ),
    versionCheck: check(
      "credential_profile_versions_version_check",
      sql`${table.version} > 0`,
    ),
  }),
);

export const credentialSlots = pgTable(
  "credential_slots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId],
      foreignColumns: [credentialProfiles.workspaceId, credentialProfiles.id],
      name: "credential_slots_workspace_profile_fk",
    }).onDelete("restrict"),
    workspaceNameUnique: uniqueIndex(
      "credential_slots_workspace_name_unique",
    ).on(table.workspaceId, table.name),
    workspaceProfileIdUnique: uniqueIndex(
      "credential_slots_workspace_profile_id_unique",
    ).on(table.workspaceId, table.profileId, table.id),
    profileIdx: index("credential_slots_profile_idx").on(table.profileId),
  }),
);

export const credentialSpendGrants = pgTable(
  "credential_spend_grants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    profileId: text("profile_id").notNull(),
    mode: text("mode").notNull(),
    limitCents: integer("limit_cents"),
    status: text("status").default("active").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "credential_spend_grants_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId],
      foreignColumns: [credentialProfiles.workspaceId, credentialProfiles.id],
      name: "credential_spend_grants_workspace_profile_fk",
    }).onDelete("restrict"),
    workspacePrincipalProfileIdUnique: uniqueIndex(
      "credential_spend_grants_workspace_principal_profile_id_unique",
    ).on(table.workspaceId, table.principalId, table.profileId, table.id),
    principalProfileStatusIdx: index(
      "credential_spend_grants_principal_profile_status_idx",
    ).on(table.principalId, table.profileId, table.status),
    activePrincipalProfileUnique: uniqueIndex(
      "credential_spend_grants_active_principal_profile_unique",
    )
      .on(table.principalId, table.profileId)
      .where(sql`${table.status} = 'active'`),
    workspaceIdx: index("credential_spend_grants_workspace_idx").on(
      table.workspaceId,
    ),
    modeCheck: check(
      "credential_spend_grants_mode_check",
      sql`(${table.mode} = 'bounded' and ${table.limitCents} > 0) or (${table.mode} = 'audited_unbounded' and ${table.limitCents} is null)`,
    ),
    statusCheck: check(
      "credential_spend_grants_status_check",
      sql`${table.status} in ('active', 'revoked')`,
    ),
  }),
);

export const credentialSpendEvents = pgTable(
  "credential_spend_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    slotId: text("slot_id").notNull(),
    profileId: text("profile_id").notNull(),
    versionId: text("version_id").notNull(),
    spendGrantId: text("spend_grant_id").notNull(),
    priceCeilingCents: integer("price_ceiling_cents").notNull(),
    mode: text("mode").notNull(),
    effectRef: text("effect_ref").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    resolvedVersion: integer("resolved_version").notNull(),
    resolvedProvider: text("resolved_provider").notNull(),
    status: text("status").default("pending").notNull(),
    safeResult: jsonb("safe_result").$type<unknown>(),
    failureCode: text("failure_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    unknownAt: timestamp("unknown_at", { withTimezone: true }),
    reconciliationReference: text("reconciliation_reference"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "credential_spend_events_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceSlotProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId, table.slotId],
      foreignColumns: [
        credentialSlots.workspaceId,
        credentialSlots.profileId,
        credentialSlots.id,
      ],
      name: "credential_spend_events_workspace_slot_profile_fk",
    }).onDelete("restrict"),
    workspaceProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId],
      foreignColumns: [credentialProfiles.workspaceId, credentialProfiles.id],
      name: "credential_spend_events_workspace_profile_fk",
    }).onDelete("restrict"),
    workspaceProfileVersionFk: foreignKey({
      columns: [table.workspaceId, table.profileId, table.versionId],
      foreignColumns: [
        credentialProfileVersions.workspaceId,
        credentialProfileVersions.profileId,
        credentialProfileVersions.id,
      ],
      name: "credential_spend_events_workspace_profile_version_fk",
    }).onDelete("restrict"),
    workspacePrincipalProfileGrantFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.profileId,
        table.spendGrantId,
      ],
      foreignColumns: [
        credentialSpendGrants.workspaceId,
        credentialSpendGrants.principalId,
        credentialSpendGrants.profileId,
        credentialSpendGrants.id,
      ],
      name: "credential_spend_events_workspace_principal_profile_grant_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index(
      "credential_spend_events_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    grantCreatedIdx: index(
      "credential_spend_events_grant_created_idx",
    ).on(table.spendGrantId, table.createdAt),
    grantStatusCreatedIdx: index(
      "credential_spend_events_grant_status_created_idx",
    ).on(table.spendGrantId, table.status, table.createdAt),
    reconciliationIdx: index(
      "credential_spend_events_reconciliation_idx",
    )
      .on(table.workspaceId, table.status, table.unknownAt)
      .where(sql`${table.status} in ('pending', 'unknown')`),
    workspaceEffectRefUnique: uniqueIndex(
      "credential_spend_events_workspace_effect_ref_unique",
    ).on(table.workspaceId, table.effectRef),
    workspaceRequestFingerprintIdx: index(
      "credential_spend_events_workspace_request_fingerprint_idx",
    ).on(table.workspaceId, table.requestFingerprint),
    amountCheck: check(
      "credential_spend_events_amount_check",
      sql`${table.priceCeilingCents} >= 0`,
    ),
    modeCheck: check(
      "credential_spend_events_mode_check",
      sql`${table.mode} in ('bounded', 'audited_unbounded')`,
    ),
    fingerprintCheck: check(
      "credential_spend_events_request_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    resolvedVersionCheck: check(
      "credential_spend_events_resolved_version_check",
      sql`${table.resolvedVersion} > 0`,
    ),
    statusCheck: check(
      "credential_spend_events_status_check",
      sql`${table.status} in ('pending', 'completed', 'failed', 'unknown')`,
    ),
    stateCheck: check(
      "credential_spend_events_state_check",
      sql`(
        (${table.status} = 'pending'
          and ${table.safeResult} is null
          and ${table.failureCode} is null
          and ${table.completedAt} is null
          and ${table.failedAt} is null
          and ${table.unknownAt} is null)
        or
        (${table.status} = 'completed'
          and ${table.safeResult} is not null
          and ${table.failureCode} is null
          and ${table.completedAt} is not null
          and ${table.failedAt} is null)
        or
        (${table.status} = 'failed'
          and ${table.failureCode} is not null
          and ${table.completedAt} is null
          and ${table.failedAt} is not null
          and ${table.unknownAt} is null)
        or
        (${table.status} = 'unknown'
          and ${table.safeResult} is null
          and ${table.failureCode} is not null
          and ${table.completedAt} is null
          and ${table.failedAt} is null
          and ${table.unknownAt} is not null)
      )`,
    ),
    failureCodeCheck: check(
      "credential_spend_events_failure_code_check",
      sql`${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$'`,
    ),
    safeResultSizeCheck: check(
      "credential_spend_events_safe_result_size_check",
      sql`${table.safeResult} is null or octet_length(${table.safeResult}::text) <= 65536`,
    ),
    safeResultRedactionCheck: check(
      "credential_spend_events_safe_result_redaction_check",
      sql`${table.safeResult} is null or ${table.safeResult}::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\\s*:'`,
    ),
    reconciliationCheck: check(
      "credential_spend_events_reconciliation_check",
      sql`(${table.reconciliationReference} is null and ${table.reconciledAt} is null)
        or (${table.reconciliationReference} is not null and ${table.reconciledAt} is not null)`,
    ),
  }),
);

export const credentialSecurityEvents = pgTable(
  "credential_security_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    eventType: credentialSecurityEventTypeEnum("event_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    principalId: text("principal_id"),
    profileId: text("profile_id"),
    versionId: text("version_id"),
    spendGrantId: text("spend_grant_id"),
    effectRef: text("effect_ref"),
    details: jsonb("details")
      .$type<Record<string, string | number | boolean | null>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "credential_security_events_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceProfileFk: foreignKey({
      columns: [table.workspaceId, table.profileId],
      foreignColumns: [credentialProfiles.workspaceId, credentialProfiles.id],
      name: "credential_security_events_workspace_profile_fk",
    }).onDelete("restrict"),
    workspaceProfileVersionFk: foreignKey({
      columns: [table.workspaceId, table.profileId, table.versionId],
      foreignColumns: [
        credentialProfileVersions.workspaceId,
        credentialProfileVersions.profileId,
        credentialProfileVersions.id,
      ],
      name: "credential_security_events_workspace_profile_version_fk",
    }).onDelete("restrict"),
    workspacePrincipalProfileGrantFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.profileId,
        table.spendGrantId,
      ],
      foreignColumns: [
        credentialSpendGrants.workspaceId,
        credentialSpendGrants.principalId,
        credentialSpendGrants.profileId,
        credentialSpendGrants.id,
      ],
      name: "credential_security_events_workspace_principal_profile_grant_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index(
      "credential_security_events_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    notificationCursorIdx: index(
      "credential_security_events_notification_cursor_idx",
    ).on(table.createdAt, table.id).where(sql`${table.eventType} in ('profile.created','profile.reprovisioned','profile.rotated','version.revoked','profile.status_changed','spend_grant.created','spend_grant.revoked')`),
    workspaceEffectIdx: index(
      "credential_security_events_workspace_effect_idx",
    ).on(table.workspaceId, table.effectRef),
    actorCheck: check(
      "credential_security_events_actor_check",
      sql`${table.actorUserId} is not null or ${table.principalId} is not null`,
    ),
    effectRefCheck: check(
      "credential_security_events_effect_ref_check",
      sql`(${table.eventType} in ('effect.reserved', 'effect.replayed')) = (${table.effectRef} is not null)`,
    ),
    detailsSizeCheck: check(
      "credential_security_events_details_size_check",
      sql`octet_length(${table.details}::text) <= 4096`,
    ),
    detailsRedactionCheck: check(
      "credential_security_events_details_redaction_check",
      sql`${table.details}::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\\s*:'`,
    ),
  }),
);

/**
 * Append-only lifecycle ledger for external Credential effects. The mutable
 * spend-event row is only the current receipt/projection; audit history reads
 * this ledger so terminal transitions and ordinary replays cannot overwrite
 * earlier facts.
 */
export const credentialEffectAuditEvents = pgTable(
  "credential_effect_audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    profileId: text("profile_id").notNull(),
    versionId: text("version_id").notNull(),
    spendGrantId: text("spend_grant_id").notNull(),
    effectRef: text("effect_ref").notNull(),
    effectSequence: integer("effect_sequence").notNull(),
    eventType: text("event_type").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    failureCode: text("failure_code"),
    reconciliationReference: text("reconciliation_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "credential_effect_audit_events_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceProfileVersionFk: foreignKey({
      columns: [table.workspaceId, table.profileId, table.versionId],
      foreignColumns: [
        credentialProfileVersions.workspaceId,
        credentialProfileVersions.profileId,
        credentialProfileVersions.id,
      ],
      name: "credential_effect_audit_events_workspace_profile_version_fk",
    }).onDelete("restrict"),
    workspacePrincipalProfileGrantFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.profileId,
        table.spendGrantId,
      ],
      foreignColumns: [
        credentialSpendGrants.workspaceId,
        credentialSpendGrants.principalId,
        credentialSpendGrants.profileId,
        credentialSpendGrants.id,
      ],
      name: "credential_effect_audit_events_workspace_grant_fk",
    }).onDelete("restrict"),
    effectSequenceUnique: uniqueIndex(
      "credential_effect_audit_events_effect_sequence_unique",
    ).on(table.workspaceId, table.effectRef, table.effectSequence),
    workspaceCreatedIdx: index(
      "credential_effect_audit_events_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt, table.id),
    eventTypeCheck: check(
      "credential_effect_audit_events_type_check",
      sql`${table.eventType} in ('effect.reserved', 'effect.completed', 'effect.failed', 'effect.unknown', 'effect.reconciled', 'effect.released', 'effect.replayed')`,
    ),
    sequenceCheck: check(
      "credential_effect_audit_events_sequence_check",
      sql`${table.effectSequence} > 0`,
    ),
    fingerprintCheck: check(
      "credential_effect_audit_events_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    failureCodeCheck: check(
      "credential_effect_audit_events_failure_code_check",
      sql`${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$'`,
    ),
  }),
);

/**
 * Canonical Agent Artifact content and provenance. These tables intentionally
 * do not reuse mutable Studio Asset rows or CDN fields.
 */
export const artifactContents = pgTable(
  "artifact_contents",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    digest: text("digest").notNull(),
    kind: text("kind").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    inlineText: text("inline_text"),
    storageKey: text("storage_key"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.digest],
      name: "artifact_contents_pk",
    }),
    identityUnique: uniqueIndex("artifact_contents_identity_unique").on(
      table.workspaceId,
      table.digest,
      table.kind,
      table.mediaType,
      table.sizeBytes,
    ),
    storageKeyUnique: uniqueIndex("artifact_contents_storage_key_unique")
      .on(table.storageKey)
      .where(sql`${table.storageKey} is not null`),
    digestCheck: check(
      "artifact_contents_digest_check",
      sql`${table.digest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    kindCheck: check(
      "artifact_contents_kind_check",
      sql`${table.kind} in ('text', 'image')`,
    ),
    sizeCheck: check(
      "artifact_contents_size_check",
      sql`${table.sizeBytes} >= 0 and ${table.sizeBytes} <= 52428800`,
    ),
    locationCheck: check(
      "artifact_contents_location_check",
      sql`(
        ${table.kind} = 'text'
        and ${table.inlineText} is not null
        and ${table.storageKey} is null
        and ${table.width} is null
        and ${table.height} is null
      ) or (
        ${table.kind} = 'image'
        and ${table.inlineText} is null
        and ${table.storageKey} is not null
        and ${table.width} > 0
        and ${table.height} > 0
      )`,
    ),
    storageKeyCheck: check(
      "artifact_contents_storage_key_check",
      sql`${table.storageKey} is null or (
        length(${table.storageKey}) between 1 and 1024
        and ${table.storageKey} !~* '^https?://'
      )`,
    ),
  }),
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    contentDigest: text("content_digest").notNull(),
    kind: text("kind").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    creatorPrincipalId: text("creator_principal_id").notNull(),
    origin: text("origin").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    retentionMode: text("retention_mode").notNull(),
    retentionSnapshotAt: timestamp("retention_snapshot_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("artifacts_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    workspaceIdOriginUnique: uniqueIndex(
      "artifacts_workspace_id_origin_unique",
    ).on(table.workspaceId, table.id, table.origin),
    workspaceIdKindDigestUnique: uniqueIndex(
      "artifacts_workspace_id_kind_digest_unique",
    ).on(
      table.workspaceId,
      table.id,
      table.kind,
      table.contentDigest,
    ),
    workspaceContentFk: foreignKey({
      columns: [
        table.workspaceId,
        table.contentDigest,
        table.kind,
        table.mediaType,
        table.sizeBytes,
      ],
      foreignColumns: [
        artifactContents.workspaceId,
        artifactContents.digest,
        artifactContents.kind,
        artifactContents.mediaType,
        artifactContents.sizeBytes,
      ],
      name: "artifacts_workspace_content_fk",
    }).onDelete("restrict"),
    workspaceCreatorFk: foreignKey({
      columns: [table.workspaceId, table.creatorPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "artifacts_workspace_creator_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index("artifacts_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    workspaceDigestIdx: index("artifacts_workspace_digest_idx").on(
      table.workspaceId,
      table.contentDigest,
    ),
    typeCheck: check(
      "artifacts_type_check",
      sql`${table.kind} in ('text', 'image')`,
    ),
    originCheck: check(
      "artifacts_origin_check",
      sql`${table.origin} in ('imported', 'generated')`,
    ),
    originLifecycleCheck: check(
      "artifacts_origin_lifecycle_check",
      sql`(
        ${table.origin} = 'imported'
        and ${table.importedAt} is not null
      ) or (
        ${table.origin} = 'generated'
        and ${table.importedAt} is null
      )`,
    ),
    retentionCheck: check(
      "artifacts_retention_check",
      sql`${table.retentionMode} = 'workspace_default'`,
    ),
  }),
);

export const artifactUploads = pgTable(
  "artifact_uploads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    stagingKey: text("staging_key").notNull(),
    declaredMediaType: text("declared_media_type").notNull(),
    expectedDigest: text("expected_digest"),
    expectedSizeBytes: integer("expected_size_bytes"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    artifactId: text("artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("artifact_uploads_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "artifact_uploads_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceArtifactFk: foreignKey({
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifacts.workspaceId, artifacts.id],
      name: "artifact_uploads_workspace_artifact_fk",
    }).onDelete("restrict"),
    workspaceStatusExpiryIdx: index(
      "artifact_uploads_workspace_status_expiry_idx",
    ).on(table.workspaceId, table.status, table.expiresAt),
    stagingKeyUnique: uniqueIndex("artifact_uploads_staging_key_unique").on(
      table.stagingKey,
    ),
    statusCheck: check(
      "artifact_uploads_status_check",
      sql`${table.status} in ('pending', 'completed', 'failed')`,
    ),
    expectedDigestCheck: check(
      "artifact_uploads_expected_digest_check",
      sql`${table.expectedDigest} is null or ${table.expectedDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    expectedSizeCheck: check(
      "artifact_uploads_expected_size_check",
      sql`${table.expectedSizeBytes} is null or (
        ${table.expectedSizeBytes} >= 0
        and ${table.expectedSizeBytes} <= 52428800
      )`,
    ),
    stagingKeyCheck: check(
      "artifact_uploads_staging_key_check",
      sql`length(${table.stagingKey}) between 1 and 1024 and ${table.stagingKey} !~* '^https?://'`,
    ),
    stateCheck: check(
      "artifact_uploads_state_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.artifactId} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'completed'
        and ${table.artifactId} is not null
        and ${table.completedAt} is not null
      ) or ${table.status} = 'failed'`,
    ),
  }),
);

export const artifactMutationReceipts = pgTable(
  "artifact_mutation_receipts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "artifact_mutation_receipts_pk",
    }),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "artifact_mutation_receipts_workspace_principal_fk",
    }).onDelete("restrict"),
    fingerprintCheck: check(
      "artifact_mutation_receipts_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    capabilityCheck: check(
      "artifact_mutation_receipts_capability_check",
      sql`${table.capability} in (
        'artifacts.import@1',
        'artifact_uploads.begin@1',
        'artifact_uploads.complete@1'
      )`,
    ),
  }),
);

export const artifactAuditEvents = pgTable(
  "artifact_audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    artifactId: text("artifact_id"),
    uploadId: text("upload_id"),
    eventType: text("event_type").notNull(),
    requestFingerprint: text("request_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "artifact_audit_events_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceArtifactFk: foreignKey({
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifacts.workspaceId, artifacts.id],
      name: "artifact_audit_events_workspace_artifact_fk",
    }).onDelete("restrict"),
    workspaceUploadFk: foreignKey({
      columns: [table.workspaceId, table.uploadId],
      foreignColumns: [artifactUploads.workspaceId, artifactUploads.id],
      name: "artifact_audit_events_workspace_upload_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index("artifact_audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    eventTypeCheck: check(
      "artifact_audit_events_type_check",
      sql`${table.eventType} in (
        'artifact.imported',
        'artifact.upload_begun',
        'artifact.upload_completed',
        'artifact.download_handoff_created'
      )`,
    ),
    fingerprintCheck: check(
      "artifact_audit_events_fingerprint_check",
      sql`${table.requestFingerprint} is null or ${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  }),
);

/**
 * Canonical Agent-authored content Workflows. These identities and immutable
 * revisions are intentionally distinct from mutable Studio Project rows.
 */
export const contentWorkflows = pgTable(
  "content_workflows",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    currentRevision: integer("current_revision").default(0).notNull(),
    createdByPrincipalId: text("created_by_principal_id").notNull(),
    createdByKeyId: text("created_by_key_id").notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "content_workflows_pk",
    }),
    workspaceCreatorFk: foreignKey({
      columns: [table.workspaceId, table.createdByPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "content_workflows_workspace_creator_fk",
    }).onDelete("restrict"),
    creatorKeyFk: foreignKey({
      columns: [table.createdByPrincipalId, table.createdByKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "content_workflows_creator_key_fk",
    }).onDelete("restrict"),
    workspaceUpdatedIdx: index("content_workflows_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
      table.id,
    ),
    currentRevisionCheck: check(
      "content_workflows_current_revision_check",
      sql`${table.currentRevision} >= 0`,
    ),
    idCheck: check(
      "content_workflows_id_check",
      sql`length(${table.id}) between 1 and 200 and ${table.id} ~ '^[a-zA-Z0-9_-]+$'`,
    ),
    evidenceCheck: check(
      "content_workflows_evidence_check",
      sql`length(${table.authorizationEvidenceRef}) between 1 and 200`,
    ),
  }),
);

export const contentWorkflowRevisions = pgTable(
  "content_workflow_revisions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    workflowId: text("workflow_id").notNull(),
    revision: integer("revision").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    definition: jsonb("definition")
      .$type<ResolvedWorkflowDefinition>()
      .notNull(),
    operationRegistryDigest: text("operation_registry_digest").notNull(),
    authorPrincipalId: text("author_principal_id").notNull(),
    authorKeyId: text("author_key_id").notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "content_workflow_revisions_pk",
    }),
    workflowRevisionUnique: uniqueIndex(
      "content_workflow_revisions_workspace_workflow_revision_unique",
    ).on(table.workspaceId, table.workflowId, table.revision),
    workspaceWorkflowIdUnique: uniqueIndex(
      "content_workflow_revisions_workspace_workflow_id_unique",
    ).on(table.workspaceId, table.workflowId, table.id),
    workspaceWorkflowIdentityUnique: uniqueIndex(
      "content_workflow_revisions_workspace_workflow_identity_unique",
    ).on(
      table.workspaceId,
      table.workflowId,
      table.id,
      table.revision,
      table.definitionDigest,
    ),
    workspaceWorkflowFk: foreignKey({
      columns: [table.workspaceId, table.workflowId],
      foreignColumns: [contentWorkflows.workspaceId, contentWorkflows.id],
      name: "content_workflow_revisions_workspace_workflow_fk",
    }).onDelete("restrict"),
    workspaceAuthorFk: foreignKey({
      columns: [table.workspaceId, table.authorPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "content_workflow_revisions_workspace_author_fk",
    }).onDelete("restrict"),
    authorKeyFk: foreignKey({
      columns: [table.authorPrincipalId, table.authorKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "content_workflow_revisions_author_key_fk",
    }).onDelete("restrict"),
    workspaceWorkflowCreatedIdx: index(
      "content_workflow_revisions_workspace_workflow_created_idx",
    ).on(table.workspaceId, table.workflowId, table.createdAt, table.id),
    revisionCheck: check(
      "content_workflow_revisions_revision_check",
      sql`${table.revision} > 0`,
    ),
    definitionDigestCheck: check(
      "content_workflow_revisions_definition_digest_check",
      sql`${table.definitionDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    operationRegistryDigestCheck: check(
      "content_workflow_revisions_registry_digest_check",
      sql`${table.operationRegistryDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    definitionIdentityCheck: check(
      "content_workflow_revisions_definition_identity_check",
      sql`jsonb_typeof(${table.definition}) = 'object'
        and ${table.definition}->>'schema' = 'content-workflow-revision-definition/v1'
        and ${table.definition}->>'workflowId' = ${table.workflowId}`,
    ),
    idCheck: check(
      "content_workflow_revisions_id_check",
      sql`length(${table.id}) between 1 and 200 and ${table.id} ~ '^[a-zA-Z0-9_-]+$'`,
    ),
    evidenceCheck: check(
      "content_workflow_revisions_evidence_check",
      sql`length(${table.authorizationEvidenceRef}) between 1 and 200`,
    ),
  }),
);

export const workflowRevisionMutationReceipts = pgTable(
  "workflow_revision_mutation_receipts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "workflow_revision_mutation_receipts_pk",
    }),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "workflow_revision_mutation_receipts_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index(
      "workflow_revision_mutation_receipts_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    capabilityCheck: check(
      "workflow_revision_mutation_receipts_capability_check",
      sql`${table.capability} in ('workflows.create@1', 'workflow_versions.create@1')`,
    ),
    idempotencyKeyCheck: check(
      "workflow_revision_mutation_receipts_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 8 and 200 and ${table.idempotencyKey} ~ '^[!-~]+$'`,
    ),
    fingerprintCheck: check(
      "workflow_revision_mutation_receipts_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    resourceIdCheck: check(
      "workflow_revision_mutation_receipts_resource_id_check",
      sql`length(${table.resourceId}) between 1 and 200 and ${table.resourceId} ~ '^[a-zA-Z0-9_-]+$'`,
    ),
  }),
);

/**
 * Publishing Plan identities are mutable allocation heads. Their revisions
 * retain the complete normalized target set and point-in-time validation
 * evidence as one immutable record so historical inspection never depends on
 * mutable Channel or Artifact rows.
 */
export const runtimePublishingPlans = pgTable(
  "runtime_publishing_plans",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    currentRevision: integer("current_revision").default(0).notNull(),
    createdByPrincipalId: text("created_by_principal_id").notNull(),
    createdByKeyId: text("created_by_key_id").notNull(),
    creationAuthorizationEvidenceRef: text(
      "creation_authorization_evidence_ref",
    ).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_plans_pk",
    }),
    workspaceCreatorFk: foreignKey({
      columns: [table.workspaceId, table.createdByPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_plans_workspace_creator_fk",
    }).onDelete("restrict"),
    creatorKeyFk: foreignKey({
      columns: [table.createdByPrincipalId, table.createdByKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_plans_creator_key_fk",
    }).onDelete("restrict"),
    creationAuthorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.createdByPrincipalId,
        table.createdByKeyId,
        table.creationAuthorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_plans_creation_authorization_evidence_fk",
    }).onDelete("restrict"),
    workspaceUpdatedIdx: index(
      "runtime_publishing_plans_workspace_updated_idx",
    ).on(
      table.workspaceId.asc(),
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    workspaceCreatorIdx: index(
      "runtime_publishing_plans_workspace_creator_idx",
    ).on(table.workspaceId, table.createdByPrincipalId),
    creatorKeyIdx: index("runtime_publishing_plans_creator_key_idx").on(
      table.createdByPrincipalId,
      table.createdByKeyId,
    ),
    creationAuthorizationEvidenceIdx: index(
      "runtime_publishing_plans_creation_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.createdByPrincipalId,
      table.createdByKeyId,
      table.creationAuthorizationEvidenceRef,
    ),
    revisionCheck: check(
      "runtime_publishing_plans_current_revision_check",
      sql`${table.currentRevision} >= 0`,
    ),
    identityCheck: check(
      "runtime_publishing_plans_identity_check",
      sql`length(${table.id}) between 1 and 200 and ${table.id} ~ '^[A-Za-z0-9_-]+$'`,
    ),
    evidenceCheck: check(
      "runtime_publishing_plans_evidence_check",
      sql`length(${table.createdByKeyId}) between 1 and 200
        and length(${table.creationAuthorizationEvidenceRef}) between 1 and 200`,
    ),
  }),
);

export const runtimePublishingPlanRevisions = pgTable(
  "runtime_publishing_plan_revisions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    planId: text("plan_id").notNull(),
    revision: integer("revision").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    definition: jsonb("definition")
      .$type<NormalizedPublishingPlanDefinition>()
      .notNull(),
    validationEvidenceDigest: text("validation_evidence_digest").notNull(),
    validationEvidence: jsonb("validation_evidence")
      .$type<PublishingPlanSuccessfulValidationEvidence>()
      .notNull(),
    authorPrincipalId: text("author_principal_id").notNull(),
    authorKeyId: text("author_key_id").notNull(),
    creationAuthorizationEvidenceRef: text(
      "creation_authorization_evidence_ref",
    ).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_plan_revisions_pk",
    }),
    planRevisionUnique: uniqueIndex(
      "runtime_publishing_plan_revisions_workspace_plan_revision_unique",
    ).on(table.workspaceId, table.planId, table.revision),
    workspacePlanIdUnique: uniqueIndex(
      "runtime_publishing_plan_revisions_workspace_plan_id_unique",
    ).on(table.workspaceId, table.planId, table.id),
    approvalIdentityUnique: uniqueIndex(
      "runtime_publishing_plan_revisions_approval_identity_unique",
    ).on(
      table.workspaceId,
      table.planId,
      table.id,
      table.revision,
      table.definitionDigest,
      table.validationEvidenceDigest,
    ),
    workspacePlanFk: foreignKey({
      columns: [table.workspaceId, table.planId],
      foreignColumns: [runtimePublishingPlans.workspaceId, runtimePublishingPlans.id],
      name: "runtime_publishing_plan_revisions_workspace_plan_fk",
    }).onDelete("restrict"),
    workspaceAuthorFk: foreignKey({
      columns: [table.workspaceId, table.authorPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_plan_revisions_workspace_author_fk",
    }).onDelete("restrict"),
    authorKeyFk: foreignKey({
      columns: [table.authorPrincipalId, table.authorKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_plan_revisions_author_key_fk",
    }).onDelete("restrict"),
    creationAuthorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.authorPrincipalId,
        table.authorKeyId,
        table.creationAuthorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name:
        "runtime_publishing_plan_revisions_creation_authorization_evidence_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index(
      "runtime_publishing_plan_revisions_workspace_created_idx",
    ).on(
      table.workspaceId.asc(),
      table.createdAt.desc(),
      table.id.desc(),
    ),
    workspacePlanCreatedIdx: index(
      "runtime_publishing_plan_revisions_workspace_plan_created_idx",
    ).on(
      table.workspaceId.asc(),
      table.planId.asc(),
      table.createdAt.desc(),
      table.id.desc(),
    ),
    workspaceAuthorIdx: index(
      "runtime_publishing_plan_revisions_workspace_author_idx",
    ).on(table.workspaceId, table.authorPrincipalId),
    authorKeyIdx: index(
      "runtime_publishing_plan_revisions_author_key_idx",
    ).on(table.authorPrincipalId, table.authorKeyId),
    creationAuthorizationEvidenceIdx: index(
      "runtime_publishing_plan_revisions_creation_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.authorPrincipalId,
      table.authorKeyId,
      table.creationAuthorizationEvidenceRef,
    ),
    revisionCheck: check(
      "runtime_publishing_plan_revisions_revision_check",
      sql`${table.revision} > 0`,
    ),
    identityCheck: check(
      "runtime_publishing_plan_revisions_identity_check",
      sql`length(${table.id}) between 1 and 200
        and ${table.id} ~ '^[A-Za-z0-9_-]+$'
        and length(${table.planId}) between 1 and 200
        and ${table.planId} ~ '^[A-Za-z0-9_-]+$'`,
    ),
    digestCheck: check(
      "runtime_publishing_plan_revisions_digest_check",
      sql`${table.definitionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    definitionCheck: check(
      "runtime_publishing_plan_revisions_definition_check",
      sql`jsonb_typeof(${table.definition}) = 'object'
        and ${table.definition} ?& array['schema','planId','channelIds','artifactIds','targets']
        and (${table.definition} - array['schema','planId','channelIds','artifactIds','targets']) = '{}'::jsonb
        and ${table.definition}->>'schema' = 'publishing-plan-revision-definition/v1'
        and ${table.definition}->>'planId' = ${table.planId}
        and jsonb_typeof(${table.definition}->'channelIds') = 'array'
        and jsonb_array_length(${table.definition}->'channelIds') between 1 and 50
        and jsonb_typeof(${table.definition}->'artifactIds') = 'array'
        and jsonb_array_length(${table.definition}->'artifactIds') between 1 and 200
        and jsonb_typeof(${table.definition}->'targets') = 'array'
        and jsonb_array_length(${table.definition}->'targets') between 1 and 50
        and octet_length(${table.definition}::text) <= 2097152`,
    ),
    validationEvidenceCheck: check(
      "runtime_publishing_plan_revisions_validation_evidence_check",
      sql`jsonb_typeof(${table.validationEvidence}) = 'object'
        and ${table.validationEvidence} ?& array['schema','submittedDraftDigest','definitionDigest','currentStateDigest','evaluatedAt','context','runtimePolicy','targets','authorizesExecution']
        and (${table.validationEvidence} - array['schema','submittedDraftDigest','definitionDigest','currentStateDigest','evaluatedAt','context','runtimePolicy','targets','authorizesExecution']) = '{}'::jsonb
        and ${table.validationEvidence}->>'schema' = 'publishing-plan-validation-evidence/v1'
        and ${table.validationEvidence}->>'submittedDraftDigest' ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidence}->>'definitionDigest' = ${table.definitionDigest}
        and ${table.validationEvidence}->>'currentStateDigest' ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidence}->'authorizesExecution' = 'false'::jsonb
        and jsonb_typeof(${table.validationEvidence}->'context') = 'object'
        and (${table.validationEvidence}->'context') ?& array['contextId','contextDigest','issuedAt','expiresAt','capability','keyId','authorizationEvidenceRef','authorizationContractDigest','resources']
        and ((${table.validationEvidence}->'context') - array['contextId','contextDigest','issuedAt','expiresAt','capability','keyId','authorizationEvidenceRef','authorizationContractDigest','resources']) = '{}'::jsonb
        and ${table.validationEvidence}->'context'->>'contextDigest' ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidence}->'context'->>'authorizationContractDigest' = 'sha256:542668629b3974c08f2262f4a23c6a8ca495b30361129d2e1c3677934d5a8378'
        and ${table.validationEvidence}->'context'->>'capability' = 'publishing_plan_revisions.create@1'
        and ${table.validationEvidence}->'context'->>'keyId' = ${table.authorKeyId}
        and ${table.validationEvidence}->'context'->>'authorizationEvidenceRef' = ${table.creationAuthorizationEvidenceRef}
        and jsonb_typeof(${table.validationEvidence}->'context'->'resources') = 'object'
        and (${table.validationEvidence}->'context'->'resources') ?& array['channelIds','artifactIds']
        and ((${table.validationEvidence}->'context'->'resources') - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof(${table.validationEvidence}->'context'->'resources'->'channelIds') = 'array'
        and jsonb_typeof(${table.validationEvidence}->'context'->'resources'->'artifactIds') = 'array'
        and (${table.validationEvidence}->'context'->>'expiresAt')::timestamptz > (${table.validationEvidence}->'context'->>'issuedAt')::timestamptz
        and (${table.validationEvidence}->>'evaluatedAt')::timestamptz >= (${table.validationEvidence}->'context'->>'issuedAt')::timestamptz
        and (${table.validationEvidence}->>'evaluatedAt')::timestamptz < (${table.validationEvidence}->'context'->>'expiresAt')::timestamptz
        and jsonb_typeof(${table.validationEvidence}->'runtimePolicy') = 'object'
        and (${table.validationEvidence}->'runtimePolicy') ?& array['identity','contractDigest']
        and ((${table.validationEvidence}->'runtimePolicy') - array['identity','contractDigest']) = '{}'::jsonb
        and ${table.validationEvidence}->'runtimePolicy'->>'contractDigest' ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof(${table.validationEvidence}->'targets') = 'array'
        and jsonb_array_length(${table.validationEvidence}->'targets') = jsonb_array_length(${table.definition}->'targets')
        and octet_length(${table.validationEvidence}::text) <= 2097152`,
    ),
    evidenceCheck: check(
      "runtime_publishing_plan_revisions_authorization_evidence_check",
      sql`length(${table.authorKeyId}) between 1 and 200
        and length(${table.creationAuthorizationEvidenceRef}) between 1 and 200`,
    ),
  }),
);

export const runtimePublishingPlanMutationReceipts = pgTable(
  "runtime_publishing_plan_mutation_receipts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    planId: text("plan_id").notNull(),
    revisionId: text("revision_id").notNull(),
    validationSessionId: text("validation_session_id").notNull(),
    validationSubmittedDraftDigest: text(
      "validation_submitted_draft_digest",
    ).notNull(),
    validationDefinitionDigest: text(
      "validation_definition_digest",
    ).notNull(),
    validationCurrentStateDigest: text(
      "validation_current_state_digest",
    ).notNull(),
    validationIssuedAt: timestamp("validation_issued_at", {
      withTimezone: true,
    }).notNull(),
    validationExpiresAt: timestamp("validation_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "runtime_publishing_plan_mutation_receipts_pk",
    }),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_plan_mutation_receipts_workspace_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_plan_mutation_receipts_key_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.keyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_plan_mutation_receipts_authorization_evidence_fk",
    }).onDelete("restrict"),
    revisionFk: foreignKey({
      columns: [table.workspaceId, table.planId, table.revisionId],
      foreignColumns: [
        runtimePublishingPlanRevisions.workspaceId,
        runtimePublishingPlanRevisions.planId,
        runtimePublishingPlanRevisions.id,
      ],
      name: "runtime_publishing_plan_mutation_receipts_revision_fk",
    }).onDelete("restrict"),
    keyIdx: index("runtime_publishing_plan_mutation_receipts_key_idx").on(
      table.principalId,
      table.keyId,
    ),
    authorizationEvidenceIdx: index(
      "runtime_publishing_plan_mutation_receipts_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.principalId,
      table.keyId,
      table.authorizationEvidenceRef,
    ),
    revisionIdx: index(
      "runtime_publishing_plan_mutation_receipts_revision_idx",
    ).on(table.workspaceId, table.planId, table.revisionId),
    validationSessionUnique: uniqueIndex(
      "runtime_publishing_plan_mutation_receipts_validation_session_unique",
    ).on(table.workspaceId, table.validationSessionId),
    workspaceCreatedIdx: index(
      "runtime_publishing_plan_mutation_receipts_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt, table.idempotencyKey),
    capabilityCheck: check(
      "runtime_publishing_plan_mutation_receipts_capability_check",
      sql`${table.capability} = 'publishing_plan_revisions.create@1'`,
    ),
    idempotencyKeyCheck: check(
      "runtime_publishing_plan_mutation_receipts_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 8 and 200 and ${table.idempotencyKey} ~ '^[!-~]+$'`,
    ),
    fingerprintCheck: check(
      "runtime_publishing_plan_mutation_receipts_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    validationSessionCheck: check(
      "runtime_publishing_plan_mutation_receipts_validation_session_check",
      sql`length(${table.validationSessionId}) between 1 and 200
        and ${table.validationSessionId} ~ '^ppvs_[A-Za-z0-9_-]+$'
        and ${table.validationSubmittedDraftDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationDefinitionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationCurrentStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationExpiresAt} > ${table.validationIssuedAt}`,
    ),
    evidenceCheck: check(
      "runtime_publishing_plan_mutation_receipts_evidence_check",
      sql`length(${table.keyId}) between 1 and 200
        and length(${table.authorizationEvidenceRef}) between 1 and 200`,
    ),
  }),
);

/**
 * Human publishing authority is explicit, Channel-scoped, and append-only.
 * Workspace roles may administer grants, but never satisfy an Approval check.
 * Revocation is recorded separately so the original grant remains immutable.
 */
export const runtimePublishingApprovalAuthorityGrants = pgTable(
  "runtime_publishing_approval_authority_grants",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    subjectRoleAtIssue: text("subject_role_at_issue").notNull(),
    channelId: text("channel_id").notNull(),
    action: text("action").notNull(),
    issuedByUserId: text("issued_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_approval_authority_grants_pk",
    }),
    subjectScopeIdx: index(
      "runtime_publishing_approval_authority_grants_subject_scope_idx",
    ).on(
      table.workspaceId,
      table.userId,
      table.action,
      table.channelId,
      table.expiresAt,
      table.id,
    ),
    subjectUserIdx: index(
      "runtime_publishing_approval_authority_grants_subject_user_idx",
    ).on(table.userId),
    issuerIdx: index(
      "runtime_publishing_approval_authority_grants_issuer_idx",
    ).on(table.issuedByUserId),
    channelIdx: index(
      "runtime_publishing_approval_authority_grants_channel_idx",
    ).on(table.workspaceId, table.channelId),
    identityCheck: check(
      "runtime_publishing_approval_authority_grants_identity_check",
      sql`length(${table.id}) between 1 and 200
        and ${table.id} ~ '^paag_[A-Za-z0-9_-]+$'`,
    ),
    actionCheck: check(
      "runtime_publishing_approval_authority_grants_action_check",
      sql`${table.action} = 'publish'
        and ${table.subjectRoleAtIssue} in ('owner','admin','member')`,
    ),
    expiryCheck: check(
      "runtime_publishing_approval_authority_grants_expiry_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.issuedAt}`,
    ),
  }),
);

export const runtimePublishingApprovalAuthorityRevocations = pgTable(
  "runtime_publishing_approval_authority_revocations",
  {
    workspaceId: text("workspace_id").notNull(),
    grantId: text("grant_id").notNull(),
    revokedByUserId: text("revoked_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.grantId],
      name: "runtime_publishing_approval_authority_revocations_pk",
    }),
    grantFk: foreignKey({
      columns: [table.workspaceId, table.grantId],
      foreignColumns: [
        runtimePublishingApprovalAuthorityGrants.workspaceId,
        runtimePublishingApprovalAuthorityGrants.id,
      ],
      name: "runtime_publishing_approval_authority_revocations_grant_fk",
    }).onDelete("restrict"),
    revokerIdx: index(
      "runtime_publishing_approval_authority_revocations_revoker_idx",
    ).on(table.revokedByUserId),
  }),
);

export const runtimePublishingApprovalAuthorityMutationReceipts = pgTable(
  "runtime_publishing_approval_authority_mutation_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    grantId: text("grant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.actorUserId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "runtime_publishing_approval_authority_mutation_receipts_pk",
    }),
    grantFk: foreignKey({
      columns: [table.workspaceId, table.grantId],
      foreignColumns: [
        runtimePublishingApprovalAuthorityGrants.workspaceId,
        runtimePublishingApprovalAuthorityGrants.id,
      ],
      name: "runtime_publishing_approval_authority_mutation_receipts_grant_fk",
    }).onDelete("restrict"),
    actorIdx: index(
      "runtime_publishing_approval_authority_mutation_receipts_actor_idx",
    ).on(table.actorUserId),
    grantIdx: index(
      "runtime_publishing_approval_authority_mutation_receipts_grant_idx",
    ).on(table.workspaceId, table.grantId),
    capabilityCheck: check(
      "runtime_publishing_approval_authority_mutation_receipts_capability_check",
      sql`${table.capability} in (
        'publishing_approval_authority.issue@1',
        'publishing_approval_authority.revoke@1'
      )`,
    ),
    idempotencyCheck: check(
      "runtime_publishing_approval_authority_mutation_receipts_idempotency_check",
      sql`length(${table.idempotencyKey}) between 8 and 200
        and ${table.idempotencyKey} ~ '^[!-~]+$'
        and ${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
  }),
);

/**
 * An Approval request is an immutable envelope around one exact Plan Revision,
 * action, target set, validation snapshot, and requesting Agent authorization.
 * Its visible state is projected from expiry and the optional final decision.
 */
export const runtimePublishingApprovalRequests = pgTable(
  "runtime_publishing_approval_requests",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    planId: text("plan_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    planRevisionDigest: text("plan_revision_digest").notNull(),
    action: text("action").notNull(),
    targetIds: jsonb("target_ids").$type<string[]>().notNull(),
    targetSetDigest: text("target_set_digest").notNull(),
    channelIds: jsonb("channel_ids").$type<string[]>().notNull(),
    artifactIds: jsonb("artifact_ids").$type<string[]>().notNull(),
    retrySourceDeliveryId: text("retry_source_delivery_id"),
    retrySourceEvidenceDigest: text("retry_source_evidence_digest"),
    requestingPrincipalId: text("requesting_principal_id").notNull(),
    requestingKeyId: text("requesting_key_id").notNull(),
    requestAuthorizationCapability: text(
      "request_authorization_capability",
    ).notNull(),
    requestAuthorizationContractDigest: text(
      "request_authorization_contract_digest",
    ).notNull(),
    requestAuthorizationEvidenceRef: text(
      "request_authorization_evidence_ref",
    ).notNull(),
    validationEvidenceDigest: text("validation_evidence_digest").notNull(),
    validationCurrentStateDigest: text(
      "validation_current_state_digest",
    ).notNull(),
    validationContextId: text("validation_context_id").notNull(),
    validationContextDigest: text("validation_context_digest").notNull(),
    validationEvaluatedAt: timestamp("validation_evaluated_at", {
      withTimezone: true,
    }).notNull(),
    validationExpiresAt: timestamp("validation_expires_at", {
      withTimezone: true,
    }).notNull(),
    validationRuntimePolicyIdentity: text(
      "validation_runtime_policy_identity",
    ).notNull(),
    validationRuntimePolicyContractDigest: text(
      "validation_runtime_policy_contract_digest",
    ).notNull(),
    governancePolicy: jsonb("governance_policy")
      .$type<PublishingApprovalGovernanceBinding>(),
    decisionPolicyMode: text("decision_policy_mode").notNull(),
    decisionPolicyExpiresAt: timestamp("decision_policy_expires_at", {
      withTimezone: true,
    }).notNull(),
    authorizesExecution: boolean("authorizes_execution")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_approval_requests_pk",
    }),
    revisionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.planId,
        table.planRevisionId,
        table.planRevision,
        table.planRevisionDigest,
        table.validationEvidenceDigest,
      ],
      foreignColumns: [
        runtimePublishingPlanRevisions.workspaceId,
        runtimePublishingPlanRevisions.planId,
        runtimePublishingPlanRevisions.id,
        runtimePublishingPlanRevisions.revision,
        runtimePublishingPlanRevisions.definitionDigest,
        runtimePublishingPlanRevisions.validationEvidenceDigest,
      ],
      name: "runtime_publishing_approval_requests_revision_fk",
    }).onDelete("restrict"),
    requesterFk: foreignKey({
      columns: [table.workspaceId, table.requestingPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_approval_requests_requester_fk",
    }).onDelete("restrict"),
    requesterKeyFk: foreignKey({
      columns: [table.requestingPrincipalId, table.requestingKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_approval_requests_requester_key_fk",
    }).onDelete("restrict"),
    requestAuthorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.requestingPrincipalId,
        table.requestingKeyId,
        table.requestAuthorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_approval_requests_authorization_evidence_fk",
    }).onDelete("restrict"),
    // The nullable composite retry-source FK is installed in migration 0050.
    // It cannot be represented here without creating an initialization cycle:
    // Deliveries already have immutable composite FKs back to Approvals.
    revisionIdx: index(
      "runtime_publishing_approval_requests_revision_idx",
    ).on(
      table.workspaceId,
      table.planId,
      table.planRevisionId,
      table.planRevision,
      table.planRevisionDigest,
      table.validationEvidenceDigest,
    ),
    requesterIdx: index(
      "runtime_publishing_approval_requests_requester_idx",
    ).on(table.workspaceId, table.requestingPrincipalId),
    requesterKeyIdx: index(
      "runtime_publishing_approval_requests_requester_key_idx",
    ).on(table.requestingPrincipalId, table.requestingKeyId),
    authorizationEvidenceIdx: index(
      "runtime_publishing_approval_requests_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.requestingPrincipalId,
      table.requestingKeyId,
      table.requestAuthorizationEvidenceRef,
    ),
    workspaceCreatedIdx: index(
      "runtime_publishing_approval_requests_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt.desc(), table.id.desc()),
    workspaceStateExpiryIdx: index(
      "runtime_publishing_approval_requests_workspace_expiry_idx",
    ).on(table.workspaceId, table.decisionPolicyExpiresAt, table.id),
    notificationCursorIdx: index(
      "runtime_publishing_approval_requests_notification_cursor_idx",
    ).on(table.createdAt, table.id),
    retrySourceIdx: index(
      "runtime_publishing_approval_requests_retry_source_idx",
    ).on(table.workspaceId, table.retrySourceDeliveryId,
      table.retrySourceEvidenceDigest),
    identityCheck: check(
      "runtime_publishing_approval_requests_identity_check",
      sql`length(${table.id}) between 1 and 200
        and ${table.id} ~ '^par_[A-Za-z0-9_-]+$'
        and ${table.planRevision} > 0`,
    ),
    actionCheck: check(
      "runtime_publishing_approval_requests_action_check",
      sql`${table.action} = 'publish'`,
    ),
    digestCheck: check(
      "runtime_publishing_approval_requests_digest_check",
      sql`${table.planRevisionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.targetSetDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.requestAuthorizationContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationCurrentStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationContextDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationRuntimePolicyContractDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    retrySourceCheck: check(
      "runtime_publishing_approval_requests_retry_source_check",
      sql`((${table.retrySourceDeliveryId} is null and ${table.retrySourceEvidenceDigest} is null)
        or (${table.retrySourceDeliveryId} is not null
          and length(${table.retrySourceDeliveryId}) between 1 and 200
          and ${table.retrySourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'))`,
    ),
    targetSetCheck: check(
      "runtime_publishing_approval_requests_target_set_check",
      sql`jsonb_typeof(${table.targetIds}) = 'array'
        and jsonb_array_length(${table.targetIds}) between 1 and 50
        and octet_length(${table.targetIds}::text) <= 16384
        and jsonb_typeof(${table.channelIds}) = 'array'
        and jsonb_array_length(${table.channelIds}) between 1 and 50
        and octet_length(${table.channelIds}::text) <= 16384
        and jsonb_typeof(${table.artifactIds}) = 'array'
        and jsonb_array_length(${table.artifactIds}) between 1 and 200
        and octet_length(${table.artifactIds}::text) <= 65536`,
    ),
    validationCheck: check(
      "runtime_publishing_approval_requests_validation_check",
      sql`length(${table.validationContextId}) between 1 and 200
        and ${table.validationRuntimePolicyIdentity} = 'publishing-runtime-policy/default@1'
        and ${table.validationRuntimePolicyContractDigest} = 'sha256:c372d0a34f6b1ca086ef4cad760db2bbffab1ac5c668fede7f256106305b7cf1'
        and ${table.validationExpiresAt} > ${table.validationEvaluatedAt}`,
    ),
    governancePolicyCheck: check(
      "runtime_publishing_approval_requests_governance_policy_check",
      sql`${table.governancePolicy} is null or (
        ${table.governancePolicy}->>'schema' = 'publishing-approval-governance-binding/v1'
        and (${table.governancePolicy}->>'policyRevision')::integer > 0
        and ${table.governancePolicy}->>'policyDigest' ~ '^sha256:[a-f0-9]{64}$'
        and length(${table.governancePolicy}->>'governanceRequestId') between 1 and 200
        and length(${table.governancePolicy}->>'policyId') between 1 and 200
      )`,
    ),
    requestAuthorizationCheck: check(
      "runtime_publishing_approval_requests_request_authorization_check",
      sql`${table.requestAuthorizationCapability} = 'publishing_approvals.request@1'
        and ${table.requestAuthorizationContractDigest} = 'sha256:9d46d813238045c0ba3924966834418c9f508741890f3aa81c5a494227e42892'
        and length(${table.requestAuthorizationEvidenceRef}) between 1 and 200`,
    ),
    decisionPolicyCheck: check(
      "runtime_publishing_approval_requests_decision_policy_check",
      sql`${table.decisionPolicyMode} = 'expires_at'
        and ${table.decisionPolicyExpiresAt} > ${table.createdAt}
        and ${table.decisionPolicyExpiresAt} <= ${table.validationExpiresAt}`,
    ),
    noExecutionAuthorityCheck: check(
      "runtime_publishing_approval_requests_no_execution_authority_check",
      sql`${table.authorizesExecution} = false`,
    ),
  }),
);

export const runtimePublishingApprovalDecisions = pgTable(
  "runtime_publishing_approval_decisions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    requestId: text("request_id").notNull(),
    outcome: text("outcome").notNull(),
    decidedByUserId: text("decided_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    authorityEvidenceRef: text("authority_evidence_ref").notNull(),
    authorityEvidenceDigest: text("authority_evidence_digest").notNull(),
    authorityGrants: jsonb("authority_grants")
      .$type<Array<{ channelId: string; grantId: string }>>()
      .notNull(),
    inspectionDigest: text("inspection_digest").notNull(),
    authorizesExecution: boolean("authorizes_execution")
      .default(false)
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_approval_decisions_pk",
    }),
    requestUnique: uniqueIndex(
      "runtime_publishing_approval_decisions_request_unique",
    ).on(table.workspaceId, table.requestId),
    requestDecisionIdentityUnique: uniqueIndex(
      "runtime_publishing_approval_decisions_request_identity_unique",
    ).on(table.workspaceId, table.requestId, table.id),
    requestFk: foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [
        runtimePublishingApprovalRequests.workspaceId,
        runtimePublishingApprovalRequests.id,
      ],
      name: "runtime_publishing_approval_decisions_request_fk",
    }).onDelete("restrict"),
    deciderIdx: index(
      "runtime_publishing_approval_decisions_decider_idx",
    ).on(table.decidedByUserId),
    workspaceDecidedIdx: index(
      "runtime_publishing_approval_decisions_workspace_decided_idx",
    ).on(table.workspaceId, table.decidedAt.desc(), table.id.desc()),
    notificationCursorIdx: index(
      "runtime_publishing_approval_decisions_notification_cursor_idx",
    ).on(table.decidedAt, table.id),
    identityCheck: check(
      "runtime_publishing_approval_decisions_identity_check",
      sql`length(${table.id}) between 1 and 200
        and ${table.id} ~ '^pad_[A-Za-z0-9_-]+$'
        and length(${table.authorityEvidenceRef}) between 1 and 200`,
    ),
    outcomeCheck: check(
      "runtime_publishing_approval_decisions_outcome_check",
      sql`${table.outcome} in ('approved','denied')`,
    ),
    authorityCheck: check(
      "runtime_publishing_approval_decisions_authority_check",
      sql`${table.authorityEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.inspectionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof(${table.authorityGrants}) = 'array'
        and jsonb_array_length(${table.authorityGrants}) between 1 and 50
        and octet_length(${table.authorityGrants}::text) <= 16384`,
    ),
    noExecutionAuthorityCheck: check(
      "runtime_publishing_approval_decisions_no_execution_authority_check",
      sql`${table.authorizesExecution} = false`,
    ),
  }),
);

export const runtimePublishingApprovalMutationReceipts = pgTable(
  "runtime_publishing_approval_mutation_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    principalId: text("principal_id"),
    keyId: text("key_id"),
    authorizationEvidenceRef: text("authorization_evidence_ref"),
    userId: text("user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    approvalRequestId: text("approval_request_id").notNull(),
    decisionId: text("decision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.actorKind,
        table.actorId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "runtime_publishing_approval_mutation_receipts_pk",
    }),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_approval_mutation_receipts_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_approval_mutation_receipts_key_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.keyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_approval_mutation_receipts_authorization_evidence_fk",
    }).onDelete("restrict"),
    approvalRequestFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId],
      foreignColumns: [
        runtimePublishingApprovalRequests.workspaceId,
        runtimePublishingApprovalRequests.id,
      ],
      name: "runtime_publishing_approval_mutation_receipts_request_fk",
    }).onDelete("restrict"),
    decisionFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId, table.decisionId],
      foreignColumns: [
        runtimePublishingApprovalDecisions.workspaceId,
        runtimePublishingApprovalDecisions.requestId,
        runtimePublishingApprovalDecisions.id,
      ],
      name: "runtime_publishing_approval_mutation_receipts_decision_fk",
    }).onDelete("restrict"),
    principalIdx: index(
      "runtime_publishing_approval_mutation_receipts_principal_idx",
    ).on(table.workspaceId, table.principalId),
    keyIdx: index("runtime_publishing_approval_mutation_receipts_key_idx").on(
      table.principalId,
      table.keyId,
    ),
    authorizationEvidenceIdx: index(
      "runtime_publishing_approval_mutation_receipts_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.principalId,
      table.keyId,
      table.authorizationEvidenceRef,
    ),
    userIdx: index("runtime_publishing_approval_mutation_receipts_user_idx").on(
      table.userId,
    ),
    requestIdx: index(
      "runtime_publishing_approval_mutation_receipts_request_idx",
    ).on(table.workspaceId, table.approvalRequestId),
    decisionIdx: index(
      "runtime_publishing_approval_mutation_receipts_decision_idx",
    ).on(table.workspaceId, table.approvalRequestId, table.decisionId),
    actorCheck: check(
      "runtime_publishing_approval_mutation_receipts_actor_check",
      sql`(${table.actorKind} = 'agent'
          and ${table.actorId} = ${table.principalId}
          and ${table.principalId} is not null
          and ${table.keyId} is not null
          and ${table.authorizationEvidenceRef} is not null
          and ${table.userId} is null)
        or (${table.actorKind} = 'human'
          and ${table.actorId} = ${table.userId}
          and ${table.userId} is not null
          and ${table.principalId} is null
          and ${table.keyId} is null
          and ${table.authorizationEvidenceRef} is null)`,
    ),
    capabilityCheck: check(
      "runtime_publishing_approval_mutation_receipts_capability_check",
      sql`${table.capability} in (
          'publishing_approvals.request@1',
          'publishing_approvals.decide@1'
        )`,
    ),
    idempotencyKeyCheck: check(
      "runtime_publishing_approval_mutation_receipts_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 8 and 200
        and ${table.idempotencyKey} ~ '^[!-~]+$'`,
    ),
    digestCheck: check(
      "runtime_publishing_approval_mutation_receipts_digest_check",
      sql`${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    resultCheck: check(
      "runtime_publishing_approval_mutation_receipts_result_check",
      sql`length(${table.approvalRequestId}) between 1 and 200
        and (${table.decisionId} is null or length(${table.decisionId}) between 1 and 200)
        and ((${table.capability} = 'publishing_approvals.request@1' and ${table.decisionId} is null)
          or (${table.capability} = 'publishing_approvals.decide@1' and ${table.decisionId} is not null))`,
    ),
  }),
);

/**
 * Approval consumption is separate from the human decision. The independent
 * release authorization is retained and one decision can be consumed once.
 */
export const runtimePublishingApprovalConsumptions = pgTable(
  "runtime_publishing_approval_consumptions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    decisionId: text("decision_id").notNull(),
    consumingPrincipalId: text("consuming_principal_id").notNull(),
    consumingKeyId: text("consuming_key_id").notNull(),
    capability: text("capability").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    authorizationIssuedAt: timestamp("authorization_issued_at", {
      withTimezone: true,
    }).notNull(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_approval_consumptions_pk",
    }),
    decisionUnique: uniqueIndex(
      "runtime_publishing_approval_consumptions_decision_unique",
    ).on(table.workspaceId, table.decisionId),
    releaseIdentityUnique: uniqueIndex(
      "runtime_publishing_approval_consumptions_release_identity_unique",
    ).on(
      table.workspaceId,
      table.approvalRequestId,
      table.decisionId,
      table.id,
    ),
    requestFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId],
      foreignColumns: [
        runtimePublishingApprovalRequests.workspaceId,
        runtimePublishingApprovalRequests.id,
      ],
      name: "runtime_publishing_approval_consumptions_request_fk",
    }).onDelete("restrict"),
    decisionFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId, table.decisionId],
      foreignColumns: [
        runtimePublishingApprovalDecisions.workspaceId,
        runtimePublishingApprovalDecisions.requestId,
        runtimePublishingApprovalDecisions.id,
      ],
      name: "runtime_publishing_approval_consumptions_decision_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.consumingPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_approval_consumptions_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.consumingPrincipalId, table.consumingKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_approval_consumptions_key_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.consumingPrincipalId,
        table.consumingKeyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_approval_consumptions_authorization_evidence_fk",
    }).onDelete("restrict"),
    requestIdx: index(
      "runtime_publishing_approval_consumptions_request_idx",
    ).on(table.workspaceId, table.approvalRequestId),
    decisionBindingIdx: index(
      "runtime_publishing_approval_consumptions_decision_binding_idx",
    ).on(table.workspaceId, table.approvalRequestId, table.decisionId),
    principalIdx: index(
      "runtime_publishing_approval_consumptions_principal_idx",
    ).on(table.workspaceId, table.consumingPrincipalId),
    keyIdx: index("runtime_publishing_approval_consumptions_key_idx").on(
      table.consumingPrincipalId,
      table.consumingKeyId,
    ),
    authorizationEvidenceIdx: index(
      "runtime_publishing_approval_consumptions_authorization_evidence_idx",
    ).on(
      table.workspaceId,
      table.consumingPrincipalId,
      table.consumingKeyId,
      table.authorizationEvidenceRef,
    ),
    identityCheck: check(
      "runtime_publishing_approval_consumptions_identity_check",
      sql`length(${table.id}) between 1 and 200
        and ${table.id} ~ '^pac_[A-Za-z0-9_-]+$'`,
    ),
    authorizationCheck: check(
      "runtime_publishing_approval_consumptions_authorization_check",
      sql`${table.capability} = 'publishing_plan_revisions.release@1'
        and ${table.authorizationContractDigest} = 'sha256:487fcf4d881ef927ada89e11c1851b402bf414c1083c8d6618644d503aa1e80e'
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and ${table.authorizedResources} ?& array['channelIds','artifactIds']
        and (${table.authorizedResources} - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof(${table.authorizedResources}->'channelIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'channelIds') between 1 and 50
        and jsonb_typeof(${table.authorizedResources}->'artifactIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'artifactIds') between 1 and 200
        and ${table.authorizationExpiresAt} > ${table.authorizationIssuedAt}
        and ${table.consumedAt} >= ${table.authorizationIssuedAt}
        and ${table.consumedAt} < ${table.authorizationExpiresAt}`,
    ),
  }),
);

/**
 * One immutable release consumes one exact approved decision. The accepted
 * Delivery projection is retained here so an idempotent replay never derives
 * acceptance from mutable Delivery state.
 */
export const runtimePublishingDeliveryReleases = pgTable(
  "runtime_publishing_delivery_releases",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    planId: text("plan_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    planRevisionDigest: text("plan_revision_digest").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    approvalDecisionId: text("approval_decision_id").notNull(),
    approvalConsumptionId: text("approval_consumption_id").notNull(),
    consumingPrincipalId: text("consuming_principal_id").notNull(),
    consumingKeyId: text("consuming_key_id").notNull(),
    capability: text("capability").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    authorizationIssuedAt: timestamp("authorization_issued_at", {
      withTimezone: true,
    }).notNull(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    validationSessionId: text("validation_session_id").notNull(),
    validationEvidenceDigest: text("validation_evidence_digest").notNull(),
    validationCurrentStateDigest: text(
      "validation_current_state_digest",
    ).notNull(),
    acceptedDeliveries: jsonb("accepted_deliveries")
      .$type<PublishingDeliveryAcceptedRef[]>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_releases_pk",
    }),
    decisionUnique: uniqueIndex(
      "runtime_publishing_delivery_releases_decision_unique",
    ).on(table.workspaceId, table.approvalDecisionId),
    exactIdentityUnique: uniqueIndex(
      "runtime_publishing_delivery_releases_exact_identity_unique",
    ).on(
      table.workspaceId,
      table.id,
      table.planId,
      table.planRevisionId,
      table.planRevision,
      table.planRevisionDigest,
      table.validationEvidenceDigest,
      table.approvalRequestId,
      table.approvalDecisionId,
    ),
    revisionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.planId,
        table.planRevisionId,
        table.planRevision,
        table.planRevisionDigest,
        table.validationEvidenceDigest,
      ],
      foreignColumns: [
        runtimePublishingPlanRevisions.workspaceId,
        runtimePublishingPlanRevisions.planId,
        runtimePublishingPlanRevisions.id,
        runtimePublishingPlanRevisions.revision,
        runtimePublishingPlanRevisions.definitionDigest,
        runtimePublishingPlanRevisions.validationEvidenceDigest,
      ],
      name: "runtime_publishing_delivery_releases_revision_fk",
    }).onDelete("restrict"),
    approvalFk: foreignKey({
      columns: [
        table.workspaceId,
        table.approvalRequestId,
        table.approvalDecisionId,
      ],
      foreignColumns: [
        runtimePublishingApprovalDecisions.workspaceId,
        runtimePublishingApprovalDecisions.requestId,
        runtimePublishingApprovalDecisions.id,
      ],
      name: "runtime_publishing_delivery_releases_approval_fk",
    }).onDelete("restrict"),
    consumptionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.approvalRequestId,
        table.approvalDecisionId,
        table.approvalConsumptionId,
      ],
      foreignColumns: [
        runtimePublishingApprovalConsumptions.workspaceId,
        runtimePublishingApprovalConsumptions.approvalRequestId,
        runtimePublishingApprovalConsumptions.decisionId,
        runtimePublishingApprovalConsumptions.id,
      ],
      name: "runtime_publishing_delivery_releases_consumption_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.consumingPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_releases_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.consumingPrincipalId, table.consumingKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_releases_key_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.consumingPrincipalId,
        table.consumingKeyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_delivery_releases_authorization_evidence_fk",
    }).onDelete("restrict"),
    principalCreatedIdx: index(
      "runtime_publishing_delivery_releases_principal_created_idx",
    ).on(table.workspaceId, table.consumingPrincipalId, table.createdAt, table.id),
    revisionIdx: index(
      "runtime_publishing_delivery_releases_revision_idx",
    ).on(table.workspaceId, table.planRevisionId, table.createdAt, table.id),
    consumptionIdx: index(
      "runtime_publishing_delivery_releases_consumption_idx",
    ).on(
      table.workspaceId,
      table.approvalRequestId,
      table.approvalDecisionId,
      table.approvalConsumptionId,
    ),
    identityCheck: check(
      "runtime_publishing_delivery_releases_identity_check",
      sql`${table.id} ~ '^pdr_[A-Za-z0-9_-]+$'
        and length(${table.id}) between 1 and 200
        and ${table.planRevision} > 0`,
    ),
    authorizationCheck: check(
      "runtime_publishing_delivery_releases_authorization_check",
      sql`${table.capability} = 'publishing_plan_revisions.release@1'
        and ${table.authorizationContractDigest} = 'sha256:487fcf4d881ef927ada89e11c1851b402bf414c1083c8d6618644d503aa1e80e'
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and ${table.authorizedResources} ?& array['channelIds','artifactIds']
        and (${table.authorizedResources} - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof(${table.authorizedResources}->'channelIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'channelIds') between 1 and 50
        and jsonb_typeof(${table.authorizedResources}->'artifactIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'artifactIds') between 1 and 200
        and ${table.authorizationExpiresAt} > ${table.authorizationIssuedAt}
        and ${table.createdAt} >= ${table.authorizationIssuedAt}
        and ${table.createdAt} < ${table.authorizationExpiresAt}`,
    ),
    validationCheck: check(
      "runtime_publishing_delivery_releases_validation_check",
      sql`${table.planRevisionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationCurrentStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationSessionId} ~ '^pavs_[A-Za-z0-9_-]+$'
        and jsonb_typeof(${table.acceptedDeliveries}) = 'array'
        and jsonb_array_length(${table.acceptedDeliveries}) between 1 and 50
        and octet_length(${table.acceptedDeliveries}::text) <= 262144`,
    ),
  }),
);

/** Scoped release replay authority. The immutable Release owns the result. */
export const runtimePublishingDeliveryReleaseReceipts = pgTable(
  "runtime_publishing_delivery_release_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    releaseId: text("release_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "runtime_publishing_delivery_release_receipts_pk",
    }),
    releaseFk: foreignKey({
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [
        runtimePublishingDeliveryReleases.workspaceId,
        runtimePublishingDeliveryReleases.id,
      ],
      name: "runtime_publishing_delivery_release_receipts_release_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_release_receipts_principal_fk",
    }).onDelete("restrict"),
    releaseUnique: uniqueIndex(
      "runtime_publishing_delivery_release_receipts_release_unique",
    ).on(table.workspaceId, table.releaseId),
    createdIdx: index(
      "runtime_publishing_delivery_release_receipts_created_idx",
    ).on(table.workspaceId, table.createdAt, table.releaseId),
    contractCheck: check(
      "runtime_publishing_delivery_release_receipts_contract_check",
      sql`${table.capability} = 'publishing_plan_revisions.release@1'
        and length(${table.idempotencyKey}) between 8 and 200
        and ${table.idempotencyKey} ~ '^[!-~]+$'
        and ${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
  }),
);

/** Stable per-target delivery with immutable intent identity and mutable state. */
export const runtimePublishingDeliveries = pgTable(
  "runtime_publishing_deliveries",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    releaseId: text("release_id"),
    sourceDeliveryId: text("source_delivery_id"),
    retryId: text("retry_id"),
    planId: text("plan_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    planRevisionDigest: text("plan_revision_digest").notNull(),
    validationEvidenceDigest: text("validation_evidence_digest").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    approvalDecisionId: text("approval_decision_id").notNull(),
    requestingPrincipalId: text("requesting_principal_id").notNull(),
    requestingKeyId: text("requesting_key_id").notNull(),
    targetOrdinal: integer("target_ordinal").notNull(),
    targetId: text("target_id").notNull(),
    channelId: text("channel_id").notNull(),
    artifactIds: jsonb("artifact_ids").$type<string[]>().notNull(),
    targetSnapshot: jsonb("target_snapshot")
      .$type<PublishingDeliveryTargetSnapshot>()
      .notNull(),
    targetSnapshotDigest: text("target_snapshot_digest").notNull(),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    desiredState: text("desired_state").notNull(),
    state: text("state").notNull(),
    effectKey: text("effect_key").notNull(),
    /** Monotonic identity generation; changes only after proved known failure. */
    effectGeneration: integer("effect_generation").default(1).notNull(),
    intentDigest: text("intent_digest"),
    providerAdapterContractDigest: text("provider_adapter_contract_digest"),
    providerOperationRef: text("provider_operation_ref"),
    latestEffectEvidenceDigest: text("latest_effect_evidence_digest"),
    failureCode: text("failure_code"),
    failureClass: text("failure_class"),
    failureRetryable: boolean("failure_retryable"),
    failureEffectDisposition: text("failure_effect_disposition"),
    readinessBlockCode: text("readiness_block_code"),
    readinessEvidenceDigest: text("readiness_evidence_digest"),
    readinessBlockedAt: timestamp("readiness_blocked_at", { withTimezone: true }),
    readinessRetryAt: timestamp("readiness_retry_at", { withTimezone: true }),
    readinessBlockCount: integer("readiness_block_count").default(0).notNull(),
    nextEffectAttempt: integer("next_effect_attempt").default(1).notNull(),
    confirmationAttempts: integer("confirmation_attempts").default(0).notNull(),
    nextEventSequence: integer("next_event_sequence").notNull(),
    nextOutboxGeneration: integer("next_outbox_generation").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    dispatchStartedAt: timestamp("dispatch_started_at", {
      withTimezone: true,
    }),
    /**
     * Conservative durable boundary immediately before first provider contact.
     * A cancellation committed before this value is set proves prevention.
     */
    effectContactStartedAt: timestamp("effect_contact_started_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_deliveries_pk",
    }),
    releaseTargetUnique: uniqueIndex(
      "runtime_publishing_deliveries_release_target_unique",
    ).on(table.workspaceId, table.releaseId, table.targetId),
    releaseOrdinalUnique: uniqueIndex(
      "runtime_publishing_deliveries_release_ordinal_unique",
    ).on(table.workspaceId, table.releaseId, table.targetOrdinal),
    effectKeyUnique: uniqueIndex(
      "runtime_publishing_deliveries_effect_key_unique",
    ).on(table.workspaceId, table.effectKey),
    releaseFk: foreignKey({
      columns: [
        table.workspaceId,
        table.releaseId,
        table.planId,
        table.planRevisionId,
        table.planRevision,
        table.planRevisionDigest,
        table.validationEvidenceDigest,
        table.approvalRequestId,
        table.approvalDecisionId,
      ],
      foreignColumns: [
        runtimePublishingDeliveryReleases.workspaceId,
        runtimePublishingDeliveryReleases.id,
        runtimePublishingDeliveryReleases.planId,
        runtimePublishingDeliveryReleases.planRevisionId,
        runtimePublishingDeliveryReleases.planRevision,
        runtimePublishingDeliveryReleases.planRevisionDigest,
        runtimePublishingDeliveryReleases.validationEvidenceDigest,
        runtimePublishingDeliveryReleases.approvalRequestId,
        runtimePublishingDeliveryReleases.approvalDecisionId,
      ],
      name: "runtime_publishing_deliveries_release_fk",
    }).onDelete("restrict"),
    sourceDeliveryFk: foreignKey({
      columns: [table.workspaceId, table.sourceDeliveryId],
      foreignColumns: [table.workspaceId, table.id],
      name: "runtime_publishing_deliveries_source_delivery_fk",
    }).onDelete("restrict"),
    requestingPrincipalFk: foreignKey({
      columns: [table.workspaceId, table.requestingPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_deliveries_requesting_principal_fk",
    }).onDelete("restrict"),
    requestingKeyFk: foreignKey({
      columns: [table.requestingPrincipalId, table.requestingKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_deliveries_requesting_key_fk",
    }).onDelete("restrict"),
    retryOriginUnique: uniqueIndex(
      "runtime_publishing_deliveries_retry_origin_unique",
    ).on(table.workspaceId, table.retryId),
    sourceDeliveryIdx: index("runtime_publishing_deliveries_source_delivery_idx")
      .on(table.workspaceId, table.sourceDeliveryId),
    requestingPrincipalIdx: index(
      "runtime_publishing_deliveries_requesting_principal_idx",
    ).on(table.workspaceId, table.requestingPrincipalId),
    requestingKeyIdx: index("runtime_publishing_deliveries_requesting_key_idx")
      .on(table.requestingPrincipalId, table.requestingKeyId),
    releaseIdx: index("runtime_publishing_deliveries_release_idx").on(
      table.workspaceId,
      table.releaseId,
      table.acceptedAt,
      table.id,
    ),
    workspaceAcceptedIdx: index(
      "runtime_publishing_deliveries_workspace_accepted_idx",
    ).on(table.workspaceId, table.acceptedAt, table.id),
    revisionAcceptedIdx: index(
      "runtime_publishing_deliveries_revision_accepted_idx",
    ).on(table.workspaceId, table.planRevisionId, table.acceptedAt, table.id),
    stateDueIdx: index("runtime_publishing_deliveries_state_due_idx").on(
      table.state,
      table.publishAt,
      table.updatedAt,
      table.id,
    ),
    readinessDueIdx: index("runtime_publishing_deliveries_readiness_due_idx").on(
      table.state,
      table.readinessRetryAt,
      table.id,
    ),
    channelIdx: index("runtime_publishing_deliveries_channel_idx").on(
      table.workspaceId,
      table.channelId,
      table.acceptedAt,
      table.id,
    ),
    identityCheck: check(
      "runtime_publishing_deliveries_identity_check",
      sql`${table.id} ~ '^pdl_[A-Za-z0-9_-]+$'
        and length(${table.id}) between 1 and 200
        and length(${table.targetId}) between 1 and 200
        and length(${table.channelId}) between 1 and 200
        and ${table.targetOrdinal} >= 0
        and ${table.planRevision} > 0
        and ${table.planRevisionDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.targetSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.effectGeneration} > 0
        and ${table.nextEffectAttempt} between 1 and 9
        and ${table.confirmationAttempts} between 0 and 3
        and ${table.readinessBlockCount} between 0 and 2147483647
        and length(${table.effectKey}) between 1 and 500
        and ${table.effectKey} = btrim(${table.effectKey})
        and ${table.effectKey} !~ '[[:cntrl:]]'`,
    ),
    originCheck: check(
      "runtime_publishing_deliveries_origin_check",
      sql`((${table.releaseId} is not null and ${table.sourceDeliveryId} is null and ${table.retryId} is null)
        or (${table.releaseId} is null and ${table.sourceDeliveryId} is not null and ${table.retryId} is not null))`,
    ),
    snapshotCheck: check(
      "runtime_publishing_deliveries_snapshot_check",
      sql`jsonb_typeof(${table.artifactIds}) = 'array'
        and jsonb_array_length(${table.artifactIds}) between 1 and 51
        and jsonb_typeof(${table.targetSnapshot}) = 'object'
        and ${table.targetSnapshot}->>'schema' = 'publishing-delivery-target-snapshot/v1'
        and ${table.targetSnapshot}->'target'->>'targetId' = ${table.targetId}
        and ${table.targetSnapshot}->'target'->>'channelId' = ${table.channelId}
        and ${table.targetSnapshot}->>'targetDigest' ~ '^sha256:[a-f0-9]{64}$'
        and octet_length(${table.targetSnapshot}::text) <= 262144`,
    ),
    stateCheck: check(
      "runtime_publishing_deliveries_state_check",
      sql`${table.desiredState} in ('publish','cancel')
        and ${table.state} in (
          'scheduled','blocked','dispatching','confirmation_pending',
          'succeeded','failed_transient','failed_terminal','outcome_unknown','cancelled'
        )
        and ${table.nextEventSequence} >= 3
        and ${table.nextOutboxGeneration} >= 2`,
    ),
    evidenceCheck: check(
      "runtime_publishing_deliveries_evidence_check",
      sql`(${table.intentDigest} is null or ${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$')
        and (${table.providerAdapterContractDigest} is null or ${table.providerAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$')
        and (${table.latestEffectEvidenceDigest} is null or ${table.latestEffectEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$')
        and (${table.providerOperationRef} is null or (
          length(${table.providerOperationRef}) between 1 and 500
          and ${table.providerOperationRef} = btrim(${table.providerOperationRef})
          and ${table.providerOperationRef} !~ '[[:cntrl:]]'
        ))
        and (${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$')
        and (${table.failureClass} is null or ${table.failureClass} in ('transient','terminal'))
        and (${table.failureEffectDisposition} is null or ${table.failureEffectDisposition} in (
          'not_created','provider_failed_known','ambiguous'
        ))
        and ((${table.failureClass} is null and ${table.failureRetryable} is null and ${table.failureEffectDisposition} is null)
          or (${table.failureClass} is not null and ${table.failureRetryable} is not null
            and ${table.failureEffectDisposition} in ('not_created','provider_failed_known'))
          or (${table.failureClass} is null and ${table.failureRetryable} is null
            and ${table.failureEffectDisposition} = 'ambiguous'))`,
    ),
    readinessCheck: check(
      "runtime_publishing_deliveries_readiness_check",
      sql`((${table.state} = 'blocked'
          and ${table.readinessBlockCode} in (
            'EXECUTION_AUTHORIZATION_REVOKED','APPROVAL_NO_LONGER_VALID',
            'CHANNEL_UNAVAILABLE','CREDENTIAL_UNAVAILABLE','VALIDATION_STALE'
          )
          and ${table.readinessEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
          and ${table.readinessBlockedAt} is not null
          and ${table.readinessRetryAt} > ${table.readinessBlockedAt}
          and ${table.readinessBlockCount} between 1 and 2147483647)
        or (${table.state} <> 'blocked'
          and ${table.readinessBlockCode} is null
          and ${table.readinessEvidenceDigest} is null
          and ${table.readinessBlockedAt} is null
          and ${table.readinessRetryAt} is null
          and ${table.readinessBlockCount} = 0))`,
    ),
    lifecycleCheck: check(
      "runtime_publishing_deliveries_lifecycle_check",
      sql`(${table.state} = 'scheduled'
          and ${table.desiredState} = 'publish'
          and ((${table.intentDigest} is null and ${table.providerAdapterContractDigest} is null)
            or (${table.intentDigest} is not null and ${table.providerAdapterContractDigest} is not null))
          and ${table.providerOperationRef} is null
          and ${table.latestEffectEvidenceDigest} is null
          and ${table.failureCode} is null
          and ${table.dispatchStartedAt} is null
          and ${table.effectContactStartedAt} is null
          and ${table.completedAt} is null)
        or (${table.state} = 'blocked'
          and ${table.desiredState} = 'publish'
          and ${table.intentDigest} is not null
          and ${table.providerAdapterContractDigest} is not null
          and ${table.providerOperationRef} is null
          and ${table.latestEffectEvidenceDigest} is null
          and ${table.failureCode} is null
          and ${table.failureClass} is null
          and ${table.failureRetryable} is null
          and ${table.failureEffectDisposition} is null
          and ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} is null
          and ${table.completedAt} is null)
        or (${table.state} = 'scheduled'
          and ${table.desiredState} = 'publish'
          and ${table.intentDigest} is not null
          and ${table.providerOperationRef} is null
          and ${table.latestEffectEvidenceDigest} is not null
          and ${table.failureCode} is not null
          and ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} is not null
          and ${table.completedAt} is null)
        or (${table.state} = 'dispatching'
          and ${table.intentDigest} is not null
          and ${table.providerAdapterContractDigest} is not null
          and ${table.latestEffectEvidenceDigest} is null
          and ${table.failureCode} is null
          and ${table.dispatchStartedAt} is not null
          and ${table.completedAt} is null)
        or (${table.state} = 'confirmation_pending'
          and ${table.intentDigest} is not null
          and ${table.providerAdapterContractDigest} is not null
          and ${table.providerOperationRef} is not null
          and ${table.latestEffectEvidenceDigest} is not null
          and ${table.failureCode} is null
          and ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} is not null
          and ${table.completedAt} is null)
        or (${table.state} = 'succeeded'
          and ${table.intentDigest} is not null
          and ${table.providerAdapterContractDigest} is not null
          and ${table.providerOperationRef} is not null
          and ${table.latestEffectEvidenceDigest} is not null
          and ${table.failureCode} is null
          and ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} is not null
          and ${table.completedAt} is not null)
        or (${table.state} in ('failed_transient','failed_terminal')
          and ${table.latestEffectEvidenceDigest} is not null
          and ${table.failureCode} is not null
          and ${table.failureClass} = case when ${table.state} = 'failed_transient' then 'transient' else 'terminal' end
          and ${table.failureRetryable} = (${table.state} = 'failed_transient')
          and ${table.failureEffectDisposition} in ('not_created','provider_failed_known')
          and ((${table.failureEffectDisposition} = 'not_created'
              and ${table.providerOperationRef} is null
              and (((${table.dispatchStartedAt} is null
                  and ${table.effectContactStartedAt} is null)
                and ((${table.intentDigest} is null and ${table.providerAdapterContractDigest} is null)
                  or (${table.intentDigest} is not null and ${table.providerAdapterContractDigest} is not null)))
                or (${table.intentDigest} is not null
                  and ${table.providerAdapterContractDigest} is not null
                  and ${table.dispatchStartedAt} is not null
                  and ${table.effectContactStartedAt} is not null)))
            or (${table.failureEffectDisposition} = 'provider_failed_known'
              and ${table.intentDigest} is not null
              and ${table.providerAdapterContractDigest} is not null
              and ${table.dispatchStartedAt} is not null
              and ${table.effectContactStartedAt} is not null))
          and ${table.completedAt} is not null)
        or (${table.state} = 'outcome_unknown'
          and ${table.intentDigest} is not null
          and ${table.providerAdapterContractDigest} is not null
          and ${table.latestEffectEvidenceDigest} is not null
          and ${table.failureCode} is not null
          and ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} is not null
          and ${table.completedAt} is not null)
        or (${table.state} = 'cancelled'
          and ${table.desiredState} = 'cancel'
          and ${table.providerOperationRef} is null
          and ${table.latestEffectEvidenceDigest} is null
          and ${table.failureCode} is null
          and ${table.effectContactStartedAt} is null
          and ((${table.intentDigest} is null and ${table.dispatchStartedAt} is null)
            or (${table.intentDigest} is not null and ${table.dispatchStartedAt} is not null))
          and ${table.completedAt} is not null)`,
    ),
    timeCheck: check(
      "runtime_publishing_deliveries_time_check",
      sql`${table.scheduledAt} >= ${table.acceptedAt}
        and ${table.updatedAt} >= ${table.acceptedAt}
        and (${table.dispatchStartedAt} is null or ${table.dispatchStartedAt} >= ${table.acceptedAt})
        and (${table.effectContactStartedAt} is null or (
          ${table.dispatchStartedAt} is not null
          and ${table.effectContactStartedAt} >= ${table.dispatchStartedAt}
        ))
        and (${table.completedAt} is null or ${table.completedAt} >= ${table.dispatchStartedAt})`,
    ),
  }),
);

/** Exact retry-source provenance without a cyclic Approval↔Delivery table initializer. */
export const runtimePublishingApprovalRetrySources = pgTable(
  "runtime_publishing_approval_retry_sources",
  {
    workspaceId: text("workspace_id").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    sourceDeliveryId: text("source_delivery_id").notNull(),
    sourceEvidenceDigest: text("source_evidence_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.approvalRequestId],
      name: "runtime_publishing_approval_retry_sources_pk",
    }),
    sourceIdx: index(
      "runtime_publishing_approval_retry_sources_source_idx",
    ).on(table.workspaceId, table.sourceDeliveryId),
    requestFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId],
      foreignColumns: [
        runtimePublishingApprovalRequests.workspaceId,
        runtimePublishingApprovalRequests.id,
      ],
      name: "runtime_publishing_approval_retry_sources_request_fk",
    }).onDelete("restrict"),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.sourceDeliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_approval_retry_sources_delivery_fk",
    }).onDelete("restrict"),
    evidenceCheck: check(
      "runtime_publishing_approval_retry_sources_evidence_check",
      sql`${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
  }),
);

/**
 * Immutable, intrinsic cancellation result for one stable Delivery. The row is
 * also replay authority: later publication evidence must never rewrite the
 * result that was truthful at cancellation time.
 */
export const runtimePublishingDeliveryCancellations = pgTable(
  "runtime_publishing_delivery_cancellations",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    principalId: text("principal_id"),
    keyId: text("key_id"),
    userId: text("user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    capability: text("capability").notNull(),
    authorizationSessionId: text("authorization_session_id").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationAdmissionEvidenceRef: text(
      "authorization_admission_evidence_ref",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizationEvidenceDigest: text(
      "authorization_evidence_digest",
    ).notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    authorityGrants: jsonb("authority_grants")
      .$type<Array<{ channelId: string; grantId: string }>>()
      .notNull(),
    authorizationIssuedAt: timestamp("authorization_issued_at", {
      withTimezone: true,
    }).notNull(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    stateAtRequest: text("state_at_request").notNull(),
    outcome: text("outcome").notNull(),
    externallyCompletedAtRequest: boolean(
      "externally_completed_at_request",
    ),
    externallyReversed: boolean("externally_reversed").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.deliveryId],
      name: "runtime_publishing_delivery_cancellations_pk",
    }),
    identityUnique: uniqueIndex(
      "runtime_publishing_delivery_cancellations_identity_unique",
    ).on(table.workspaceId, table.id),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_cancellations_delivery_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_cancellations_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_cancellations_key_fk",
    }).onDelete("restrict"),
    agentAuthorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.keyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "runtime_publishing_delivery_cancellations_agent_evidence_fk",
    }).onDelete("restrict"),
    actorIdx: index(
      "runtime_publishing_delivery_cancellations_actor_idx",
    ).on(table.workspaceId, table.actorKind, table.actorId, table.requestedAt),
    principalIdx: index(
      "runtime_publishing_delivery_cancellations_principal_idx",
    ).on(table.workspaceId, table.principalId),
    keyIdx: index(
      "runtime_publishing_delivery_cancellations_key_idx",
    ).on(table.principalId, table.keyId),
    agentEvidenceIdx: index(
      "runtime_publishing_delivery_cancellations_agent_evidence_idx",
    ).on(
      table.workspaceId,
      table.principalId,
      table.keyId,
      table.authorizationEvidenceRef,
    ),
    userIdx: index(
      "runtime_publishing_delivery_cancellations_user_idx",
    ).on(table.userId),
    requestedIdx: index(
      "runtime_publishing_delivery_cancellations_requested_idx",
    ).on(table.workspaceId, table.requestedAt, table.deliveryId),
    identityCheck: check(
      "runtime_publishing_delivery_cancellations_identity_check",
      sql`${table.id} ~ '^pdc_[A-Za-z0-9_-]+$'
        and length(${table.id}) between 1 and 200
        and length(${table.authorizationSessionId}) between 1 and 200`,
    ),
    actorCheck: check(
      "runtime_publishing_delivery_cancellations_actor_check",
      sql`(${table.actorKind} = 'agent'
          and ${table.actorId} = ${table.principalId}
          and ${table.principalId} is not null
          and ${table.keyId} is not null
          and ${table.userId} is null
          and jsonb_array_length(${table.authorityGrants}) = 0)
        or (${table.actorKind} = 'human'
          and ${table.actorId} = ${table.userId}
          and ${table.userId} is not null
          and ${table.principalId} is null
          and ${table.keyId} is null
          and jsonb_array_length(${table.authorityGrants}) = 1)`,
    ),
    authorizationCheck: check(
      "runtime_publishing_delivery_cancellations_authorization_check",
      sql`${table.capability} = 'publishing_deliveries.cancel@1'
        and ${table.authorizationContractDigest} = 'sha256:cae0f4b46fca3c38dd014bf2c27b2b8f2a3555d24eb62da60c367e49f2e1554e'
        and length(${table.authorizationAdmissionEvidenceRef}) between 1 and 200
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and ${table.authorizationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and ${table.authorizedResources} ?& array['channelIds','artifactIds']
        and (${table.authorizedResources} - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof(${table.authorizedResources}->'channelIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'channelIds') between 1 and 50
        and jsonb_typeof(${table.authorizedResources}->'artifactIds') = 'array'
        and jsonb_array_length(${table.authorizedResources}->'artifactIds') between 1 and 200
        and jsonb_typeof(${table.authorityGrants}) = 'array'
        and jsonb_array_length(${table.authorityGrants}) between 0 and 50
        and ${table.authorizationExpiresAt} > ${table.authorizationIssuedAt}
        and ${table.requestedAt} >= ${table.authorizationIssuedAt}
        and ${table.requestedAt} < ${table.authorizationExpiresAt}`,
    ),
    resultCheck: check(
      "runtime_publishing_delivery_cancellations_result_check",
      sql`${table.stateAtRequest} in (
          'scheduled','blocked','dispatching','confirmation_pending','succeeded',
          'failed_transient','failed_terminal','outcome_unknown','cancelled'
        )
        and ${table.outcome} in ('prevented','conditional','unknown','too_late')
        and ${table.externallyReversed} = false
        and ((${table.outcome} = 'prevented' and ${table.stateAtRequest} in ('scheduled','blocked','dispatching'))
          or (${table.outcome} = 'conditional' and ${table.stateAtRequest} = 'confirmation_pending')
          or (${table.outcome} = 'unknown' and ${table.stateAtRequest} in ('scheduled','dispatching','outcome_unknown'))
          or (${table.outcome} = 'too_late' and ${table.stateAtRequest} in (
            'succeeded','failed_transient','failed_terminal'
          )))
        and ((${table.outcome} in ('unknown','conditional')
            and ${table.externallyCompletedAtRequest} is null)
          or (${table.outcome} = 'prevented'
            and ${table.externallyCompletedAtRequest} = false)
          or (${table.outcome} = 'too_late'
            and ${table.externallyCompletedAtRequest} = (${table.stateAtRequest} = 'succeeded')))`,
    ),
  }),
);

/**
 * Immutable prepared external-effect identities. A known provider failure may
 * derive a new generation; ordinary retries and reconciliation retain the
 * exact existing identity.
 */
export const runtimePublishingDeliveryEffectIdentities = pgTable(
  "runtime_publishing_delivery_effect_identities",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    generation: integer("generation").notNull(),
    effectKey: text("effect_key").notNull(),
    intentDigest: text("intent_digest"),
    providerAdapterContractDigest: text(
      "provider_adapter_contract_digest",
    ),
    parentEffectKey: text("parent_effect_key"),
    parentGeneration: integer("parent_generation"),
    derivation: text("derivation").notNull(),
    sourceEvidenceDigest: text("source_evidence_digest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_effect_identities_pk",
    }),
    deliveryGenerationUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_identities_delivery_generation_unique",
    ).on(table.workspaceId, table.deliveryId, table.generation),
    effectKeyUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_identities_effect_key_unique",
    ).on(table.workspaceId, table.effectKey),
    exactIdentityUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_identities_exact_unique",
    ).on(
      table.workspaceId,
      table.deliveryId,
      table.generation,
      table.effectKey,
      table.intentDigest,
      table.providerAdapterContractDigest,
    ),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_effect_identities_delivery_fk",
    }).onDelete("restrict"),
    identityCheck: check(
      "runtime_publishing_delivery_effect_identities_identity_check",
      sql`${table.id} ~ '^pdei_[A-Za-z0-9_-]+$'
        and ${table.generation} > 0
        and length(${table.effectKey}) between 1 and 500
        and ${table.effectKey} = btrim(${table.effectKey})
        and ${table.effectKey} !~ '[[:cntrl:]]'
        and ((${table.intentDigest} is null and ${table.providerAdapterContractDigest} is null)
          or (${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'
            and ${table.providerAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$'))
        and (${table.sourceEvidenceDigest} is null or ${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$')
        and ((${table.derivation} = 'release' and ${table.generation} = 1
          and ${table.parentEffectKey} is null and ${table.parentGeneration} is null
          and ${table.sourceEvidenceDigest} is null)
          or (${table.derivation} = 'manual_retry' and ${table.generation} = 1
            and ${table.parentEffectKey} is null and ${table.parentGeneration} is null
            and ${table.sourceEvidenceDigest} is not null)
          or (${table.derivation} = 'retry_provider_failed_known' and ${table.generation} > 1
            and ${table.parentEffectKey} is not null
            and ${table.parentGeneration} = ${table.generation} - 1
            and ${table.sourceEvidenceDigest} is not null))`,
    ),
  }),
);

/** Immutable proof of the exact fresh checks committed before provider contact. */
export const runtimePublishingDeliveryReadinessReceipts = pgTable(
  "runtime_publishing_delivery_readiness_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    effectGeneration: integer("effect_generation").notNull(),
    effectAttempt: integer("effect_attempt").notNull(),
    effectKey: text("effect_key").notNull(),
    intentDigest: text("intent_digest").notNull(),
    providerAdapterContractDigest: text(
      "provider_adapter_contract_digest",
    ).notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" }).notNull(),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull(),
    authorizationEvidenceDigest: text(
      "authorization_evidence_digest",
    ).notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    approvalDecisionId: text("approval_decision_id").notNull(),
    channelStateDigest: text("channel_state_digest").notNull(),
    credentialStateDigest: text("credential_state_digest").notNull(),
    validationEvidenceDigest: text("validation_evidence_digest").notNull(),
    validationCurrentStateDigest: text(
      "validation_current_state_digest",
    ).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_readiness_receipts_pk",
    }),
    attemptUnique: uniqueIndex(
      "runtime_publishing_delivery_readiness_receipts_attempt_unique",
    ).on(
      table.workspaceId,
      table.deliveryId,
      table.effectGeneration,
      table.effectAttempt,
    ),
    principalIdx: index("runtime_publishing_delivery_readiness_receipts_principal_idx")
      .on(table.workspaceId, table.principalId),
    keyIdx: index("runtime_publishing_delivery_readiness_receipts_key_idx")
      .on(table.principalId, table.keyId),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_readiness_receipts_delivery_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_readiness_receipts_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_readiness_receipts_key_fk",
    }).onDelete("restrict"),
    identityCheck: check(
      "runtime_publishing_delivery_readiness_receipts_identity_check",
      sql`${table.id} ~ '^pdrr_[A-Za-z0-9_-]+$'
        and ${table.effectGeneration} > 0 and ${table.effectAttempt} between 1 and 8
        and ${table.executionFence} > 0
        and length(${table.effectKey}) between 1 and 500
        and ${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.providerAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.authorizationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.channelStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.credentialStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.validationCurrentStateDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.expiresAt} > ${table.checkedAt}`,
    ),
  }),
);

/**
 * Immutable normalized settlement evidence. Retry eligibility is read from
 * these columns and is never inferred from provider failure-code strings.
 */
export const runtimePublishingDeliveryEffectReceipts = pgTable(
  "runtime_publishing_delivery_effect_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    effectGeneration: integer("effect_generation").notNull(),
    effectAttempt: integer("effect_attempt").notNull(),
    effectKey: text("effect_key").notNull(),
    intentDigest: text("intent_digest"),
    providerAdapterContractDigest: text(
      "provider_adapter_contract_digest",
    ),
    mode: text("mode").notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" }).notNull(),
    result: text("result").notNull(),
    effectDisposition: text("effect_disposition").notNull(),
    failureClass: text("failure_class"),
    failureRetryable: boolean("failure_retryable"),
    providerOperationRef: text("provider_operation_ref"),
    evidenceDigest: text("evidence_digest").notNull(),
    failureCode: text("failure_code"),
    eventSequence: integer("event_sequence").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_effect_receipts_pk",
    }),
    attemptUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_receipts_attempt_unique",
    ).on(
      table.workspaceId,
      table.deliveryId,
      table.effectGeneration,
      table.effectAttempt,
    ),
    evidenceUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_receipts_evidence_unique",
    ).on(table.workspaceId, table.deliveryId, table.evidenceDigest),
    eventUnique: uniqueIndex(
      "runtime_publishing_delivery_effect_receipts_event_unique",
    ).on(table.workspaceId, table.deliveryId, table.eventSequence),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_effect_receipts_delivery_fk",
    }).onDelete("restrict"),
    identityCheck: check(
      "runtime_publishing_delivery_effect_receipts_identity_check",
      sql`${table.id} ~ '^pder_[A-Za-z0-9_-]+$'
        and ${table.effectGeneration} > 0 and ${table.effectAttempt} between 1 and 8
        and ${table.executionFence} > 0 and ${table.eventSequence} > 0
        and length(${table.effectKey}) between 1 and 500
        and ((${table.intentDigest} is null and ${table.providerAdapterContractDigest} is null
            and ${table.effectDisposition} = 'not_created')
          or (${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'
            and ${table.providerAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$'))
        and ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and (${table.providerOperationRef} is null or (
          length(${table.providerOperationRef}) between 1 and 500
          and ${table.providerOperationRef} = btrim(${table.providerOperationRef})
          and ${table.providerOperationRef} !~ '[[:cntrl:]]'))
        and (${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$')`,
    ),
    resultCheck: check(
      "runtime_publishing_delivery_effect_receipts_result_check",
      sql`${table.mode} in ('launch','observe','reconcile')
        and ${table.result} in (
          'succeeded','failed_transient','failed_terminal',
          'confirmation_pending','outcome_unknown','still_unknown','operator_required'
        )
        and ${table.effectDisposition} in (
          'not_created','provider_failed_known','provider_accepted','unknown'
        )
        and ((${table.result} = 'failed_transient'
            and ${table.failureClass} = 'transient' and ${table.failureRetryable} = true
            and ${table.failureCode} is not null
            and ${table.effectDisposition} in ('not_created','provider_failed_known'))
          or (${table.result} = 'failed_terminal'
            and ${table.failureClass} = 'terminal' and ${table.failureRetryable} = false
            and ${table.failureCode} is not null
            and ${table.effectDisposition} in ('not_created','provider_failed_known'))
          or (${table.result} in ('outcome_unknown','still_unknown','operator_required')
            and ${table.failureClass} is null and ${table.failureRetryable} is null
            and ${table.failureCode} is not null
            and ${table.effectDisposition} in ('provider_accepted','unknown'))
          or (${table.result} in ('succeeded','confirmation_pending')
            and ${table.failureClass} is null and ${table.failureRetryable} is null
            and ${table.failureCode} is null
            and ${table.effectDisposition} = 'provider_accepted'))`,
    ),
  }),
);

/** Intrinsic replay authority for one actor retrying one proved-safe failure. */
export const runtimePublishingDeliveryRetryApprovalConsumptions = pgTable(
  "runtime_publishing_delivery_retry_approval_consumptions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    approvalDecisionId: text("approval_decision_id").notNull(),
    sourceDeliveryId: text("source_delivery_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    sourceEvidenceDigest: text("source_evidence_digest").notNull(),
    requestingPrincipalId: text("requesting_principal_id").notNull(),
    requestingKeyId: text("requesting_key_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    capability: text("capability").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_retry_approval_consumptions_pk",
    }),
    decisionUnique: uniqueIndex(
      "runtime_publishing_delivery_retry_approval_consumptions_decision_unique",
    ).on(table.workspaceId, table.approvalDecisionId),
    exactUnique: uniqueIndex(
      "runtime_publishing_delivery_retry_approval_consumptions_exact_unique",
    ).on(
      table.workspaceId,
      table.approvalRequestId,
      table.approvalDecisionId,
      table.sourceDeliveryId,
      table.deliveryId,
      table.sourceEvidenceDigest,
      table.id,
    ),
    sourceDeliveryIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_source_idx",
    ).on(table.workspaceId, table.sourceDeliveryId),
    deliveryIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_delivery_idx",
    ).on(table.workspaceId, table.deliveryId),
    approvalIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_approval_idx",
    ).on(table.workspaceId, table.approvalRequestId, table.approvalDecisionId),
    principalIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_principal_idx",
    ).on(table.workspaceId, table.requestingPrincipalId),
    keyIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_key_idx",
    ).on(table.requestingPrincipalId, table.requestingKeyId),
    userIdx: index(
      "runtime_publishing_delivery_retry_approval_consumptions_user_idx",
    ).on(table.actorUserId),
    sourceDeliveryFk: foreignKey({
      columns: [table.workspaceId, table.sourceDeliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_retry_approval_consumptions_source_delivery_fk",
    }).onDelete("restrict"),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_retry_approval_consumptions_delivery_fk",
    }).onDelete("restrict"),
    approvalFk: foreignKey({
      columns: [table.workspaceId, table.approvalRequestId, table.approvalDecisionId],
      foreignColumns: [
        runtimePublishingApprovalDecisions.workspaceId,
        runtimePublishingApprovalDecisions.requestId,
        runtimePublishingApprovalDecisions.id,
      ],
      name: "runtime_publishing_delivery_retry_approval_consumptions_approval_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.requestingPrincipalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_retry_approval_consumptions_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.requestingPrincipalId, table.requestingKeyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_retry_approval_consumptions_key_fk",
    }).onDelete("restrict"),
    contractCheck: check(
      "runtime_publishing_delivery_retry_approval_consumptions_contract_check",
      sql`${table.id} ~ '^pdrc_[A-Za-z0-9_-]+$'
        and ${table.capability} = 'publishing_deliveries.retry@1'
        and ${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.authorizationContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and ((${table.actorKind} = 'agent' and ${table.actorId} = ${table.requestingPrincipalId}
            and ${table.actorUserId} is null)
          or (${table.actorKind} = 'human' and ${table.actorId} = ${table.actorUserId}
            and ${table.actorUserId} is not null))`,
    ),
  }),
);

export const runtimePublishingDeliveryRetryReceipts = pgTable(
  "runtime_publishing_delivery_retry_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    sourceDeliveryId: text("source_delivery_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    principalId: text("principal_id"),
    keyId: text("key_id"),
    userId: text("user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    capability: text("capability").notNull(),
    authorizationSessionId: text("authorization_session_id").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationAdmissionEvidenceRef: text(
      "authorization_admission_evidence_ref",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizationEvidenceDigest: text(
      "authorization_evidence_digest",
    ).notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    authorityGrants: jsonb("authority_grants")
      .$type<Array<{ channelId: string; grantId: string }>>()
      .notNull(),
    authorizationIssuedAt: timestamp("authorization_issued_at", {
      withTimezone: true,
    }).notNull(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    sourceEvidenceDigest: text("source_evidence_digest").notNull(),
    sourceEffectGeneration: integer("source_effect_generation").notNull(),
    sourceEffectKey: text("source_effect_key").notNull(),
    sourceIntentDigest: text("source_intent_digest"),
    sourceProviderAdapterContractDigest: text(
      "source_provider_adapter_contract_digest",
    ),
    sourceFailureClass: text("source_failure_class").notNull(),
    sourceEffectDisposition: text("source_effect_disposition").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    approvalDecisionId: text("approval_decision_id").notNull(),
    approvalConsumptionId: text("approval_consumption_id").notNull(),
    eventSequence: integer("event_sequence").notNull(),
    outboxGeneration: integer("outbox_generation").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_retry_receipts_pk",
    }),
    sourceDeliveryIdx: index("runtime_publishing_delivery_retry_receipts_source_idx")
      .on(table.workspaceId, table.sourceDeliveryId),
    deliveryIdx: index("runtime_publishing_delivery_retry_receipts_delivery_idx")
      .on(table.workspaceId, table.deliveryId),
    principalIdx: index("runtime_publishing_delivery_retry_receipts_principal_idx")
      .on(table.workspaceId, table.principalId),
    keyIdx: index("runtime_publishing_delivery_retry_receipts_key_idx")
      .on(table.principalId, table.keyId),
    userIdx: index("runtime_publishing_delivery_retry_receipts_user_idx")
      .on(table.userId),
    approvalConsumptionIdx: index(
      "runtime_publishing_delivery_retry_receipts_approval_consumption_idx",
    ).on(table.workspaceId, table.approvalConsumptionId),
    invocationUnique: uniqueIndex(
      "runtime_publishing_delivery_retry_receipts_invocation_unique",
    ).on(
      table.workspaceId,
      table.sourceDeliveryId,
      table.sourceEvidenceDigest,
    ),
    mutationUnique: uniqueIndex(
      "runtime_publishing_delivery_retry_receipts_mutation_unique",
    ).on(
      table.workspaceId,
      table.actorKind,
      table.actorId,
      table.capability,
      table.idempotencyKey,
    ),
    sourceDeliveryFk: foreignKey({
      columns: [table.workspaceId, table.sourceDeliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_retry_receipts_source_delivery_fk",
    }).onDelete("restrict"),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_retry_receipts_delivery_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_retry_receipts_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_retry_receipts_key_fk",
    }).onDelete("restrict"),
    approvalConsumptionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.approvalRequestId,
        table.approvalDecisionId,
        table.sourceDeliveryId,
        table.deliveryId,
        table.sourceEvidenceDigest,
        table.approvalConsumptionId,
      ],
      foreignColumns: [
        runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId,
        runtimePublishingDeliveryRetryApprovalConsumptions.approvalRequestId,
        runtimePublishingDeliveryRetryApprovalConsumptions.approvalDecisionId,
        runtimePublishingDeliveryRetryApprovalConsumptions.sourceDeliveryId,
        runtimePublishingDeliveryRetryApprovalConsumptions.deliveryId,
        runtimePublishingDeliveryRetryApprovalConsumptions.sourceEvidenceDigest,
        runtimePublishingDeliveryRetryApprovalConsumptions.id,
      ],
      name: "runtime_publishing_delivery_retry_receipts_approval_consumption_fk",
    }).onDelete("restrict"),
    actorCheck: check(
      "runtime_publishing_delivery_retry_receipts_actor_check",
      sql`(${table.actorKind} = 'agent' and ${table.actorId} = ${table.principalId}
          and ${table.principalId} is not null and ${table.keyId} is not null
          and ${table.userId} is null and jsonb_array_length(${table.authorityGrants}) = 0)
        or (${table.actorKind} = 'human' and ${table.actorId} = ${table.userId}
          and ${table.userId} is not null and ${table.principalId} is null
          and ${table.keyId} is null and jsonb_array_length(${table.authorityGrants}) = 1)`,
    ),
    contractCheck: check(
      "runtime_publishing_delivery_retry_receipts_contract_check",
      sql`${table.id} ~ '^pdrt_[A-Za-z0-9_-]+$'
        and ${table.capability} = 'publishing_deliveries.retry@1'
        and length(${table.idempotencyKey}) between 8 and 200
        and ${table.idempotencyKey} ~ '^[!-~]+$'
        and ${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'
        and length(${table.authorizationSessionId}) between 1 and 200
        and ${table.authorizationContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and length(${table.authorizationAdmissionEvidenceRef}) between 1 and 200
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and ${table.authorizationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and jsonb_typeof(${table.authorityGrants}) = 'array'
        and ${table.authorizationExpiresAt} > ${table.authorizationIssuedAt}
        and ${table.requestedAt} >= ${table.authorizationIssuedAt}
        and ${table.requestedAt} < ${table.authorizationExpiresAt}
        and ${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and (${table.sourceIntentDigest} is null or ${table.sourceIntentDigest} ~ '^sha256:[a-f0-9]{64}$')
        and (${table.sourceProviderAdapterContractDigest} is null or ${table.sourceProviderAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$')
        and ((${table.sourceIntentDigest} is null and ${table.sourceProviderAdapterContractDigest} is null)
          or (${table.sourceIntentDigest} is not null and ${table.sourceProviderAdapterContractDigest} is not null))
        and ${table.sourceEffectGeneration} > 0
        and ${table.sourceFailureClass} in ('transient','terminal')
        and ${table.sourceEffectDisposition} in ('not_created','provider_failed_known')
        and ${table.eventSequence} > 0 and ${table.outboxGeneration} > 0
        and ${table.retryAt} >= ${table.requestedAt}`,
    ),
  }),
);

/** Immutable actor request; settlement is written separately after observation. */
export const runtimePublishingDeliveryReconciliationRequests = pgTable(
  "runtime_publishing_delivery_reconciliation_requests",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    principalId: text("principal_id"),
    keyId: text("key_id"),
    userId: text("user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    capability: text("capability").notNull(),
    authorizationSessionId: text("authorization_session_id").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    authorizationAdmissionEvidenceRef: text(
      "authorization_admission_evidence_ref",
    ).notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    authorizationEvidenceDigest: text(
      "authorization_evidence_digest",
    ).notNull(),
    authorizedResources: jsonb("authorized_resources")
      .$type<{ channelIds: string[]; artifactIds: string[] }>()
      .notNull(),
    authorityGrants: jsonb("authority_grants")
      .$type<Array<{ channelId: string; grantId: string }>>()
      .notNull(),
    authorizationIssuedAt: timestamp("authorization_issued_at", {
      withTimezone: true,
    }).notNull(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    sourceEvidenceDigest: text("source_evidence_digest").notNull(),
    effectGeneration: integer("effect_generation").notNull(),
    effectKey: text("effect_key").notNull(),
    intentDigest: text("intent_digest").notNull(),
    providerAdapterContractDigest: text(
      "provider_adapter_contract_digest",
    ).notNull(),
    providerOperationRef: text("provider_operation_ref"),
    eventSequence: integer("event_sequence").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_reconciliation_requests_pk",
    }),
    principalIdx: index(
      "runtime_publishing_delivery_reconciliation_requests_principal_idx",
    ).on(table.workspaceId, table.principalId),
    keyIdx: index("runtime_publishing_delivery_reconciliation_requests_key_idx")
      .on(table.principalId, table.keyId),
    userIdx: index("runtime_publishing_delivery_reconciliation_requests_user_idx")
      .on(table.userId),
    invocationUnique: uniqueIndex(
      "runtime_publishing_delivery_reconciliation_requests_invocation_unique",
    ).on(
      table.workspaceId,
      table.deliveryId,
      table.sourceEvidenceDigest,
    ),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_reconciliation_requests_delivery_fk",
    }).onDelete("restrict"),
    principalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_publishing_delivery_reconciliation_requests_principal_fk",
    }).onDelete("restrict"),
    keyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "runtime_publishing_delivery_reconciliation_requests_key_fk",
    }).onDelete("restrict"),
    actorCheck: check(
      "runtime_publishing_delivery_reconciliation_requests_actor_check",
      sql`(${table.actorKind} = 'agent' and ${table.actorId} = ${table.principalId}
          and ${table.principalId} is not null and ${table.keyId} is not null
          and ${table.userId} is null and jsonb_array_length(${table.authorityGrants}) = 0)
        or (${table.actorKind} = 'human' and ${table.actorId} = ${table.userId}
          and ${table.userId} is not null and ${table.principalId} is null
          and ${table.keyId} is null and jsonb_array_length(${table.authorityGrants}) = 1)`,
    ),
    contractCheck: check(
      "runtime_publishing_delivery_reconciliation_requests_contract_check",
      sql`${table.id} ~ '^pdre_[A-Za-z0-9_-]+$'
        and ${table.capability} = 'publishing_deliveries.reconcile@1'
        and length(${table.authorizationSessionId}) between 1 and 200
        and ${table.authorizationContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and length(${table.authorizationAdmissionEvidenceRef}) between 1 and 200
        and length(${table.authorizationEvidenceRef}) between 1 and 200
        and ${table.authorizationEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof(${table.authorizedResources}) = 'object'
        and jsonb_typeof(${table.authorityGrants}) = 'array'
        and ${table.authorizationExpiresAt} > ${table.authorizationIssuedAt}
        and ${table.requestedAt} >= ${table.authorizationIssuedAt}
        and ${table.requestedAt} < ${table.authorizationExpiresAt}
        and ${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.effectGeneration} > 0
        and ${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.providerAdapterContractDigest} ~ '^sha256:[a-f0-9]{64}$'
        and (${table.providerOperationRef} is null or length(${table.providerOperationRef}) between 1 and 500)
        and ${table.eventSequence} > 0`,
    ),
  }),
);

export const runtimePublishingDeliveryReconciliationReceipts = pgTable(
  "runtime_publishing_delivery_reconciliation_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    reconciliationId: text("reconciliation_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    sourceEvidenceDigest: text("source_evidence_digest").notNull(),
    resultEvidenceDigest: text("result_evidence_digest").notNull(),
    effectKey: text("effect_key").notNull(),
    effectGeneration: integer("effect_generation").notNull(),
    outcome: text("outcome").notNull(),
    effectDisposition: text("effect_disposition"),
    failureClass: text("failure_class"),
    failureRetryable: boolean("failure_retryable"),
    failureCode: text("failure_code"),
    providerOperationRef: text("provider_operation_ref"),
    eventSequence: integer("event_sequence").notNull(),
    outboxGeneration: integer("outbox_generation"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.reconciliationId],
      name: "runtime_publishing_delivery_reconciliation_receipts_pk",
    }),
    evidenceUnique: uniqueIndex(
      "runtime_publishing_delivery_reconciliation_receipts_evidence_unique",
    ).on(table.workspaceId, table.deliveryId, table.resultEvidenceDigest),
    identityUnique: uniqueIndex(
      "runtime_publishing_delivery_reconciliation_receipts_identity_unique",
    ).on(table.workspaceId, table.id),
    requestFk: foreignKey({
      columns: [table.workspaceId, table.reconciliationId],
      foreignColumns: [
        runtimePublishingDeliveryReconciliationRequests.workspaceId,
        runtimePublishingDeliveryReconciliationRequests.id,
      ],
      name: "runtime_publishing_delivery_reconciliation_receipts_request_fk",
    }).onDelete("restrict"),
    resultCheck: check(
      "runtime_publishing_delivery_reconciliation_receipts_result_check",
      sql`${table.id} ~ '^pdrer_[A-Za-z0-9_-]+$'
        and ${table.sourceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.resultEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'
        and ${table.resultEvidenceDigest} <> ${table.sourceEvidenceDigest}
        and ${table.effectGeneration} > 0 and length(${table.effectKey}) between 1 and 500
        and ${table.eventSequence} > 0
        and ${table.outcome} in ('succeeded','failed_known','still_unknown','operator_required')
        and ((${table.outcome} = 'failed_known'
            and ${table.failureClass} in ('transient','terminal')
            and ${table.failureRetryable} = (${table.failureClass} = 'transient')
            and ${table.failureCode} is not null
            and ${table.effectDisposition} in ('not_created','provider_failed_known'))
          or (${table.outcome} in ('still_unknown','operator_required')
            and ${table.failureClass} is null and ${table.failureRetryable} is null
            and ${table.failureCode} is not null and ${table.effectDisposition} is null)
          or (${table.outcome} = 'succeeded'
            and ${table.failureClass} is null and ${table.failureRetryable} is null
            and ${table.failureCode} is null and ${table.effectDisposition} is null))
        and ${table.outboxGeneration} is null`,
    ),
  }),
);

export const runtimePublishingDeliveryEvents = pgTable(
  "runtime_publishing_delivery_events",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    evidence: jsonb("evidence")
      .$type<PublishingDeliveryEvent["evidence"]>()
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "runtime_publishing_delivery_events_pk",
    }),
    deliverySequenceUnique: uniqueIndex(
      "runtime_publishing_delivery_events_delivery_sequence_unique",
    ).on(table.workspaceId, table.deliveryId, table.sequence),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_events_delivery_fk",
    }).onDelete("restrict"),
    deliverySequenceIdx: index(
      "runtime_publishing_delivery_events_delivery_sequence_idx",
    ).on(table.workspaceId, table.deliveryId, table.sequence),
    notificationCursorIdx: index(
      "runtime_publishing_delivery_events_notification_cursor_idx",
    ).on(table.occurredAt, table.id).where(sql`${table.type} in ('publication.failed_terminal','publication.outcome_unknown')`),
    sequenceCheck: check(
      "runtime_publishing_delivery_events_sequence_check",
      sql`${table.sequence} > 0`,
    ),
    typeCheck: check(
      "runtime_publishing_delivery_events_type_check",
      sql`${table.type} in (
        'delivery.accepted','delivery.scheduled','delivery.blocked','delivery.resumed',
        'delivery.cancellation_requested','delivery.cancelled','delivery.retry_requested',
        'delivery.reconciliation_requested','delivery.reconciled',
        'effect.not_created','effect.prepared','effect.contact_started',
        'publication.confirmation_pending','publication.retry_scheduled',
        'publication.succeeded','publication.failed_transient','publication.failed_terminal',
        'publication.outcome_unknown'
      )`,
    ),
    evidenceCheck: check(
      "runtime_publishing_delivery_events_evidence_check",
      sql`jsonb_typeof(${table.evidence}) = 'object'
        and octet_length(${table.evidence}::text) <= 65536`,
    ),
  }),
);

export const runtimePublishingDeliveryOutboxIntents = pgTable(
  "runtime_publishing_delivery_outbox_intents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    purpose: text("purpose").default("publish").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    generation: integer("generation").notNull(),
    state: text("state").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    deliveryToken: text("delivery_token"),
    deliveryAttempts: integer("delivery_attempts").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => ({
    deliveryGenerationUnique: uniqueIndex(
      "runtime_publishing_delivery_outbox_delivery_generation_unique",
    ).on(table.workspaceId, table.deliveryId, table.generation),
    dedupeKeyUnique: uniqueIndex(
      "runtime_publishing_delivery_outbox_dedupe_key_unique",
    ).on(table.dedupeKey),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_outbox_delivery_fk",
    }).onDelete("restrict"),
    claimIdx: index("runtime_publishing_delivery_outbox_claim_idx").on(
      table.state,
      table.availableAt,
      table.deliveryId,
      table.generation,
      table.id,
    ),
    identityCheck: check(
      "runtime_publishing_delivery_outbox_identity_check",
      sql`length(${table.id}) between 1 and 200
        and length(${table.dedupeKey}) between 1 and 500
        and ${table.generation} > 0
        and ${table.deliveryAttempts} >= 0`,
    ),
    stateCheck: check(
      "runtime_publishing_delivery_outbox_state_check",
      sql`${table.state} in ('pending','claimed','delivered')
        and ${table.purpose} in ('publish','reconcile')`,
    ),
    lifecycleCheck: check(
      "runtime_publishing_delivery_outbox_lifecycle_check",
      sql`(${table.state} = 'pending'
          and ${table.deliveryToken} is null
          and ${table.claimedAt} is null
          and ${table.deliveredAt} is null)
        or (${table.state} = 'claimed'
          and ${table.deliveryToken} is not null
          and ${table.claimedAt} is not null
          and ${table.deliveredAt} is null)
        or (${table.state} = 'delivered'
          and ${table.deliveryToken} is null
          and ${table.claimedAt} is not null
          and ${table.deliveredAt} is not null)`,
    ),
  }),
);

export const runtimePublishingDeliveryExecutionLeases = pgTable(
  "runtime_publishing_delivery_execution_leases",
  {
    workspaceId: text("workspace_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    workerId: text("worker_id").notNull(),
    leaseToken: text("lease_token").notNull(),
    fence: bigint("fence", { mode: "bigint" }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.deliveryId],
      name: "runtime_publishing_delivery_execution_leases_pk",
    }),
    deliveryFk: foreignKey({
      columns: [table.workspaceId, table.deliveryId],
      foreignColumns: [
        runtimePublishingDeliveries.workspaceId,
        runtimePublishingDeliveries.id,
      ],
      name: "runtime_publishing_delivery_execution_leases_delivery_fk",
    }).onDelete("restrict"),
    expiryIdx: index(
      "runtime_publishing_delivery_execution_leases_expiry_idx",
    ).on(table.expiresAt, table.workspaceId, table.deliveryId),
    identityCheck: check(
      "runtime_publishing_delivery_execution_leases_identity_check",
      sql`${table.fence} > 0
        and length(${table.workerId}) between 1 and 200
        and length(${table.leaseToken}) between 1 and 200`,
    ),
    timeCheck: check(
      "runtime_publishing_delivery_execution_leases_time_check",
      sql`${table.expiresAt} > ${table.acquiredAt}
        and ${table.renewedAt} >= ${table.acquiredAt}
        and (${table.releasedAt} is null or ${table.releasedAt} >= ${table.acquiredAt})`,
    ),
  }),
);

export const agentAuthorizationDecisions = pgTable(
  "agent_authorization_decisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "restrict" }),
    keyId: text("key_id")
      .notNull()
      .references(() => agentKeys.id, { onDelete: "restrict" }),
    capabilityName: text("capability_name").notNull(),
    capabilityVersion: integer("capability_version").notNull(),
    authorizationContractDigest: text(
      "authorization_contract_digest",
    ).notNull(),
    outcome: text("outcome").notNull(),
    reason: text("reason").notNull(),
    operatorTraceRef: text("operator_trace_ref").notNull(),
    grantRevisionId: text("grant_revision_id").references(
      () => agentGrantRevisions.id,
      { onDelete: "restrict" },
    ),
    policyRevisionId: text("policy_revision_id").references(
      () => workspaceAgentPolicyRevisions.id,
      { onDelete: "restrict" },
    ),
    resources: jsonb("resources")
      .$type<Array<{ kind: string; id: string }>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index(
      "agent_authorization_decisions_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    principalCreatedIdx: index(
      "agent_authorization_decisions_principal_created_idx",
    ).on(table.principalId, table.createdAt),
    traceUnique: uniqueIndex(
      "agent_authorization_decisions_trace_unique",
    ).on(table.operatorTraceRef),
    runEvidenceUnique: uniqueIndex(
      "agent_authorization_decisions_run_evidence_unique",
    ).on(
      table.workspaceId,
      table.principalId,
      table.keyId,
      table.operatorTraceRef,
    ),
  }),
);

/**
 * Canonical durable Workflow Runs. Orchestrator delivery and execution leases
 * are internal coordination records; the Run and its ordered events remain the
 * only public execution authority.
 */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowRevisionId: text("workflow_revision_id").notNull(),
    state: text("state").notNull(),
    startSnapshotDigest: text("start_snapshot_digest").notNull(),
    startSnapshot: jsonb("start_snapshot")
      .$type<WorkflowRunStartSnapshot>()
      .notNull(),
    nextEventSequence: integer("next_event_sequence").notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    finalSnapshot: jsonb("final_snapshot").$type<WorkflowRunFinalSnapshot>(),
    finalSnapshotDigest: text("final_snapshot_digest"),
    sourceRunId: text("source_run_id"),
    rootRunId: text("root_run_id"),
    derivationDepth: integer("derivation_depth").default(0).notNull(),
    derivation: jsonb("derivation").$type<WorkflowRunDerivation>(),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "workflow_runs_pk",
    }),
    workspaceWorkflowRunUnique: uniqueIndex(
      "workflow_runs_workspace_workflow_id_unique",
    ).on(table.workspaceId, table.workflowId, table.id),
    workspaceSourceRunFk: foreignKey({
      columns: [table.workspaceId, table.workflowId, table.sourceRunId],
      foreignColumns: [
        table.workspaceId,
        table.workflowId,
        table.id,
      ],
      name: "workflow_runs_workspace_source_run_fk",
    }).onDelete("restrict"),
    workspaceRootRunFk: foreignKey({
      columns: [table.workspaceId, table.workflowId, table.rootRunId],
      foreignColumns: [
        table.workspaceId,
        table.workflowId,
        table.id,
      ],
      name: "workflow_runs_workspace_root_run_fk",
    }).onDelete("restrict"),
    workspaceWorkflowFk: foreignKey({
      columns: [table.workspaceId, table.workflowId],
      foreignColumns: [contentWorkflows.workspaceId, contentWorkflows.id],
      name: "workflow_runs_workspace_workflow_fk",
    }).onDelete("restrict"),
    workspaceWorkflowRevisionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.workflowId,
        table.workflowRevisionId,
      ],
      foreignColumns: [
        contentWorkflowRevisions.workspaceId,
        contentWorkflowRevisions.workflowId,
        contentWorkflowRevisions.id,
      ],
      name: "workflow_runs_workspace_workflow_revision_fk",
    }).onDelete("restrict"),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "workflow_runs_workspace_principal_fk",
    }).onDelete("restrict"),
    principalKeyFk: foreignKey({
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
      name: "workflow_runs_principal_key_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.keyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "workflow_runs_authorization_evidence_fk",
    }).onDelete("restrict"),
    workspaceUpdatedIdx: index("workflow_runs_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
      table.id,
    ),
    workflowUpdatedIdx: index("workflow_runs_workflow_updated_idx").on(
      table.workspaceId,
      table.workflowId,
      table.updatedAt,
      table.id,
    ),
    stateCheck: check(
      "workflow_runs_state_check",
      sql`${table.state} in ('accepted', 'running', 'waiting', 'outcome_unknown', 'completed', 'failed')`,
    ),
    identityCheck: check(
      "workflow_runs_identity_check",
      sql`length(${table.id}) between 1 and 200 and ${table.id} ~ '^[a-zA-Z0-9_-]+$'`,
    ),
    snapshotDigestCheck: check(
      "workflow_runs_snapshot_digest_check",
      sql`${table.startSnapshotDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    finalSnapshotDigestCheck: check(
      "workflow_runs_final_snapshot_digest_check",
      sql`${table.finalSnapshotDigest} is null or ${table.finalSnapshotDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    snapshotCheck: check(
      "workflow_runs_snapshot_check",
      sql`jsonb_typeof(${table.startSnapshot}) = 'object'
        and ${table.startSnapshot}->>'schema' in ('workflow-run-start-snapshot/v1', 'workflow-run-start-snapshot/v2', 'workflow-run-start-snapshot/v3')
        and (
          ${table.startSnapshot}->>'schema' = 'workflow-run-start-snapshot/v1'
          or (
            jsonb_typeof(${table.startSnapshot}->'providerResolutions') = 'array'
            and jsonb_array_length(${table.startSnapshot}->'providerResolutions') > 0
          )
        )
        and (
          ${table.startSnapshot}->>'schema' <> 'workflow-run-start-snapshot/v3'
          or valid_workflow_run_studio_asset_references(${table.startSnapshot}->'studioAssetReferences')
        )
        and ${table.startSnapshot}->>'workflowId' = ${table.workflowId}
        and ${table.startSnapshot}->>'workflowRevisionId' = ${table.workflowRevisionId}
        and ${table.startSnapshot}->'authorization'->>'principalId' = ${table.principalId}
        and ${table.startSnapshot}->'authorization'->>'keyId' = ${table.keyId}
        and ${table.startSnapshot}->'authorization'->>'evidenceRef' = ${table.authorizationEvidenceRef}
        and octet_length(${table.startSnapshot}::text) <= 1048576`,
    ),
    nextSequenceCheck: check(
      "workflow_runs_next_event_sequence_check",
      sql`${table.nextEventSequence} >= 2`,
    ),
    evidenceCheck: check(
      "workflow_runs_evidence_check",
      sql`length(${table.authorizationEvidenceRef}) between 1 and 200`,
    ),
    derivationCheck: check(
      "workflow_runs_derivation_check",
      sql`(
        ${table.sourceRunId} is null
          and ${table.rootRunId} is null
          and ${table.derivationDepth} = 0
          and ${table.derivation} is null
      ) or (
        ${table.sourceRunId} is not null
          and ${table.rootRunId} is not null
          and ${table.derivationDepth} > 0
          and ${table.derivationDepth} <= 100
          and jsonb_typeof(${table.derivation}) = 'object'
          and ${table.derivation}->>'kind' = 'manual_retry'
          and ${table.derivation}->>'sourceRunId' = ${table.sourceRunId}
          and ${table.derivation}->>'rootRunId' = ${table.rootRunId}
          and ${table.derivation}->>'sourceStartSnapshotDigest' ~ '^sha256:[0-9a-f]{64}$'
          and length(${table.derivation}->>'retryFromStepId') between 1 and 200
          and jsonb_typeof(${table.derivation}->'reusedOutputs') = 'array'
          and octet_length(${table.derivation}::text) <= 262144
      )`,
    ),
    finalSnapshotCheck: check(
      "workflow_runs_final_snapshot_check",
      sql`(
        ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
      ) or (
        ${table.finalSnapshot} is not null
          and ${table.finalSnapshotDigest} is not null
          and jsonb_typeof(${table.finalSnapshot}) = 'object'
          and ${table.finalSnapshot}->>'schema' = 'workflow-run-final-snapshot/v1'
          and ${table.finalSnapshot} ? 'runId'
          and ${table.finalSnapshot}->>'runId' = ${table.id}
          and ${table.finalSnapshot} ? 'startSnapshotDigest'
          and ${table.finalSnapshot}->>'startSnapshotDigest' = ${table.startSnapshotDigest}
          and jsonb_typeof(${table.finalSnapshot}->'stepAttempts') = 'array'
          and jsonb_typeof(${table.finalSnapshot}->'outputs') = 'object'
          and octet_length(${table.finalSnapshot}::text) <= 1048576
      )`,
    ),
    lifecycleCheck: check(
      "workflow_runs_lifecycle_check",
      sql`(
        ${table.state} = 'accepted'
          and ${table.startedAt} is null
          and ${table.completedAt} is null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
          and ${table.resumeAt} is null
          and ${table.failureCode} is null
      ) or (
        ${table.state} = 'running'
          and ${table.startedAt} is not null
          and ${table.completedAt} is null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
          and ${table.resumeAt} is null
          and ${table.failureCode} is null
      ) or (
        ${table.state} = 'waiting'
          and ${table.failureCode} = 'QUOTA_WAIT'
          and ${table.completedAt} is null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
      ) or (
        ${table.state} = 'waiting'
          and ${table.startedAt} is not null
          and ${table.completedAt} is null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
          and ${table.resumeAt} is not null
          and ${table.failureCode} is not null
      ) or (
        ${table.state} = 'outcome_unknown'
          and ${table.startedAt} is not null
          and ${table.completedAt} is null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
          and ${table.resumeAt} is null
          and ${table.failureCode} is not null
      ) or (
        ${table.state} = 'completed'
          and ${table.startedAt} is not null
          and ${table.completedAt} is not null
          and ${table.output} is not null
          and ${table.resumeAt} is null
          and ${table.failureCode} is null
      ) or (
        ${table.state} = 'failed'
          and ${table.startedAt} is not null
          and ${table.completedAt} is not null
          and ${table.output} is null
          and ${table.finalSnapshot} is null
          and ${table.finalSnapshotDigest} is null
          and ${table.resumeAt} is null
          and ${table.failureCode} is not null
      )`,
    ),
    failureCodeCheck: check(
      "workflow_runs_failure_code_check",
      sql`${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$'`,
    ),
  }),
);

/**
 * Durable semantic provider attempts. A Workflow SDK redelivery resumes the
 * same row and Effect Key; only a distinct semantic retry receives the next
 * attempt number.
 */
export const workflowStepAttempts = pgTable(
  "workflow_step_attempts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    stepId: text("step_id").notNull(),
    attempt: integer("attempt").notNull(),
    state: text("state").notNull(),
    operationIdentity: text("operation_identity").notNull(),
    operationContractDigest: text("operation_contract_digest").notNull(),
    provider: text("provider").notNull(),
    providerOperation: text("provider_operation").notNull(),
    model: text("model").notNull(),
    providerAdapterModule: text("provider_adapter_module"),
    providerAdapterContractDigest: text("provider_adapter_contract_digest"),
    launchSafety: jsonb("launch_safety")
      .$type<WorkflowStepAttemptRecord["launchSafety"]>(),
    intentDigest: text("intent_digest").notNull(),
    effectKey: text("effect_key").notNull(),
    inputs: jsonb("inputs").$type<WorkflowStepAttemptInput[]>().notNull(),
    outputs: jsonb("outputs")
      .$type<Record<string, WorkflowRunArtifactReference>>(),
    providerOperationRef: text("provider_operation_ref"),
    providerMetadata: jsonb("provider_metadata")
      .$type<WorkflowStepAttemptRecord["providerMetadata"]>(),
    outcome: jsonb("outcome")
      .$type<WorkflowStepAttemptRecord["outcome"]>(),
    reconciliation: jsonb("reconciliation")
      .$type<WorkflowStepAttemptRecord["reconciliation"]>(),
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex(
      "workflow_step_attempts_workspace_id_unique",
    ).on(table.workspaceId, table.id),
    workspaceRunIdUnique: uniqueIndex(
      "workflow_step_attempts_workspace_run_id_unique",
    ).on(table.workspaceId, table.runId, table.id),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_step_attempts_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceRunStepAttemptUnique: uniqueIndex(
      "workflow_step_attempts_workspace_run_step_attempt_unique",
    ).on(table.workspaceId, table.runId, table.stepId, table.attempt),
    workspaceEffectKeyIdx: index(
      "workflow_step_attempts_workspace_effect_key_idx",
    ).on(table.workspaceId, table.effectKey),
    workspaceRunStartedIdx: index(
      "workflow_step_attempts_workspace_run_started_idx",
    ).on(
      table.workspaceId,
      table.runId,
      table.startedAt,
      table.stepId,
      table.attempt,
    ),
    attemptCheck: check(
      "workflow_step_attempts_attempt_check",
      sql`${table.attempt} > 0`,
    ),
    stateCheck: check(
      "workflow_step_attempts_state_check",
      sql`${table.state} in ('running', 'outcome_unknown', 'completed', 'failed')`,
    ),
    operationIdentityCheck: check(
      "workflow_step_attempts_operation_identity_check",
      sql`${table.operationIdentity} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$'`,
    ),
    digestCheck: check(
      "workflow_step_attempts_digest_check",
      sql`${table.operationContractDigest} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.intentDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    identityFieldsCheck: check(
      "workflow_step_attempts_identity_fields_check",
      sql`length(${table.id}) between 1 and 200
        and length(${table.stepId}) between 1 and 200
        and length(${table.provider}) between 1 and 200
        and length(${table.providerOperation}) between 1 and 200
        and length(${table.model}) between 1 and 200
        and length(${table.effectKey}) between 1 and 500`,
    ),
    adapterIdentityCheck: check(
      "workflow_step_attempts_adapter_identity_check",
      sql`(
        ${table.providerAdapterModule} is null
        and ${table.providerAdapterContractDigest} is null
        and ${table.launchSafety} is null
      ) or (
        length(${table.providerAdapterModule}) between 1 and 200
        and ${table.providerAdapterContractDigest} ~ '^sha256:[0-9a-f]{64}$'
        and jsonb_typeof(${table.launchSafety}) = 'object'
        and octet_length(${table.launchSafety}::text) <= 1024
      )`,
    ),
    providerEvidenceCheck: check(
      "workflow_step_attempts_provider_evidence_check",
      sql`${table.providerOperationRef} is null or (
        length(${table.providerOperationRef}) between 1 and 500
        and ${table.providerOperationRef} = btrim(${table.providerOperationRef})
        and ${table.providerOperationRef} !~ '[[:cntrl:]]'
      )`,
    ),
    payloadCheck: check(
      "workflow_step_attempts_payload_check",
      sql`jsonb_typeof(${table.inputs}) = 'array'
        and octet_length(${table.inputs}::text) <= 262144
        and (
          ${table.outputs} is null
          or (
            jsonb_typeof(${table.outputs}) = 'object'
            and octet_length(${table.outputs}::text) <= 262144
          )
        )
        and (
          ${table.outcome} is null
          or (
            jsonb_typeof(${table.outcome}) = 'object'
            and octet_length(${table.outcome}::text) <= 4096
          )
        )
        and (
          ${table.reconciliation} is null
          or (
            jsonb_typeof(${table.reconciliation}) = 'object'
            and octet_length(${table.reconciliation}::text) <= 4096
          )
        )
        and (
          ${table.providerMetadata} is null
          or (
            jsonb_typeof(${table.providerMetadata}) = 'object'
            and octet_length(${table.providerMetadata}::text) <= 65536
            and (
              not (${table.providerMetadata} ? 'reportedCost')
              or ${table.providerMetadata}->'reportedCost' = 'null'::jsonb
              or (${table.providerMetadata}->'reportedCost'->>'evidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
            )
          )
        )`,
    ),
    lifecycleCheck: check(
      "workflow_step_attempts_lifecycle_check",
      sql`(
        ${table.state} = 'running'
          and ${table.outputs} is null
          and (
            (
              ${table.providerOperationRef} is null
              and ${table.outcome} is null
            ) or (
              ${table.providerOperationRef} is not null
              and ${table.outcome}->>'kind' = 'succeeded'
              and ${table.outcome}->>'providerOperationRef' = ${table.providerOperationRef}
            )
          )
          and ${table.reconciliation} is null
          and ${table.failureCode} is null
          and ${table.completedAt} is null
      ) or (
        ${table.state} = 'completed'
          and ${table.outputs} is not null
          and ${table.providerOperationRef} is not null
          and ${table.outcome}->>'kind' = 'succeeded'
          and ${table.outcome}->>'providerOperationRef' = ${table.providerOperationRef}
          and ${table.failureCode} is null
          and ${table.completedAt} is not null
          and ${table.completedAt} >= ${table.startedAt}
      ) or (
        ${table.state} = 'failed'
          and ${table.outputs} is null
          and ${table.outcome}->>'kind' = 'failed_known'
          and ${table.failureCode} is not null
          and ${table.outcome}->>'failureCode' = ${table.failureCode}
          and jsonb_typeof(${table.outcome}->'retryable') = 'boolean'
          and ${table.completedAt} is not null
          and ${table.completedAt} >= ${table.startedAt}
      ) or (
        ${table.state} = 'outcome_unknown'
          and ${table.outputs} is null
          and ${table.outcome}->>'kind' = 'outcome_unknown'
          and ${table.failureCode} is not null
          and ${table.outcome}->>'failureCode' = ${table.failureCode}
          and ${table.outcome} ? 'priorSucceededProviderOperationRef'
          and jsonb_typeof(${table.outcome}->'priorSucceededProviderOperationRef') in ('string', 'null')
          and (
            ${table.outcome}->>'priorSucceededProviderOperationRef' is null
            or (
              ${table.providerOperationRef} is not null
              and ${table.outcome}->>'priorSucceededProviderOperationRef' = ${table.providerOperationRef}
            )
          )
          and ${table.completedAt} is null
      )`,
    ),
    failureCodeCheck: check(
      "workflow_step_attempts_failure_code_check",
      sql`${table.failureCode} is null or ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,79}$'`,
    ),
  }),
);

/**
 * Generated Artifact provenance is normalized away from the Artifact resource
 * row so imported and generated lifecycles remain structurally distinct.
 * Provider payloads and credentials are never persisted here.
 */
export const artifactGeneratedOrigins = pgTable(
  "artifact_generated_origins",
  {
    workspaceId: text("workspace_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    artifactOrigin: text("artifact_origin")
      .default("generated")
      .notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowRevisionId: text("workflow_revision_id").notNull(),
    workflowRevision: integer("workflow_revision").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    runId: text("run_id").notNull(),
    runStartSnapshotDigest: text(
      "run_start_snapshot_digest",
    ).notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    stepId: text("step_id").notNull(),
    attempt: integer("attempt").notNull(),
    provider: text("provider").notNull(),
    operationIdentity: text("operation_identity").notNull(),
    providerOperation: text("provider_operation").notNull(),
    providerOperationRef: text("provider_operation_ref").notNull(),
    model: text("model").notNull(),
    intentDigest: text("intent_digest").notNull(),
    providerMetadata: jsonb("provider_metadata").$type<ArtifactProviderMetadata>(),
    effectKey: text("effect_key").notNull(),
    outputName: text("output_name").notNull(),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.artifactId],
      name: "artifact_generated_origins_pk",
    }),
    workspaceArtifactFk: foreignKey({
      columns: [
        table.workspaceId,
        table.artifactId,
        table.artifactOrigin,
      ],
      foreignColumns: [
        artifacts.workspaceId,
        artifacts.id,
        artifacts.origin,
      ],
      name: "artifact_generated_origins_workspace_artifact_fk",
    }).onDelete("restrict"),
    workspaceWorkflowRevisionFk: foreignKey({
      columns: [
        table.workspaceId,
        table.workflowId,
        table.workflowRevisionId,
      ],
      foreignColumns: [
        contentWorkflowRevisions.workspaceId,
        contentWorkflowRevisions.workflowId,
        contentWorkflowRevisions.id,
      ],
      name: "artifact_generated_origins_workspace_revision_fk",
    }).onDelete("restrict"),
    workspaceWorkflowRunFk: foreignKey({
      columns: [table.workspaceId, table.workflowId, table.runId],
      foreignColumns: [
        workflowRuns.workspaceId,
        workflowRuns.workflowId,
        workflowRuns.id,
      ],
      name: "artifact_generated_origins_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceStepAttemptFk: foreignKey({
      columns: [
        table.workspaceId,
        table.runId,
        table.stepAttemptId,
      ],
      foreignColumns: [
        workflowStepAttempts.workspaceId,
        workflowStepAttempts.runId,
        workflowStepAttempts.id,
      ],
      name: "artifact_generated_origins_workspace_attempt_fk",
    }).onDelete("restrict"),
    workspaceEffectOutputUnique: uniqueIndex(
      "artifact_generated_origins_workspace_effect_output_unique",
    ).on(table.workspaceId, table.effectKey, table.outputName),
    workspaceGenerationIdentityUnique: uniqueIndex(
      "artifact_generated_origins_workspace_generation_identity_unique",
    ).on(
      table.workspaceId,
      table.artifactId,
      table.runId,
      table.stepAttemptId,
      table.effectKey,
      table.outputName,
    ),
    workspaceRunIdx: index(
      "artifact_generated_origins_workspace_run_idx",
    ).on(
      table.workspaceId,
      table.runId,
      table.stepAttemptId,
      table.outputName,
    ),
    revisionAttemptCheck: check(
      "artifact_generated_origins_revision_attempt_check",
      sql`${table.workflowRevision} > 0 and ${table.attempt} > 0`,
    ),
    providerMetadataSizeCheck: check(
      "artifact_generated_origins_provider_metadata_size_check",
      sql`${table.providerMetadata} is null or (jsonb_typeof(${table.providerMetadata}) = 'object' and octet_length(${table.providerMetadata}::text) <= 65536)`,
    ),
    providerMetadataRedactionCheck: check(
      "artifact_generated_origins_provider_metadata_redaction_check",
      sql`${table.providerMetadata} is null or (
        ${table.providerMetadata}::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\\s*:'
        and (
          not (${table.providerMetadata} ? 'reportedCost')
          or ${table.providerMetadata}->'reportedCost' = 'null'::jsonb
          or (${table.providerMetadata}->'reportedCost'->>'evidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
        )
      )`,
    ),
    artifactOriginCheck: check(
      "artifact_generated_origins_artifact_origin_check",
      sql`${table.artifactOrigin} = 'generated'`,
    ),
    digestCheck: check(
      "artifact_generated_origins_digest_check",
      sql`${table.definitionDigest} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.runStartSnapshotDigest} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.intentDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    identityCheck: check(
      "artifact_generated_origins_identity_check",
      sql`length(${table.stepId}) between 1 and 200
        and length(${table.provider}) between 1 and 200
        and length(${table.operationIdentity}) between 1 and 300
        and length(${table.providerOperation}) between 1 and 300
        and length(${table.providerOperationRef}) between 1 and 500
        and length(${table.model}) between 1 and 300
        and length(${table.effectKey}) between 1 and 500
        and length(${table.outputName}) between 1 and 200
        and btrim(${table.effectKey}) = ${table.effectKey}
        and btrim(${table.outputName}) = ${table.outputName}
        and btrim(${table.providerOperationRef}) = ${table.providerOperationRef}
        and ${table.effectKey} !~ '[[:cntrl:]]'
        and ${table.providerOperationRef} !~ '[[:cntrl:]]'
        and ${table.outputName} !~ '[[:cntrl:]]'`,
    ),
  }),
);

export const artifactLineageInputs = pgTable(
  "artifact_lineage_inputs",
  {
    workspaceId: text("workspace_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    position: integer("position").notNull(),
    port: text("port").notNull(),
    kind: text("kind").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceInputName: text("source_input_name"),
    sourceRunId: text("source_run_id"),
    sourceStepAttemptId: text("source_step_attempt_id"),
    sourceOutputName: text("source_output_name"),
    contentDigest: text("content_digest").notNull(),
    sourceArtifactId: text("source_artifact_id"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.artifactId, table.position],
      name: "artifact_lineage_inputs_pk",
    }),
    workspaceGeneratedArtifactFk: foreignKey({
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [
        artifactGeneratedOrigins.workspaceId,
        artifactGeneratedOrigins.artifactId,
      ],
      name: "artifact_lineage_inputs_workspace_generated_fk",
    }).onDelete("restrict"),
    workspaceSourceArtifactFk: foreignKey({
      columns: [
        table.workspaceId,
        table.sourceArtifactId,
        table.kind,
        table.contentDigest,
      ],
      foreignColumns: [
        artifacts.workspaceId,
        artifacts.id,
        artifacts.kind,
        artifacts.contentDigest,
      ],
      name: "artifact_lineage_inputs_workspace_source_artifact_fk",
    }).onDelete("restrict"),
    workspaceSourceAttemptFk: foreignKey({
      columns: [
        table.workspaceId,
        table.sourceRunId,
        table.sourceStepAttemptId,
      ],
      foreignColumns: [
        workflowStepAttempts.workspaceId,
        workflowStepAttempts.runId,
        workflowStepAttempts.id,
      ],
      name: "artifact_lineage_inputs_workspace_source_attempt_fk",
    }).onDelete("restrict"),
    workspaceSourceIdx: index(
      "artifact_lineage_inputs_workspace_source_idx",
    ).on(table.workspaceId, table.sourceArtifactId),
    positionCheck: check(
      "artifact_lineage_inputs_position_check",
      sql`${table.position} >= 0`,
    ),
    kindCheck: check(
      "artifact_lineage_inputs_kind_check",
      sql`${table.kind} in ('text', 'image')`,
    ),
    digestCheck: check(
      "artifact_lineage_inputs_digest_check",
      sql`${table.contentDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    portCheck: check(
      "artifact_lineage_inputs_port_check",
      sql`length(${table.port}) between 1 and 200
        and btrim(${table.port}) = ${table.port}
        and ${table.port} !~ '[[:cntrl:]]'`,
    ),
    sourceCheck: check(
      "artifact_lineage_inputs_source_check",
      sql`(
        ${table.sourceKind} = 'workflow_input'
        and ${table.sourceInputName} is not null
        and length(${table.sourceInputName}) between 1 and 200
        and ${table.sourceRunId} is null
        and ${table.sourceStepAttemptId} is null
        and ${table.sourceOutputName} is null
      ) or (
        ${table.sourceKind} = 'step_output'
        and ${table.sourceInputName} is null
        and ${table.sourceRunId} is not null
        and ${table.sourceStepAttemptId} is not null
        and ${table.sourceOutputName} is not null
        and length(${table.sourceOutputName}) between 1 and 200
        and ${table.sourceArtifactId} is not null
      )`,
    ),
  }),
);

export const workflowRunEvents = pgTable(
  "workflow_run_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceRunSequenceUnique: uniqueIndex(
      "workflow_run_events_workspace_run_sequence_unique",
    ).on(table.workspaceId, table.runId, table.sequence),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_run_events_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceRunIdx: index("workflow_run_events_workspace_run_idx").on(
      table.workspaceId,
      table.runId,
      table.sequence,
    ),
    sequenceCheck: check(
      "workflow_run_events_sequence_check",
      sql`${table.sequence} > 0`,
    ),
    typeCheck: check(
      "workflow_run_events_type_check",
      sql`${table.type} in (
        'run.accepted',
        'run.derived',
        'step.attempt.started',
        'artifact.generated',
        'step.attempt.completed',
        'step.attempt.failed',
        'step.retry.scheduled',
        'step.attempt.outcome_unknown',
        'step.attempt.reconciled',
        'run.waiting',
        'run.resumed',
        'run.outcome_unknown',
        'step.completed',
        'run.completed',
        'run.failed'
      )`,
    ),
    dataSizeCheck: check(
      "workflow_run_events_data_size_check",
      sql`jsonb_typeof(${table.data}) = 'object' and octet_length(${table.data}::text) <= 65536`,
    ),
  }),
);

export const workflowRunMutationReceipts = pgTable(
  "workflow_run_mutation_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull(),
    authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    runId: text("run_id").notNull(),
    initialEventCursor: text("initial_event_cursor").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.capability,
        table.idempotencyKey,
      ],
      name: "workflow_run_mutation_receipts_pk",
    }),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "workflow_run_mutation_receipts_workspace_principal_fk",
    }).onDelete("restrict"),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_run_mutation_receipts_workspace_run_fk",
    }).onDelete("restrict"),
    authorizationEvidenceFk: foreignKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.keyId,
        table.authorizationEvidenceRef,
      ],
      foreignColumns: [
        agentAuthorizationDecisions.workspaceId,
        agentAuthorizationDecisions.principalId,
        agentAuthorizationDecisions.keyId,
        agentAuthorizationDecisions.operatorTraceRef,
      ],
      name: "workflow_run_mutation_receipts_authorization_evidence_fk",
    }).onDelete("restrict"),
    workspaceCreatedIdx: index(
      "workflow_run_mutation_receipts_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    capabilityCheck: check(
      "workflow_run_mutation_receipts_capability_check",
      sql`${table.capability} in (
        'workflow_runs.start@1',
        'workflow_runs.start@2',
        'workflow_runs.start@3',
        'workflow_runs.retry@1',
        'workflow_runs.reconcile@1',
        'workflow_runs.resume@1'
      )`,
    ),
    idempotencyKeyCheck: check(
      "workflow_run_mutation_receipts_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 8 and 200 and ${table.idempotencyKey} ~ '^[!-~]+$'`,
    ),
    fingerprintCheck: check(
      "workflow_run_mutation_receipts_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    authorizationEvidenceCheck: check(
      "workflow_run_mutation_receipts_authorization_evidence_check",
      sql`length(${table.keyId}) between 1 and 200
        and length(${table.authorizationEvidenceRef}) between 1 and 200`,
    ),
    cursorCheck: check(
      "workflow_run_mutation_receipts_cursor_check",
      sql`length(${table.initialEventCursor}) between 1 and 2048`,
    ),
    resultCheck: check(
      "workflow_run_mutation_receipts_result_check",
      sql`(
        ${table.capability} in (
          'workflow_runs.start@1',
          'workflow_runs.start@2',
          'workflow_runs.start@3'
        )
        and ${table.result} is null
      ) or (
        ${table.capability} in (
          'workflow_runs.retry@1',
          'workflow_runs.reconcile@1',
          'workflow_runs.resume@1'
        )
        and jsonb_typeof(${table.result}) = 'object'
        and ${table.result}->'run'->>'id' = ${table.runId}
        and ${table.result}->'inspect'->>'capability' = 'workflow_runs.get@1'
        and ${table.result}->'inspect'->'input'->>'runId' = ${table.runId}
        and ${table.result}->'events'->>'capability' = 'workflow_run_events.list@1'
        and ${table.result}->'events'->'input'->>'runId' = ${table.runId}
        and ${table.result}->'events'->'input'->>'cursor' = ${table.initialEventCursor}
        and octet_length(${table.result}::text) <= 2097152
      )`,
    ),
  }),
);

export const workflowRunOutboxIntents = pgTable(
  "workflow_run_outbox_intents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    generation: integer("generation").default(1).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state").notNull(),
    deliveryToken: text("delivery_token"),
    deliveryAttempts: integer("delivery_attempts").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceRunGenerationUnique: uniqueIndex(
      "workflow_run_outbox_intents_workspace_run_generation_unique",
    ).on(table.workspaceId, table.runId, table.generation),
    dedupeKeyUnique: uniqueIndex(
      "workflow_run_outbox_intents_dedupe_key_unique",
    ).on(table.dedupeKey),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_run_outbox_intents_workspace_run_fk",
    }).onDelete("restrict"),
    deliveryIdx: index("workflow_run_outbox_intents_delivery_idx").on(
      table.state,
      table.availableAt,
      table.createdAt,
      table.id,
    ),
    stateCheck: check(
      "workflow_run_outbox_intents_state_check",
      sql`${table.state} in ('pending', 'delivering', 'delivered')`,
    ),
    attemptsCheck: check(
      "workflow_run_outbox_intents_attempts_check",
      sql`${table.deliveryAttempts} >= 0 and ${table.generation} > 0`,
    ),
    lifecycleCheck: check(
      "workflow_run_outbox_intents_lifecycle_check",
      sql`(
        ${table.state} = 'pending'
          and ${table.deliveryToken} is null
          and ${table.claimedAt} is null
          and ${table.deliveredAt} is null
      ) or (
        ${table.state} = 'delivering'
          and ${table.deliveryToken} is not null
          and ${table.claimedAt} is not null
          and ${table.deliveredAt} is null
      ) or (
        ${table.state} = 'delivered'
          and ${table.deliveryToken} is null
          and ${table.claimedAt} is not null
          and ${table.deliveredAt} is not null
      )`,
    ),
  }),
);

export const workflowRunExecutionLeases = pgTable(
  "workflow_run_execution_leases",
  {
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    fence: bigint("fence", { mode: "bigint" }).notNull(),
    workerId: text("worker_id").notNull(),
    token: text("token").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.runId],
      name: "workflow_run_execution_leases_pk",
    }),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_run_execution_leases_workspace_run_fk",
    }).onDelete("restrict"),
    expiryIdx: index("workflow_run_execution_leases_expiry_idx").on(
      table.expiresAt,
    ),
    fenceCheck: check(
      "workflow_run_execution_leases_fence_check",
      sql`${table.fence} > 0`,
    ),
    timeCheck: check(
      "workflow_run_execution_leases_time_check",
      sql`${table.expiresAt} > ${table.acquiredAt}
        and (${table.releasedAt} is null or ${table.releasedAt} >= ${table.acquiredAt})`,
    ),
  }),
);

export const agentSecurityEvents = pgTable(
  "agent_security_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").references(() => agentPrincipals.id, {
      onDelete: "restrict",
    }),
    keyId: text("key_id").references(() => agentKeys.id, {
      onDelete: "restrict",
    }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    systemActorId: text("system_actor_id"),
    initiatingUserId: text("initiating_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    eventType: text("event_type").notNull(),
    capabilityName: text("capability_name").notNull(),
    capabilityVersion: integer("capability_version").notNull(),
    reason: text("reason").notNull(),
    resourceKinds: jsonb("resource_kinds").$type<string[]>().notNull(),
    changeRef: text("change_ref"),
    revision: integer("revision"),
    principalStatus: text("principal_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index(
      "agent_security_events_workspace_created_idx",
    ).on(table.workspaceId, table.createdAt),
    principalCreatedIdx: index(
      "agent_security_events_principal_created_idx",
    ).on(table.principalId, table.createdAt),
    systemActorCheck: check(
      "agent_security_events_system_actor_check",
      sql`${table.systemActorId} is null or (${table.actorUserId} is null and ${table.systemActorId} = 'tasmeemai:builtin-service-authority@1' and ${table.initiatingUserId} is not null)`,
    ),
  }),
);

export const agentAuthorityProvisioningReceipts = pgTable(
  "agent_authority_provisioning_receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    requestId: text("request_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    keyId: text("key_id")
      .notNull()
      .references(() => agentKeys.id, { onDelete: "restrict" }),
    grantSetId: text("grant_set_id")
      .notNull()
      .references(() => agentGrantSets.id, { onDelete: "restrict" }),
    grantRevisionId: text("grant_revision_id")
      .notNull()
      .references(() => agentGrantRevisions.id, { onDelete: "restrict" }),
    grantRevision: integer("grant_revision").notNull(),
    policyRevisionId: text("policy_revision_id")
      .notNull()
      .references(() => workspaceAgentPolicyRevisions.id, {
        onDelete: "restrict",
      }),
    policyRevision: integer("policy_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    requestUnique: uniqueIndex(
      "agent_authority_provisioning_receipts_request_unique",
    ).on(table.workspaceId, table.actorUserId, table.requestId),
  }),
);

export const builtInAgentAuthorityProvisioningReceipts = pgTable(
  "built_in_agent_authority_provisioning_receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    systemActorId: text("system_actor_id").notNull(),
    initiatingUserId: text("initiating_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    sponsorUserId: text("sponsor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull().references(() => agentKeys.id, { onDelete: "restrict" }),
    grantSetId: text("grant_set_id").notNull().references(() => agentGrantSets.id, { onDelete: "restrict" }),
    grantRevisionId: text("grant_revision_id").notNull().references(() => agentGrantRevisions.id, { onDelete: "restrict" }),
    grantRevision: integer("grant_revision").notNull(),
    policyRevisionId: text("policy_revision_id").notNull().references(() => workspaceAgentPolicyRevisions.id, { onDelete: "restrict" }),
    policyRevision: integer("policy_revision").notNull(),
    capability: text("capability").notNull(),
    authorizationContractDigest: text("authorization_contract_digest").notNull(),
    resources: jsonb("resources").$type<StoredAgentResourceConstraints>().notNull(),
    requestId: text("request_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    principalFk: foreignKey({
      name: "built_in_agent_authority_receipts_principal_fk",
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
    }).onDelete("restrict"),
    keyFk: foreignKey({
      name: "built_in_agent_authority_receipts_key_fk",
      columns: [table.principalId, table.keyId],
      foreignColumns: [agentKeys.principalId, agentKeys.id],
    }).onDelete("restrict"),
    grantSetFk: foreignKey({
      name: "built_in_agent_authority_receipts_grant_set_fk",
      columns: [table.workspaceId, table.principalId, table.grantSetId],
      foreignColumns: [agentGrantSets.workspaceId, agentGrantSets.principalId, agentGrantSets.id],
    }).onDelete("restrict"),
    grantRevisionFk: foreignKey({
      name: "built_in_agent_authority_receipts_grant_revision_fk",
      columns: [table.grantSetId, table.grantRevisionId],
      foreignColumns: [agentGrantRevisions.grantSetId, agentGrantRevisions.id],
    }).onDelete("restrict"),
    policyRevisionFk: foreignKey({
      name: "built_in_agent_authority_receipts_policy_revision_fk",
      columns: [table.workspaceId, table.policyRevisionId],
      foreignColumns: [workspaceAgentPolicyRevisions.workspaceId, workspaceAgentPolicyRevisions.id],
    }).onDelete("restrict"),
    requestUnique: uniqueIndex("built_in_agent_authority_receipts_request_unique").on(table.workspaceId, table.purpose, table.requestId),
    keyUnique: uniqueIndex("built_in_agent_authority_receipts_key_unique").on(table.keyId),
    initiatorIdx: index("built_in_agent_authority_receipts_initiator_idx").on(table.workspaceId, table.initiatingUserId, table.createdAt),
    purposeCheck: check("built_in_agent_authority_receipts_purpose_check", sql`(${table.purpose} = 'content_workflow' and ${table.capability} in ('workflow_runs.start@2', 'workflow_runs.start@3')) or (${table.purpose} = 'calendar_reschedule' and ${table.capability} = 'publishing_plan_revisions.create@1')`),
    actorCheck: check("built_in_agent_authority_receipts_actor_check", sql`${table.systemActorId} = 'tasmeemai:builtin-service-authority@1'`),
    digestCheck: check("built_in_agent_authority_receipts_digest_check", sql`${table.authorizationContractDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`),
    revisionCheck: check("built_in_agent_authority_receipts_revision_check", sql`${table.grantRevision} > 0 and ${table.policyRevision} > 0`),
    resourcesCheck: check("built_in_agent_authority_receipts_resources_check", sql`jsonb_typeof(${table.resources}) = 'object' and ${table.resources} ?& array['channelIds','credentialProfileIds','workflowIds','automationIds','artifactIds'] and (${table.resources} - array['channelIds','credentialProfileIds','workflowIds','automationIds','studioAssetIds','artifactIds']) = '{}'::jsonb and jsonb_typeof(${table.resources}->'channelIds') = 'array' and jsonb_typeof(${table.resources}->'credentialProfileIds') = 'array' and jsonb_typeof(${table.resources}->'workflowIds') = 'array' and jsonb_typeof(${table.resources}->'automationIds') = 'array' and (not (${table.resources} ? 'studioAssetIds') or jsonb_typeof(${table.resources}->'studioAssetIds') = 'array') and jsonb_typeof(${table.resources}->'artifactIds') = 'array' and (${table.capability} <> 'workflow_runs.start@3' or ${table.resources} ? 'studioAssetIds') and ((${table.purpose} = 'content_workflow' and ${table.resources}->'channelIds' = '[]'::jsonb and ${table.resources}->'credentialProfileIds' = '[]'::jsonb and ${table.resources}->'automationIds' = '[]'::jsonb) or (${table.purpose} = 'calendar_reschedule' and ${table.resources}->'credentialProfileIds' = '[]'::jsonb and ${table.resources}->'workflowIds' = '[]'::jsonb and ${table.resources}->'automationIds' = '[]'::jsonb and (not (${table.resources} ? 'studioAssetIds') or ${table.resources}->'studioAssetIds' = '[]'::jsonb)))`),
  }),
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").default("active").notNull(),
    sourceDirectoryPath: text("source_directory_path"),
    workflowJson: jsonb("workflow_json").$type<Record<string, unknown>>(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceSlugUnique: uniqueIndex("projects_workspace_slug_unique").on(
      table.workspaceId,
      table.slug,
    ),
    workspaceIdx: index("projects_workspace_idx").on(table.workspaceId),
    updatedIdx: index("projects_updated_idx").on(table.updatedAt),
  }),
);

/**
 * Form-driven project runs retained for the headless API/MCP/CLI generation
 * surface. This is intentionally separate from the canonical agent-runtime
 * `workflow_runs` event stream.
 */
export const projectWorkflowRuns = pgTable(
  "project_workflow_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    status: generationStatusEnum("status").default("queued").notNull(),
    progress: jsonb("progress").$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>[]>(),
    inputOverrides: jsonb("input_overrides").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("project_workflow_runs_workspace_idx").on(
      table.workspaceId,
    ),
    projectIdx: index("project_workflow_runs_project_idx").on(table.projectId),
    statusIdx: index("project_workflow_runs_status_idx").on(table.status),
    createdAtIdx: index("project_workflow_runs_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    type: assetTypeEnum("type").notNull(),
    storageProvider: storageProviderEnum("storage_provider").notNull(),
    storageBucket: text("storage_bucket"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    checksum: text("checksum"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceIdx: index("assets_workspace_idx").on(table.workspaceId),
    workspaceIdUnique: uniqueIndex("assets_workspace_id_unique").on(table.workspaceId, table.id),
    projectIdx: index("assets_project_idx").on(table.projectId),
    storageIdx: uniqueIndex("assets_storage_provider_key_unique").on(
      table.storageProvider,
      table.storageKey,
    ),
    createdAtIdx: index("assets_created_at_idx").on(table.createdAt),
  }),
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    type: assetTypeEnum("type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    prompt: text("prompt"),
    status: generationStatusEnum("status").default("queued").notNull(),
    costCents: integer("cost_cents"),
    resultAssetId: text("result_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("generation_jobs_workspace_idx").on(table.workspaceId),
    projectIdx: index("generation_jobs_project_idx").on(table.projectId),
    statusIdx: index("generation_jobs_status_idx").on(table.status),
    createdAtIdx: index("generation_jobs_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Social Hub domain tables (workspace-scoped).
 */
export const socialPlatformEnum = pgEnum("social_platform", [
  "x",
  "linkedin",
  "instagram",
  "tiktok",
  "threads",
  "pinterest",
  "facebook",
  "youtube",
  "reddit",
  "bluesky",
  "mastodon",
]);

export const socialPostStatusEnum = pgEnum("social_post_status", [
  "draft",
  "queued",
  "publishing",
  "published",
  "failed",
]);

export const socialDispatchStatusEnum = pgEnum("social_dispatch_status", [
  "pending",
  "dispatched",
  "retry_scheduled",
  "failed",
]);

export const socialEventTypeEnum = pgEnum("social_event_type", [
  "post.queued",
  "post.publishing",
  "post.published",
  "post.failed",
  "account.reauth_required",
  "token.refreshed",
  "dispatch.failed",
]);

export const socialEventSeverityEnum = pgEnum("social_event_severity", [
  "info",
  "warn",
  "error",
]);

export const socialWebhookDeliveryStatusEnum = pgEnum(
  "social_webhook_delivery_status",
  ["pending", "success", "failed"],
);
export const socialDispatchRunStateEnum = pgEnum("social_dispatch_run_state", [
  "pending",
  "claimed",
  "succeeded",
  "failed",
]);
export const socialTokenRefreshLeaseStateEnum = pgEnum(
  "social_token_refresh_lease_state",
  ["active", "released", "expired"],
);
export const socialWebhookDeadLetterReplayStateEnum = pgEnum(
  "social_webhook_dead_letter_replay_state",
  ["dead_lettered", "replay_requested", "replayed", "failed"],
);
export const automationTaskStateEnum = pgEnum("automation_task_state", [
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "cancelled",
]);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatformEnum("platform").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    displayName: text("display_name").notNull(),
    username: text("username"),
    avatarUrl: text("avatar_url"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessTokenSecret: text("access_token_secret"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    additionalSettings: jsonb("additional_settings").$type<
      Record<string, unknown>
    >(),
    requiresReauth: boolean("requires_reauth").default(false).notNull(),
    disabled: boolean("disabled").default(false).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspacePlatformUserUnique: uniqueIndex(
      "social_accounts_workspace_platform_user_unique",
    ).on(table.workspaceId, table.platform, table.platformUserId),
    workspaceIdUnique: uniqueIndex("social_accounts_workspace_id_unique").on(table.workspaceId, table.id),
    workspaceIdx: index("social_accounts_workspace_idx").on(table.workspaceId),
    consentExpiryIdx: index("social_accounts_consent_expiry_idx")
      .on(table.tokenExpiresAt, table.id)
      .where(sql`${table.disabled} = false and ${table.requiresReauth} = false and ${table.tokenExpiresAt} is not null`),
    createdAtIdx: index("social_accounts_created_at_idx").on(table.createdAt),
  }),
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    status: socialPostStatusEnum("status").default("draft").notNull(),
    rootPostId: text("root_post_id"),
    dispatchStatus: socialDispatchStatusEnum("dispatch_status"),
    dispatchAttempts: integer("dispatch_attempts").default(0).notNull(),
    workflowRunRef: text("workflow_run_ref"),
    nextDispatchAt: timestamp("next_dispatch_at", { withTimezone: true }),
    lastDispatchError: text("last_dispatch_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    kind: text("kind").default("post").notNull(),
    delaySeconds: integer("delay_seconds"),
    position: integer("position"),
    sourceTemplatePostId: text("source_template_post_id"),
    triggerSource: text("trigger_source"),
    content: text("content"),
    mediaUrls: jsonb("media_urls").$type<
      Array<{ type: string; url: string; alt?: string }>
    >(),
    /** Ordered, digest-bound canonical media relation used by portability. */
    stableMediaRefs: jsonb("stable_media_refs")
      .$type<
        Array<{
          resourceKind?: "studio_asset" | "artifact";
          assetId: string;
          assetDigest: string;
          order: number;
          alt?: string;
        }>
      >()
      .default([])
      .notNull(),
    platformSettings: jsonb("platform_settings").$type<
      Record<string, unknown>
    >(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    platformPostId: text("platform_post_id"),
    platformPostUrl: text("platform_post_url"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0).notNull(),
    parentPostId: text("parent_post_id"),
    studioAssetId: text("studio_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_posts_workspace_idx").on(table.workspaceId),
    workspaceIdUnique: uniqueIndex("social_posts_workspace_id_unique").on(table.workspaceId, table.id),
    socialAccountIdx: index("social_posts_account_idx").on(
      table.socialAccountId,
    ),
    rootPostIdx: index("social_posts_root_post_idx").on(table.rootPostId),
    sourceTemplatePostIdx: index(
      "social_posts_source_template_post_idx",
    ).on(table.sourceTemplatePostId),
    kindIdx: index("social_posts_kind_idx").on(table.kind),
    triggerSourceIdx: index("social_posts_trigger_source_idx").on(
      table.triggerSource,
    ),
    statusIdx: index("social_posts_status_idx").on(table.status),
    dispatchStatusIdx: index("social_posts_dispatch_status_idx").on(
      table.dispatchStatus,
    ),
    nextDispatchAtIdx: index("social_posts_next_dispatch_at_idx").on(
      table.nextDispatchAt,
    ),
    scheduledAtIdx: index("social_posts_scheduled_at_idx").on(
      table.scheduledAt,
    ),
    createdAtIdx: index("social_posts_created_at_idx").on(table.createdAt),
    stableMediaRefsArrayCheck: check(
      "social_posts_stable_media_refs_array_check",
      sql`jsonb_typeof(${table.stableMediaRefs}) = 'array'`,
    ),
  }),
);

export const socialOAuthStates = pgTable(
  "social_oauth_states",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    platform: socialPlatformEnum("platform").notNull(),
    state: text("state").notNull(),
    codeVerifier: text("code_verifier"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    stateUnique: uniqueIndex("social_oauth_states_state_unique").on(
      table.state,
    ),
    expiresAtIdx: index("social_oauth_states_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const socialOAuthSelectionSessions = pgTable(
  "social_oauth_selection_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatformEnum("platform").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessTokenSecret: text("access_token_secret"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_oauth_selection_sessions_workspace_idx").on(
      table.workspaceId,
    ),
    expiresAtIdx: index("social_oauth_selection_sessions_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const socialMastodonInstances = pgTable(
  "social_mastodon_instances",
  {
    id: text("id").primaryKey(),
    instanceUrl: text("instance_url").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    maxCharacters: integer("max_characters").notNull().default(500),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    instanceUrlUnique: uniqueIndex(
      "social_mastodon_instances_url_unique",
    ).on(table.instanceUrl),
  }),
);

export const socialEvents = pgTable(
  "social_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: socialEventTypeEnum("event_type").notNull(),
    severity: socialEventSeverityEnum("severity").default("info").notNull(),
    message: text("message").notNull(),
    userFacing: boolean("user_facing").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    postId: text("post_id").references(() => socialPosts.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    provider: socialPlatformEnum("provider"),
    dispatchKey: text("dispatch_key"),
    workflowRunRef: text("workflow_run_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_events_workspace_idx").on(table.workspaceId),
    eventTypeIdx: index("social_events_event_type_idx").on(table.eventType),
    userFacingIdx: index("social_events_user_facing_idx").on(table.userFacing),
    readAtIdx: index("social_events_read_at_idx").on(table.readAt),
    postIdx: index("social_events_post_idx").on(table.postId),
    accountIdx: index("social_events_account_idx").on(table.accountId),
    createdAtIdx: index("social_events_created_at_idx").on(table.createdAt),
    notificationCursorIdx: index("social_events_notification_cursor_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.userFacing} = true and ${table.eventType} in ('account.reauth_required','post.failed','dispatch.failed')`),
  }),
);

/** Explicit Workspace-owned performance observations used to identify reusable
 * winning content. These are never inferred from arbitrary social event
 * metadata, and every row pins the exact published post, ready Studio Asset,
 * and Rights Snapshot that can later enter the Inspiration/Blitz pipeline. */
export const workspaceContentPerformanceObservations = pgTable(
  "workspace_content_performance_observations",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    postId: text("post_id").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    rightsSnapshotId: text("rights_snapshot_id").notNull(),
    rightsSnapshotRevision: integer("rights_snapshot_revision").notNull(),
    rightsSnapshotDigest: text("rights_snapshot_digest").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceDigest: text("source_digest").notNull(),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    platform: socialPlatformEnum("platform"),
    providerAccountId: text("provider_account_id"),
    providerPostId: text("provider_post_id"),
    providerRequestId: text("provider_request_id"),
    reportedMetrics: jsonb("reported_metrics").$type<string[]>().default([]).notNull(),
    providerReceipt: jsonb("provider_receipt").$type<Record<string, unknown>>().default({}).notNull(),
    region: text("region").notNull(),
    contentLanguage: text("content_language").notNull(),
    arabicVariety: text("arabic_variety"),
    format: text("format").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "workspace_content_performance_observations_pk", columns: [table.workspaceId, table.id] }),
    idempotencyUnique: uniqueIndex("workspace_content_performance_observations_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
    postFk: foreignKey({ name: "workspace_content_performance_observations_post_fk", columns: [table.workspaceId, table.postId], foreignColumns: [socialPosts.workspaceId, socialPosts.id] }).onDelete("restrict"),
    assetFk: foreignKey({ name: "workspace_content_performance_observations_asset_fk", columns: [table.workspaceId, table.sourceAssetId], foreignColumns: [assets.workspaceId, assets.id] }).onDelete("restrict"),
    cursorIdx: index("workspace_content_performance_observations_cursor_idx").on(table.workspaceId, table.observedAt.desc(), table.id.desc()),
    postCursorIdx: index("workspace_content_performance_observations_post_cursor_idx").on(table.workspaceId, table.postId, table.observedAt.desc(), table.id.desc()),
    assetIdx: index("workspace_content_performance_observations_asset_idx").on(table.workspaceId, table.sourceAssetId),
    sourceDigestUnique: uniqueIndex("workspace_content_performance_observations_verified_digest_unique").on(table.workspaceId, table.sourceDigest).where(sql`${table.sourceKind} = 'platform_verified'`),
    valuesCheck: check("workspace_content_performance_observations_values_check", sql`${table.sourceKind} in ('workspace_attested','platform_verified') and length(${table.sourceRef}) between 1 and 500 and ${table.sourceDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.rightsSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.rightsSnapshotRevision} > 0 and (${table.views} is null or ${table.views} between 0 and 9007199254740991) and (${table.likes} is null or ${table.likes} between 0 and 9007199254740991) and (${table.comments} is null or ${table.comments} between 0 and 9007199254740991) and (${table.views} is not null or ${table.likes} is not null or ${table.comments} is not null) and ${table.contentLanguage} in ('ar','en') and (${table.arabicVariety} is null or ${table.arabicVariety} in ('msa','gulf','egyptian','levantine','maghrebi')) and ${table.format} in ('slideshow','wall_of_text','video_hook_demo','speaking_hook_demo','talking_head_ugc','green_screen_meme','talking_head_green_screen','product_spokesperson','green_screen_mobile_app','claymation','character_swap','custom_upload') and jsonb_typeof(${table.tags}) = 'array' and jsonb_typeof(${table.reportedMetrics}) = 'array' and jsonb_typeof(${table.providerReceipt}) = 'object' and ${table.observedAt} <= ${table.capturedAt} and length(${table.idempotencyKey}) between 8 and 200 and ${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const workspaceContentPerformanceSyncs = pgTable(
  "workspace_content_performance_syncs",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    postId: text("post_id").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    socialAccountId: text("social_account_id").notNull(),
    rightsSnapshotId: text("rights_snapshot_id").notNull(),
    rightsSnapshotRevision: integer("rights_snapshot_revision").notNull(),
    rightsSnapshotDigest: text("rights_snapshot_digest").notNull(),
    region: text("region").notNull(),
    contentLanguage: text("content_language").notNull(),
    arabicVariety: text("arabic_variety"),
    format: text("format").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    state: text("state").default("active").notNull(),
    scheduleMinutes: integer("schedule_minutes").default(60).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    lastSourceDigest: text("last_source_digest"),
    lastErrorCode: text("last_error_code"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "workspace_content_performance_syncs_pk", columns: [table.workspaceId, table.id] }),
    postUnique: uniqueIndex("workspace_content_performance_syncs_post_unique").on(table.workspaceId, table.postId, table.sourceAssetId),
    postFk: foreignKey({ name: "workspace_content_performance_syncs_post_fk", columns: [table.workspaceId, table.postId], foreignColumns: [socialPosts.workspaceId, socialPosts.id] }).onDelete("cascade"),
    assetFk: foreignKey({ name: "workspace_content_performance_syncs_asset_fk", columns: [table.workspaceId, table.sourceAssetId], foreignColumns: [assets.workspaceId, assets.id] }).onDelete("restrict"),
    accountFk: foreignKey({ name: "workspace_content_performance_syncs_account_fk", columns: [table.workspaceId, table.socialAccountId], foreignColumns: [socialAccounts.workspaceId, socialAccounts.id] }).onDelete("cascade"),
    dueIdx: index("workspace_content_performance_syncs_due_idx").on(table.nextRunAt, table.workspaceId, table.id).where(sql`${table.state} = 'active'`),
    valuesCheck: check("workspace_content_performance_syncs_values_check", sql`${table.state} in ('active','paused','needs_reauth') and ${table.scheduleMinutes} between 15 and 10080 and ${table.rightsSnapshotRevision} > 0 and ${table.rightsSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.contentLanguage} in ('ar','en') and (${table.arabicVariety} is null or ${table.arabicVariety} in ('msa','gulf','egyptian','levantine','maghrebi')) and ${table.format} in ('slideshow','wall_of_text','video_hook_demo','speaking_hook_demo','talking_head_ugc','green_screen_meme','talking_head_green_screen','product_spokesperson','green_screen_mobile_app','claymation','character_swap','custom_upload') and jsonb_typeof(${table.tags}) = 'array'`),
  }),
);

export const workspaceContentPerformanceSyncJobs = pgTable(
  "workspace_content_performance_sync_jobs",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    syncId: text("sync_id").notNull(),
    sourceKey: text("source_key").notNull(),
    state: text("state").default("queued").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(4).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseGeneration: integer("lease_generation").default(0).notNull(),
    failureCode: text("failure_code"),
    observationId: text("observation_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "workspace_content_performance_sync_jobs_pk", columns: [table.workspaceId, table.id] }),
    sourceUnique: uniqueIndex("workspace_content_performance_sync_jobs_source_unique").on(table.workspaceId, table.syncId, table.sourceKey),
    activeSyncUnique: uniqueIndex("workspace_content_performance_sync_jobs_active_sync_unique").on(table.workspaceId, table.syncId).where(sql`${table.state} in ('queued','claimed')`),
    syncFk: foreignKey({ name: "workspace_content_performance_sync_jobs_sync_fk", columns: [table.workspaceId, table.syncId], foreignColumns: [workspaceContentPerformanceSyncs.workspaceId, workspaceContentPerformanceSyncs.id] }).onDelete("cascade"),
    dueIdx: index("workspace_content_performance_sync_jobs_due_idx").on(table.nextAttemptAt, table.workspaceId, table.id).where(sql`${table.state} = 'queued'`),
    valuesCheck: check("workspace_content_performance_sync_jobs_values_check", sql`${table.state} in ('queued','claimed','succeeded','failed_known') and ${table.attempt} between 0 and ${table.maxAttempts} and ${table.maxAttempts} between 1 and 10 and ${table.leaseGeneration} >= 0 and length(${table.sourceKey}) between 1 and 200 and ((${table.state} = 'claimed' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null))`),
  }),
);

export const socialWebhooks = pgTable(
  "social_webhooks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    targetUrl: text("target_url").notNull(),
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_webhooks_workspace_idx").on(table.workspaceId),
    enabledIdx: index("social_webhooks_enabled_idx").on(table.enabled),
    createdAtIdx: index("social_webhooks_created_at_idx").on(table.createdAt),
  }),
);

export const socialWebhookDeliveries = pgTable(
  "social_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => socialWebhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => socialEvents.id, { onDelete: "cascade" }),
    status: socialWebhookDeliveryStatusEnum("status")
      .default("pending")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_webhook_deliveries_workspace_idx").on(
      table.workspaceId,
    ),
    webhookIdx: index("social_webhook_deliveries_webhook_idx").on(table.webhookId),
    eventIdx: index("social_webhook_deliveries_event_idx").on(table.eventId),
    statusIdx: index("social_webhook_deliveries_status_idx").on(table.status),
    nextAttemptAtIdx: index("social_webhook_deliveries_next_attempt_at_idx").on(
      table.nextAttemptAt,
    ),
    lockedAtIdx: index("social_webhook_deliveries_locked_at_idx").on(table.lockedAt),
    createdAtIdx: index("social_webhook_deliveries_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const socialDispatchRuns = pgTable(
  "social_dispatch_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dispatchKey: text("dispatch_key").notNull(),
    state: socialDispatchRunStateEnum("state").default("pending").notNull(),
    kind: text("kind").default("post").notNull(),
    postId: text("post_id").references(() => socialPosts.id, {
      onDelete: "set null",
    }),
    eventId: text("event_id").references(() => socialEvents.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    provider: socialPlatformEnum("provider"),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    dispatchKeyUnique: uniqueIndex(
      "social_dispatch_runs_dispatch_key_unique",
    ).on(table.dispatchKey),
    workspaceIdx: index("social_dispatch_runs_workspace_idx").on(
      table.workspaceId,
    ),
    stateIdx: index("social_dispatch_runs_state_idx").on(table.state),
    createdAtIdx: index("social_dispatch_runs_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const socialTokenRefreshLeases = pgTable(
  "social_token_refresh_leases",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    leaseToken: text("lease_token").notNull(),
    state: socialTokenRefreshLeaseStateEnum("state")
      .default("active")
      .notNull(),
    leasedAt: timestamp("leased_at", { withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true })
      .notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    socialAccountUnique: uniqueIndex(
      "social_token_refresh_leases_social_account_unique",
    ).on(table.socialAccountId),
    workspaceIdx: index("social_token_refresh_leases_workspace_idx").on(
      table.workspaceId,
    ),
    stateIdx: index("social_token_refresh_leases_state_idx").on(table.state),
    leaseExpiresAtIdx: index("social_token_refresh_leases_expires_at_idx").on(
      table.leaseExpiresAt,
    ),
  }),
);

export const socialEventReads = pgTable(
  "social_event_reads",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => socialEvents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "social_event_reads_pk",
      columns: [table.eventId, table.userId],
    }),
    workspaceIdx: index("social_event_reads_workspace_idx").on(table.workspaceId),
    userIdx: index("social_event_reads_user_idx").on(table.userId),
    readAtIdx: index("social_event_reads_read_at_idx").on(table.readAt),
  }),
);

export const socialNotificationPreferences = pgTable(
  "social_notification_preferences",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    inAppEnabled: boolean("in_app_enabled").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    muteAll: boolean("mute_all").default(false).notNull(),
    preferences: jsonb("preferences").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "social_notification_preferences_pk",
      columns: [table.workspaceId, table.userId],
    }),
    userIdx: index("social_notification_preferences_user_idx").on(table.userId),
  }),
);

export const socialWebhookSubscriptions = pgTable(
  "social_webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => socialWebhooks.id, { onDelete: "cascade" }),
    name: text("name"),
    enabled: boolean("enabled").default(true).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_webhook_subscriptions_workspace_idx").on(
      table.workspaceId,
    ),
    webhookIdx: index("social_webhook_subscriptions_webhook_idx").on(
      table.webhookId,
    ),
    enabledIdx: index("social_webhook_subscriptions_enabled_idx").on(
      table.enabled,
    ),
    createdAtIdx: index("social_webhook_subscriptions_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const socialWebhookDeliveryDeadLetters = pgTable(
  "social_webhook_delivery_dead_letters",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => socialWebhookDeliveries.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => socialWebhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => socialEvents.id, { onDelete: "cascade" }),
    deadLetterReason: text("dead_letter_reason").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    replayState: socialWebhookDeadLetterReplayStateEnum("replay_state")
      .default("dead_lettered")
      .notNull(),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    replayRequestedAt: timestamp("replay_requested_at", { withTimezone: true }),
    replayRequestedByUserId: text("replay_requested_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    replayMetadata: jsonb("replay_metadata").$type<Record<string, unknown>>(),
    replayDeliveryId: text("replay_delivery_id").references(
      () => socialWebhookDeliveries.id,
      { onDelete: "set null" },
    ),
    replayedAt: timestamp("replayed_at", { withTimezone: true }),
    replayError: text("replay_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    deliveryUnique: uniqueIndex(
      "social_webhook_delivery_dead_letters_delivery_unique",
    ).on(table.deliveryId),
    workspaceIdx: index("social_webhook_delivery_dead_letters_workspace_idx").on(
      table.workspaceId,
    ),
    replayStateIdx: index(
      "social_webhook_delivery_dead_letters_replay_state_idx",
    ).on(table.replayState),
    createdAtIdx: index("social_webhook_delivery_dead_letters_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const socialAutomationRules = pgTable(
  "social_automation_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    triggerSource: text("trigger_source").notNull(),
    triggerFilters: jsonb("trigger_filters").$type<Record<string, unknown>>(),
    repeatIntervalSeconds: integer("repeat_interval_seconds"),
    maxRuns: integer("max_runs"),
    totalRuns: integer("total_runs").default(0).notNull(),
    actionType: text("action_type").notNull().default("create_social_post"),
    actionConfig: jsonb("action_config").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_automation_rules_workspace_idx").on(
      table.workspaceId,
    ),
    enabledIdx: index("social_automation_rules_enabled_idx").on(table.enabled),
    triggerSourceIdx: index("social_automation_rules_trigger_source_idx").on(
      table.triggerSource,
    ),
    createdAtIdx: index("social_automation_rules_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const socialAutomationTasks = pgTable(
  "social_automation_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => socialAutomationRules.id, { onDelete: "cascade" }),
    taskKey: text("task_key").notNull(),
    runIndex: integer("run_index").default(1).notNull(),
    state: automationTaskStateEnum("state").default("pending").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    sourcePostId: text("source_post_id").references(() => socialPosts.id, {
      onDelete: "set null",
    }),
    sourceEventId: text("source_event_id").references(() => socialEvents.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("social_automation_tasks_workspace_idx").on(
      table.workspaceId,
    ),
    ruleIdx: index("social_automation_tasks_rule_idx").on(table.ruleId),
    taskKeyUnique: uniqueIndex("social_automation_tasks_task_key_unique").on(
      table.taskKey,
    ),
    ruleRunIndexUnique: uniqueIndex(
      "social_automation_tasks_rule_run_index_unique",
    ).on(table.ruleId, table.runIndex),
    stateIdx: index("social_automation_tasks_state_idx").on(table.state),
    dueAtIdx: index("social_automation_tasks_due_at_idx").on(table.dueAt),
    runIndexIdx: index("social_automation_tasks_run_index_idx").on(
      table.runIndex,
    ),
    claimedAtIdx: index("social_automation_tasks_claimed_at_idx").on(
      table.claimedAt,
    ),
    createdAtIdx: index("social_automation_tasks_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

/**
 * Simple Studio domain tables.
 */
export const savedPromptModeEnum = pgEnum("saved_prompt_mode", [
  "photo",
  "video",
  "copy",
]);

export const savedPrompts = pgTable(
  "saved_prompts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mode: savedPromptModeEnum("mode").notNull(),
    name: text("name").notNull(),
    promptText: text("prompt_text").notNull(),
    formConfig: jsonb("form_config")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceDeletedIdx: index("saved_prompts_workspace_deleted_idx").on(
      table.workspaceId,
      table.deletedAt,
    ),
    publicModeDeletedIdx: index("saved_prompts_public_mode_deleted_idx").on(
      table.isPublic,
      table.mode,
      table.deletedAt,
    ),
    createdAtIdx: index("saved_prompts_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Immutable Usage Ledger and valuation evidence. Runtime consumption is kept
 * separate from mutable reservation/budget projections and browser estimates.
 */
export const usageLedgerReceipts = pgTable(
  "usage_ledger_receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    requestDigest: text("request_digest").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("usage_ledger_receipts_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    workspaceCreatedIdx: index("usage_ledger_receipts_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    digestCheck: check(
      "usage_ledger_receipts_digest_check",
      sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    kindCheck: check(
      "usage_ledger_receipts_kind_check",
      sql`${table.kind} in ('settlement', 'correction', 'attribution')`,
    ),
  }),
);

export const runtimeUsageRecords = pgTable(
  "runtime_usage_records",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    stepId: text("step_id").notNull(),
    attempt: integer("attempt").notNull(),
    effectKey: text("effect_key").notNull(),
    provider: text("provider").notNull(),
    providerOperation: text("provider_operation").notNull(),
    providerOperationRef: text("provider_operation_ref"),
    model: text("model").notNull(),
    intervalStartedAt: timestamp("interval_started_at", { withTimezone: true }).notNull(),
    intervalEndedAt: timestamp("interval_ended_at", { withTimezone: true }).notNull(),
    dimension: text("dimension").notNull(),
    unit: text("unit").notNull(),
    source: text("source").notNull(),
    quantity: text("quantity"),
    outcome: text("outcome").notNull(),
    supersedesUsageRecordId: text("supersedes_usage_record_id"),
    record: jsonb("record").$type<UsageRecord>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    settlementFk: foreignKey({
      columns: [table.workspaceId, table.settlementId],
      foreignColumns: [usageLedgerReceipts.workspaceId, usageLedgerReceipts.id],
      name: "runtime_usage_records_settlement_fk",
    }).onDelete("restrict"),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.workflowId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.workflowId, workflowRuns.id],
      name: "runtime_usage_records_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceAttemptFk: foreignKey({
      columns: [table.workspaceId, table.runId, table.stepAttemptId],
      foreignColumns: [workflowStepAttempts.workspaceId, workflowStepAttempts.runId, workflowStepAttempts.id],
      name: "runtime_usage_records_workspace_attempt_fk",
    }).onDelete("restrict"),
    workspacePrincipalFk: foreignKey({
      columns: [table.workspaceId, table.principalId],
      foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
      name: "runtime_usage_records_workspace_principal_fk",
    }).onDelete("restrict"),
    settlementDimensionUnique: uniqueIndex(
      "runtime_usage_records_settlement_dimension_unique",
    )
      .on(table.settlementId, table.dimension, table.unit)
      .where(sql`${table.supersedesUsageRecordId} is null`),
    supersededUnique: uniqueIndex("runtime_usage_records_superseded_unique")
      .on(table.supersedesUsageRecordId)
      .where(sql`${table.supersedesUsageRecordId} is not null`),
    chainTargetUnique: uniqueIndex("runtime_usage_records_chain_target_unique").on(
      table.workspaceId,
      table.settlementId,
      table.dimension,
      table.unit,
      table.id,
    ),
    workspaceIdUnique: uniqueIndex("runtime_usage_records_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    workspaceSettlementIdUnique: uniqueIndex("runtime_usage_records_workspace_settlement_id_unique").on(
      table.workspaceId,
      table.settlementId,
      table.id,
    ),
    supersedesFk: foreignKey({
      columns: [table.workspaceId, table.settlementId, table.dimension, table.unit, table.supersedesUsageRecordId],
      foreignColumns: [table.workspaceId, table.settlementId, table.dimension, table.unit, table.id],
      name: "runtime_usage_records_supersedes_fk",
    }).onDelete("restrict"),
    workspaceRecordedIdx: index("runtime_usage_records_workspace_recorded_idx").on(
      table.workspaceId,
      table.recordedAt,
      table.id,
    ),
    runIdx: index("runtime_usage_records_run_idx").on(table.workspaceId, table.runId),
    attemptIdx: index("runtime_usage_records_attempt_idx").on(
      table.workspaceId,
      table.stepAttemptId,
    ),
    decimalCheck: check(
      "runtime_usage_records_decimal_check",
      sql`(${table.source} = 'unknown' and ${table.quantity} is null)
        or (${table.source} in ('reported', 'measured', 'estimated')
          and ${table.quantity} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$')`,
    ),
    dimensionCheck: check(
      "runtime_usage_records_dimension_check",
      sql`${table.dimension} ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$'`,
    ),
    unitCheck: check(
      "runtime_usage_records_unit_check",
      sql`${table.unit} in ('count', 'byte', 'millisecond', 'megapixel')`,
    ),
    outcomeCheck: check(
      "runtime_usage_records_outcome_check",
      sql`${table.outcome} in ('succeeded', 'failed_known', 'outcome_unknown')`,
    ),
    intervalCheck: check(
      "runtime_usage_records_interval_check",
      sql`${table.intervalEndedAt} >= ${table.intervalStartedAt}`,
    ),
    attemptCheck: check("runtime_usage_records_attempt_check", sql`${table.attempt} > 0`),
    supersedesSelfCheck: check(
      "runtime_usage_records_supersedes_self_check",
      sql`${table.supersedesUsageRecordId} is null or ${table.supersedesUsageRecordId} <> ${table.id}`,
    ),
    payloadCheck: check(
      "runtime_usage_records_payload_check",
      sql`jsonb_typeof(${table.record}) is not distinct from 'object'
        and ${table.record} ?& array['schema', 'id', 'settlementId', 'binding', 'interval', 'dimension', 'unit', 'source', 'quantity', 'outcome', 'evidence', 'directArtifactId', 'lineageArtifactIds', 'supersedesUsageRecordId', 'correctionReason', 'recordedAt']
        and jsonb_typeof(${table.record}->'binding') is not distinct from 'object'
        and ${table.record}->'binding' ?& array['workspaceId', 'principalId', 'workflowId', 'runId', 'stepAttemptId', 'stepId', 'attempt', 'effectKey', 'provider', 'providerOperation', 'providerOperationRef', 'model']
        and jsonb_typeof(${table.record}->'interval') is not distinct from 'object'
        and ${table.record}->'interval' ?& array['startedAt', 'endedAt']
        and (${table.record}->>'schema') is not distinct from 'usage-record/v1'
        and (${table.record}->>'id') is not distinct from ${table.id}
        and (${table.record}->>'settlementId') is not distinct from ${table.settlementId}
        and (${table.record}->'binding'->>'workspaceId') is not distinct from ${table.workspaceId}
        and (${table.record}->'binding'->>'principalId') is not distinct from ${table.principalId}
        and (${table.record}->'binding'->>'workflowId') is not distinct from ${table.workflowId}
        and (${table.record}->'binding'->>'runId') is not distinct from ${table.runId}
        and (${table.record}->'binding'->>'stepAttemptId') is not distinct from ${table.stepAttemptId}
        and (${table.record}->'binding'->>'stepId') is not distinct from ${table.stepId}
        and ((${table.record}->'binding'->>'attempt')::integer) is not distinct from ${table.attempt}
        and (${table.record}->'binding'->>'effectKey') is not distinct from ${table.effectKey}
        and (${table.record}->'binding'->>'provider') is not distinct from ${table.provider}
        and (${table.record}->'binding'->>'providerOperation') is not distinct from ${table.providerOperation}
        and (${table.record}->'binding'->>'providerOperationRef') is not distinct from ${table.providerOperationRef}
        and (${table.record}->'binding'->>'model') is not distinct from ${table.model}
        and ((${table.record}->'interval'->>'startedAt')::timestamptz) is not distinct from ${table.intervalStartedAt}
        and ((${table.record}->'interval'->>'endedAt')::timestamptz) is not distinct from ${table.intervalEndedAt}
        and (${table.record}->>'dimension') is not distinct from ${table.dimension}
        and (${table.record}->>'unit') is not distinct from ${table.unit}
        and (${table.record}->>'source') is not distinct from ${table.source}
        and (${table.record}->>'quantity') is not distinct from ${table.quantity}
        and (${table.record}->>'outcome') is not distinct from ${table.outcome}
        and (${table.record}->>'supersedesUsageRecordId') is not distinct from ${table.supersedesUsageRecordId}
        and (${table.record}->>'recordedAt')::timestamptz is not distinct from ${table.recordedAt}
        and (${table.record}->>'directArtifactId') is null
        and jsonb_typeof(${table.record}->'lineageArtifactIds') is not distinct from 'array'
        and jsonb_typeof(${table.record}->'evidence') is not distinct from 'object'
        and octet_length(${table.record}::text) <= 65536
        and ${table.record}::text !~* '"[^"\\n]*(secret|token|password|ciphertext|prompt|content)[^"\\n]*"\\s*:'`,
    ),
  }),
);

export const runtimePricingSnapshots = pgTable(
  "runtime_pricing_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    providerOperation: text("provider_operation").notNull(),
    model: text("model").notNull(),
    dimension: text("dimension").notNull(),
    unit: text("unit").notNull(),
    price: text("price").notNull(),
    currency: text("currency").notNull(),
    perQuantity: text("per_quantity").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    snapshot: jsonb("snapshot").$type<PricingSnapshot>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "runtime_pricing_snapshots_workspace_fk",
    }).onDelete("restrict"),
    lookupIdx: index("runtime_pricing_snapshots_lookup_idx").on(
      table.workspaceId,
      table.provider,
      table.providerOperation,
      table.model,
      table.effectiveFrom,
    ),
    workspaceIdUnique: uniqueIndex("runtime_pricing_snapshots_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    idSourceUnique: uniqueIndex("runtime_pricing_snapshots_id_source_unique").on(
      table.id,
      table.source,
    ),
    sourceCheck: check(
      "runtime_pricing_snapshots_source_check",
      sql`${table.source} in ('workspace_override', 'builtin_catalog')`,
    ),
    decimalCheck: check(
      "runtime_pricing_snapshots_decimal_check",
      sql`${table.price} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
        and ${table.perQuantity} ~ '^[1-9][0-9]*(\\.[0-9]+)?$'`,
    ),
    currencyCheck: check(
      "runtime_pricing_snapshots_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    intervalCheck: check(
      "runtime_pricing_snapshots_interval_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    payloadCheck: check(
      "runtime_pricing_snapshots_payload_check",
      sql`jsonb_typeof(${table.snapshot}) is not distinct from 'object'
        and ${table.snapshot} ?& array['schema', 'id', 'workspaceId', 'source', 'provider', 'providerOperation', 'model', 'dimension', 'unit', 'price', 'currency', 'perQuantity', 'version', 'sourceUrl', 'effectiveFrom', 'effectiveTo', 'recordedAt']
        and (${table.snapshot}->>'schema') is not distinct from 'pricing-snapshot/v1'
        and (${table.snapshot}->>'id') is not distinct from ${table.id}
        and (${table.snapshot}->>'workspaceId') is not distinct from ${table.workspaceId}
        and (${table.snapshot}->>'source') is not distinct from ${table.source}
        and (${table.snapshot}->>'provider') is not distinct from ${table.provider}
        and (${table.snapshot}->>'providerOperation') is not distinct from ${table.providerOperation}
        and (${table.snapshot}->>'model') is not distinct from ${table.model}
        and (${table.snapshot}->>'dimension') is not distinct from ${table.dimension}
        and (${table.snapshot}->>'unit') is not distinct from ${table.unit}
        and (${table.snapshot}->>'price') is not distinct from ${table.price}
        and (${table.snapshot}->>'currency') is not distinct from ${table.currency}
        and (${table.snapshot}->>'perQuantity') is not distinct from ${table.perQuantity}
        and (${table.snapshot}->>'effectiveFrom')::timestamptz is not distinct from ${table.effectiveFrom}
        and (${table.snapshot}->>'effectiveTo')::timestamptz is not distinct from ${table.effectiveTo}
        and (${table.snapshot}->>'recordedAt')::timestamptz is not distinct from ${table.recordedAt}
        and octet_length(${table.snapshot}::text) <= 32768`,
    ),
  }),
);

export const runtimeCostValuations = pgTable(
  "runtime_cost_valuations",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    runId: text("run_id").notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    source: text("source").notNull(),
    amount: text("amount"),
    currency: text("currency"),
    supersedesCostValuationId: text("supersedes_cost_valuation_id"),
    valuation: jsonb("valuation").$type<CostValuation>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    settlementFk: foreignKey({
      columns: [table.workspaceId, table.settlementId],
      foreignColumns: [usageLedgerReceipts.workspaceId, usageLedgerReceipts.id],
      name: "runtime_cost_valuations_settlement_fk",
    }).onDelete("restrict"),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "runtime_cost_valuations_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceAttemptFk: foreignKey({
      columns: [table.workspaceId, table.runId, table.stepAttemptId],
      foreignColumns: [workflowStepAttempts.workspaceId, workflowStepAttempts.runId, workflowStepAttempts.id],
      name: "runtime_cost_valuations_workspace_attempt_fk",
    }).onDelete("restrict"),
    supersededUnique: uniqueIndex("runtime_cost_valuations_superseded_unique")
      .on(table.supersedesCostValuationId)
      .where(sql`${table.supersedesCostValuationId} is not null`),
    chainTargetUnique: uniqueIndex("runtime_cost_valuations_chain_target_unique").on(
      table.workspaceId,
      table.settlementId,
      table.id,
    ),
    workspaceIdUnique: uniqueIndex("runtime_cost_valuations_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    supersedesFk: foreignKey({
      columns: [table.workspaceId, table.settlementId, table.supersedesCostValuationId],
      foreignColumns: [table.workspaceId, table.settlementId, table.id],
      name: "runtime_cost_valuations_supersedes_fk",
    }).onDelete("restrict"),
    supersedesSelfCheck: check(
      "runtime_cost_valuations_supersedes_self_check",
      sql`${table.supersedesCostValuationId} is null or ${table.supersedesCostValuationId} <> ${table.id}`,
    ),
    workspaceRecordedIdx: index("runtime_cost_valuations_workspace_recorded_idx").on(
      table.workspaceId,
      table.recordedAt,
      table.id,
    ),
    stateCheck: check(
      "runtime_cost_valuations_state_check",
      sql`(${table.source} = 'unknown' and ${table.amount} is null and ${table.currency} is null)
        or (${table.source} = 'effect_not_created' and ${table.amount} = '0' and ${table.currency} is null)
        or (${table.source} in ('provider_reported', 'workspace_override', 'builtin_catalog', 'mixed')
          and ${table.amount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
          and ${table.currency} ~ '^[A-Z]{3}$')`,
    ),
    payloadCheck: check(
      "runtime_cost_valuations_payload_check",
      sql`jsonb_typeof(${table.valuation}) is not distinct from 'object'
        and ${table.valuation} ?& array['schema', 'id', 'settlementId', 'workspaceId', 'principalId', 'runId', 'stepAttemptId', 'usageRecordIds', 'basis', 'pricingSource', 'amount', 'currency', 'providerCostEvidenceRef', 'pricingSnapshotIds', 'pricingSnapshots', 'fxSnapshotId', 'supersedesCostValuationId', 'recordedAt']
        and (${table.valuation}->>'schema') is not distinct from 'cost-valuation/v1'
        and (${table.valuation}->>'id') is not distinct from ${table.id}
        and (${table.valuation}->>'settlementId') is not distinct from ${table.settlementId}
        and (${table.valuation}->>'workspaceId') is not distinct from ${table.workspaceId}
        and (${table.valuation}->>'principalId') is not distinct from ${table.principalId}
        and (${table.valuation}->>'runId') is not distinct from ${table.runId}
        and (${table.valuation}->>'stepAttemptId') is not distinct from ${table.stepAttemptId}
        and (${table.valuation}->>'pricingSource') is not distinct from ${table.source}
        and (${table.valuation}->>'amount') is not distinct from ${table.amount}
        and (${table.valuation}->>'currency') is not distinct from ${table.currency}
        and (${table.valuation}->>'supersedesCostValuationId') is not distinct from ${table.supersedesCostValuationId}
        and (${table.valuation}->>'recordedAt')::timestamptz is not distinct from ${table.recordedAt}
        and jsonb_typeof(${table.valuation}->'usageRecordIds') is not distinct from 'array'
        and jsonb_typeof(${table.valuation}->'pricingSnapshotIds') is not distinct from 'array'
        and jsonb_typeof(${table.valuation}->'pricingSnapshots') is not distinct from 'array'
        and (
          (${table.source} = 'unknown' and (${table.valuation}->>'basis') is not distinct from 'unknown')
          or (${table.source} = 'provider_reported' and (${table.valuation}->>'basis') is not distinct from 'provider_reported')
          or (${table.source} in ('workspace_override', 'builtin_catalog', 'mixed') and (${table.valuation}->>'basis') is not distinct from 'runtime_calculated')
        )
        and (
          ${table.source} <> 'provider_reported'
          or (${table.valuation}->>'providerCostEvidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
        )
        and octet_length(${table.valuation}::text) <= 65536`,
    ),
  }),
);

export const runtimeCostValuationUsageRecords = pgTable(
  "runtime_cost_valuation_usage_records",
  {
    workspaceId: text("workspace_id").notNull(),
    settlementId: text("settlement_id").notNull(),
    costValuationId: text("cost_valuation_id").notNull(),
    usageRecordId: text("usage_record_id").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.costValuationId, table.usageRecordId],
      name: "runtime_cost_valuation_usage_records_pk",
    }),
    valuationFk: foreignKey({
      columns: [table.workspaceId, table.settlementId, table.costValuationId],
      foreignColumns: [runtimeCostValuations.workspaceId, runtimeCostValuations.settlementId, runtimeCostValuations.id],
      name: "runtime_cost_valuation_usage_records_valuation_fk",
    }).onDelete("restrict"),
    usageRecordFk: foreignKey({
      columns: [table.workspaceId, table.settlementId, table.usageRecordId],
      foreignColumns: [runtimeUsageRecords.workspaceId, runtimeUsageRecords.settlementId, runtimeUsageRecords.id],
      name: "runtime_cost_valuation_usage_records_usage_record_fk",
    }).onDelete("restrict"),
  }),
);

export const runtimeCostValuationPricingSnapshots = pgTable(
  "runtime_cost_valuation_pricing_snapshots",
  {
    workspaceId: text("workspace_id").notNull(),
    costValuationId: text("cost_valuation_id").notNull(),
    pricingWorkspaceId: text("pricing_workspace_id"),
    pricingSnapshotId: text("pricing_snapshot_id").notNull(),
    pricingSource: text("pricing_source").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.costValuationId, table.pricingSnapshotId],
      name: "runtime_cost_valuation_pricing_snapshots_pk",
    }),
    valuationFk: foreignKey({
      columns: [table.workspaceId, table.costValuationId],
      foreignColumns: [runtimeCostValuations.workspaceId, runtimeCostValuations.id],
      name: "runtime_cost_valuation_pricing_snapshots_valuation_fk",
    }).onDelete("restrict"),
    workspacePricingFk: foreignKey({
      columns: [table.pricingWorkspaceId, table.pricingSnapshotId],
      foreignColumns: [runtimePricingSnapshots.workspaceId, runtimePricingSnapshots.id],
      name: "runtime_cost_valuation_pricing_snapshots_workspace_pricing_fk",
    }).onDelete("restrict"),
    pricingIdentityFk: foreignKey({
      columns: [table.pricingSnapshotId, table.pricingSource],
      foreignColumns: [runtimePricingSnapshots.id, runtimePricingSnapshots.source],
      name: "runtime_cost_valuation_pricing_snapshots_identity_fk",
    }).onDelete("restrict"),
    workspaceScopeCheck: check(
      "runtime_cost_valuation_pricing_snapshots_workspace_scope_check",
      sql`(${table.pricingSource} = 'builtin_catalog' and ${table.pricingWorkspaceId} is null)
        or (${table.pricingSource} = 'workspace_override' and ${table.pricingWorkspaceId} = ${table.workspaceId})`,
    ),
  }),
);

export const runtimeFxSnapshots = pgTable(
  "runtime_fx_snapshots",
  {
    id: text("id").primaryKey(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: text("rate").notNull(),
    source: text("source").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").$type<FxSnapshot>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pairObservedIdx: index("runtime_fx_snapshots_pair_observed_idx").on(
      table.baseCurrency,
      table.quoteCurrency,
      table.observedAt,
    ),
    currencyCheck: check(
      "runtime_fx_snapshots_currency_check",
      sql`${table.baseCurrency} ~ '^[A-Z]{3}$'
        and ${table.quoteCurrency} ~ '^[A-Z]{3}$'
        and ${table.baseCurrency} <> ${table.quoteCurrency}`,
    ),
    rateCheck: check(
      "runtime_fx_snapshots_rate_check",
      sql`${table.rate} ~ '^[1-9][0-9]*(\\.[0-9]+)?$|^0\\.[0-9]*[1-9][0-9]*$'`,
    ),
    payloadCheck: check(
      "runtime_fx_snapshots_payload_check",
      sql`jsonb_typeof(${table.snapshot}) is not distinct from 'object'
        and ${table.snapshot} ?& array['schema', 'id', 'baseCurrency', 'quoteCurrency', 'rate', 'source', 'observedAt', 'recordedAt']
        and (${table.snapshot}->>'schema') is not distinct from 'fx-snapshot/v1'
        and (${table.snapshot}->>'id') is not distinct from ${table.id}
        and (${table.snapshot}->>'baseCurrency') is not distinct from ${table.baseCurrency}
        and (${table.snapshot}->>'quoteCurrency') is not distinct from ${table.quoteCurrency}
        and (${table.snapshot}->>'rate') is not distinct from ${table.rate}
        and (${table.snapshot}->>'source') is not distinct from ${table.source}
        and (${table.snapshot}->>'observedAt')::timestamptz is not distinct from ${table.observedAt}
        and (${table.snapshot}->>'recordedAt')::timestamptz is not distinct from ${table.recordedAt}
        and octet_length(${table.snapshot}::text) <= 16384`,
    ),
  }),
);

export const runtimeUsageArtifactAttributions = pgTable(
  "runtime_usage_artifact_attributions",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    runId: text("run_id").notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    effectKey: text("effect_key").notNull(),
    outputName: text("output_name").notNull(),
    basis: text("basis").notNull(),
    attribution: jsonb("attribution").$type<UsageArtifactAttribution>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    settlementFk: foreignKey({
      columns: [table.workspaceId, table.settlementId],
      foreignColumns: [usageLedgerReceipts.workspaceId, usageLedgerReceipts.id],
      name: "runtime_usage_artifact_attributions_settlement_fk",
    }).onDelete("restrict"),
    workspaceArtifactFk: foreignKey({
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifacts.workspaceId, artifacts.id],
      name: "runtime_usage_artifact_attributions_workspace_artifact_fk",
    }).onDelete("restrict"),
    generatedOriginFk: foreignKey({
      columns: [
        table.workspaceId,
        table.artifactId,
        table.runId,
        table.stepAttemptId,
        table.effectKey,
        table.outputName,
      ],
      foreignColumns: [
        artifactGeneratedOrigins.workspaceId,
        artifactGeneratedOrigins.artifactId,
        artifactGeneratedOrigins.runId,
        artifactGeneratedOrigins.stepAttemptId,
        artifactGeneratedOrigins.effectKey,
        artifactGeneratedOrigins.outputName,
      ],
      name: "runtime_usage_artifact_attributions_generated_origin_fk",
    }).onDelete("restrict"),
    settlementArtifactUnique: uniqueIndex(
      "runtime_usage_artifact_attributions_settlement_unique",
    ).on(table.workspaceId, table.settlementId),
    basisCheck: check(
      "runtime_usage_artifact_attributions_basis_check",
      sql`${table.basis} = 'single_output'`,
    ),
    payloadCheck: check(
      "runtime_usage_artifact_attributions_payload_check",
      sql`jsonb_typeof(${table.attribution}) is not distinct from 'object'
        and ${table.attribution} ?& array['schema', 'id', 'settlementId', 'workspaceId', 'artifactId', 'runId', 'stepAttemptId', 'effectKey', 'outputName', 'basis', 'recordedAt']
        and (${table.attribution}->>'schema') is not distinct from 'usage-artifact-attribution/v1'
        and (${table.attribution}->>'id') is not distinct from ${table.id}
        and (${table.attribution}->>'settlementId') is not distinct from ${table.settlementId}
        and (${table.attribution}->>'workspaceId') is not distinct from ${table.workspaceId}
        and (${table.attribution}->>'artifactId') is not distinct from ${table.artifactId}
        and (${table.attribution}->>'runId') is not distinct from ${table.runId}
        and (${table.attribution}->>'stepAttemptId') is not distinct from ${table.stepAttemptId}
        and (${table.attribution}->>'effectKey') is not distinct from ${table.effectKey}
        and (${table.attribution}->>'outputName') is not distinct from ${table.outputName}
        and (${table.attribution}->>'basis') is not distinct from ${table.basis}
        and (${table.attribution}->>'recordedAt')::timestamptz is not distinct from ${table.recordedAt}
        and octet_length(${table.attribution}::text) <= 16384`,
    ),
  }),
);

export const runtimeUsageMeteringEvents = pgTable(
  "runtime_usage_metering_events",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    runId: text("run_id").notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    effectKey: text("effect_key").notNull(),
    eventType: text("event_type").notNull(),
    event: jsonb("event").$type<UsageMeteringEvent>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    settlementFk: foreignKey({
      columns: [table.workspaceId, table.settlementId],
      foreignColumns: [usageLedgerReceipts.workspaceId, usageLedgerReceipts.id],
      name: "runtime_usage_metering_events_settlement_fk",
    }).onDelete("restrict"),
    workspaceRunFk: foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "runtime_usage_metering_events_workspace_run_fk",
    }).onDelete("restrict"),
    workspaceAttemptFk: foreignKey({
      columns: [table.workspaceId, table.runId, table.stepAttemptId],
      foreignColumns: [workflowStepAttempts.workspaceId, workflowStepAttempts.runId, workflowStepAttempts.id],
      name: "runtime_usage_metering_events_workspace_attempt_fk",
    }).onDelete("restrict"),
    workspaceOccurredIdx: index("runtime_usage_metering_events_workspace_occurred_idx").on(
      table.workspaceId,
      table.occurredAt,
      table.id,
    ),
    typeCheck: check(
      "runtime_usage_metering_events_type_check",
      sql`${table.eventType} in ('usage.settled', 'usage.corrected', 'cost.valued', 'artifact.attributed')`,
    ),
    payloadCheck: check(
      "runtime_usage_metering_events_payload_check",
      sql`jsonb_typeof(${table.event}) is not distinct from 'object'
        and ${table.event} ?& array['schema', 'id', 'settlementId', 'workspaceId', 'principalId', 'runId', 'stepAttemptId', 'effectKey', 'type', 'usageRecordIds', 'costValuationId', 'measurements', 'details', 'occurredAt']
        and (${table.event}->>'schema') is not distinct from 'usage-metering-event/v1'
        and (${table.event}->>'id') is not distinct from ${table.id}
        and (${table.event}->>'settlementId') is not distinct from ${table.settlementId}
        and (${table.event}->>'workspaceId') is not distinct from ${table.workspaceId}
        and (${table.event}->>'principalId') is not distinct from ${table.principalId}
        and (${table.event}->>'runId') is not distinct from ${table.runId}
        and (${table.event}->>'stepAttemptId') is not distinct from ${table.stepAttemptId}
        and (${table.event}->>'effectKey') is not distinct from ${table.effectKey}
        and (${table.event}->>'type') is not distinct from ${table.eventType}
        and jsonb_typeof(${table.event}->'measurements') is not distinct from 'array'
        and (${table.event}->>'occurredAt')::timestamptz is not distinct from ${table.occurredAt}
        and octet_length(${table.event}::text) <= 16384
        and ${table.event}::text !~* '"[^"\\n]*(secret|token|password|ciphertext|prompt|content)[^"\\n]*"\\s*:'`,
    ),
  }),
);

/** Stable budget identity. Currency and calendar semantics cannot change in a revision. */
export const runtimeBudgetPolicies = pgTable(
  "runtime_budget_policies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id"),
    scope: text("scope").notNull(),
    currency: text("currency").notNull(),
    period: text("period").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull(),
    currentRevisionId: text("current_revision_id").notNull(),
    policy: jsonb("policy").$type<BudgetPolicy>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_budget_policies_workspace_id_unique").on(table.workspaceId, table.id),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_budget_policies_workspace_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_policies_principal_fk" }).onDelete("restrict"),
    activeWorkspaceUnique: uniqueIndex("runtime_budget_policies_active_workspace_unique").on(table.workspaceId).where(sql`${table.status} = 'active' and ${table.principalId} is null`),
    activePrincipalUnique: uniqueIndex("runtime_budget_policies_active_principal_unique").on(table.workspaceId, table.principalId).where(sql`${table.status} = 'active' and ${table.principalId} is not null`),
    identityCheck: check("runtime_budget_policies_identity_check", sql`(${table.scope} = 'workspace' and ${table.principalId} is null) or (${table.scope} = 'principal' and ${table.principalId} is not null)`),
    valueCheck: check("runtime_budget_policies_value_check", sql`${table.scope} in ('workspace', 'principal') and ${table.status} in ('active', 'revoked') and ${table.currency} ~ '^[A-Z]{3}$' and ${table.period} in ('calendar_day', 'calendar_week', 'calendar_month', 'lifetime') and length(${table.timezone}) between 1 and 255`),
  }),
);

/** Append-only mutable terms for a stable policy identity. */
export const runtimeBudgetPolicyRevisions = pgTable(
  "runtime_budget_policy_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    policyId: text("policy_id").notNull(),
    principalId: text("principal_id"),
    revision: integer("revision").notNull(),
    warningThreshold: text("warning_threshold").notNull(),
    hardLimit: text("hard_limit").notNull(),
    unknownPriceTreatment: text("unknown_price_treatment").notNull(),
    unknownPriceAllowance: text("unknown_price_allowance"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    revisionRecord: jsonb("revision_record").$type<BudgetPolicyRevision>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_budget_policy_revisions_workspace_id_unique").on(table.workspaceId, table.id),
    policyRevisionUnique: uniqueIndex("runtime_budget_policy_revisions_policy_revision_unique").on(table.workspaceId, table.policyId, table.revision),
    principalIdx: index("runtime_budget_policy_revisions_principal_idx").on(table.workspaceId, table.principalId),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeBudgetPolicies.workspaceId, runtimeBudgetPolicies.id], name: "runtime_budget_policy_revisions_policy_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_policy_revisions_principal_fk" }).onDelete("restrict"),
    revisionCheck: check("runtime_budget_policy_revisions_revision_check", sql`${table.revision} > 0`),
    decimalCheck: check("runtime_budget_policy_revisions_decimal_check", sql`${table.warningThreshold} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.hardLimit} ~ '^[1-9][0-9]*(\\.[0-9]+)?$' and ${table.warningThreshold}::numeric <= ${table.hardLimit}::numeric and (${table.unknownPriceAllowance} is null or ${table.unknownPriceAllowance} ~ '^[1-9][0-9]*(\\.[0-9]+)?$')`),
    unknownCheck: check("runtime_budget_policy_revisions_unknown_check", sql`(${table.unknownPriceTreatment} = 'deny' and ${table.unknownPriceAllowance} is null) or (${table.unknownPriceTreatment} = 'fixed_allowance' and ${table.unknownPriceAllowance} is not null)`),
  }),
);

export const runtimeBudgetAdminReceipts = pgTable(
  "runtime_budget_admin_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.kind, table.idempotencyKey], name: "runtime_budget_admin_receipts_pk" }),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_budget_admin_receipts_workspace_fk" }).onDelete("restrict"),
    kindCheck: check("runtime_budget_admin_receipts_kind_check", sql`${table.kind} in ('policy_revision', 'pricing_override')`),
    digestCheck: check("runtime_budget_admin_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

/** One stable row per policy/window; this row is the admission capacity mutex. */
export const runtimeBudgetPeriods = pgTable(
  "runtime_budget_periods",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    policyId: text("policy_id").notNull(),
    kind: text("kind").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_budget_periods_workspace_id_unique").on(table.workspaceId, table.id),
    windowUnique: uniqueIndex("runtime_budget_periods_window_unique").on(table.workspaceId, table.policyId, table.startsAt, table.endsAt),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeBudgetPolicies.workspaceId, runtimeBudgetPolicies.id], name: "runtime_budget_periods_policy_fk" }).onDelete("restrict"),
    intervalCheck: check("runtime_budget_periods_interval_check", sql`(${table.kind} = 'lifetime' and ${table.endsAt} is null) or (${table.kind} in ('calendar_day', 'calendar_week', 'calendar_month') and ${table.endsAt} > ${table.startsAt})`),
  }),
);

export const runtimeBudgetAdmissions = pgTable(
  "runtime_budget_admissions",
  {
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    principalId: text("principal_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    grantIds: jsonb("grant_ids").$type<string[]>().notNull(),
    stepExposures: jsonb("step_exposures").$type<RunStepExposure[]>().notNull(),
    admission: jsonb("admission").$type<BudgetAdmissionPlan>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.runId], name: "runtime_budget_admissions_pk" }),
    runFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_budget_admissions_run_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_admissions_principal_fk" }).onDelete("restrict"),
    principalCreatedIdx: index("runtime_budget_admissions_principal_created_idx").on(table.workspaceId, table.principalId, table.createdAt),
    digestCheck: check("runtime_budget_admissions_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

/** One atomic redemption per signed fixed provider-spend quote. */
export const runtimeWorkflowRunSpendQuoteRedemptions = pgTable(
  "runtime_workflow_run_spend_quote_redemptions",
  {
    quoteId: text("quote_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    principalId: text("principal_id").notNull(),
    keyId: text("key_id").notNull(),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    pricingSnapshotIds: jsonb("pricing_snapshot_ids").$type<string[]>().notNull(),
    targetStateDigest: text("target_state_digest").notNull(),
    ceilingDigest: text("ceiling_digest").notNull(),
    quote: jsonb("quote").$type<WorkflowRunAcceptedSpendQuote>().notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runUnique: uniqueIndex("runtime_workflow_run_spend_quote_redemptions_run_unique").on(table.workspaceId, table.runId),
    runFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_workflow_run_spend_quote_redemptions_run_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_workflow_run_spend_quote_redemptions_principal_fk" }).onDelete("restrict"),
    amountCheck: check("runtime_workflow_run_spend_quote_redemptions_amount_check", sql`${table.amount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$'`),
    currencyCheck: check("runtime_workflow_run_spend_quote_redemptions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    targetDigestCheck: check("runtime_workflow_run_spend_quote_redemptions_target_digest_check", sql`${table.targetStateDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    ceilingDigestCheck: check("runtime_workflow_run_spend_quote_redemptions_ceiling_digest_check", sql`${table.ceilingDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeBudgetAdmissionGrants = pgTable(
  "runtime_budget_admission_grants",
  {
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    grantId: text("grant_id").notNull(),
    reservedCents: integer("reserved_cents"),
    currency: text("currency"),
    exposureDigest: text("exposure_digest").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.runId, table.grantId], name: "runtime_budget_admission_grants_pk" }),
    admissionFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [runtimeBudgetAdmissions.workspaceId, runtimeBudgetAdmissions.runId], name: "runtime_budget_admission_grants_admission_fk" }).onDelete("restrict"),
    grantFk: foreignKey({ columns: [table.grantId], foreignColumns: [credentialSpendGrants.id], name: "runtime_budget_admission_grants_grant_fk" }).onDelete("restrict"),
    grantIdx: index("runtime_budget_admission_grants_grant_idx").on(table.grantId),
    capacityCheck: check("runtime_budget_admission_grants_capacity_check", sql`(${table.reservedCents} is null and ${table.currency} is null) or (${table.reservedCents} >= 0 and ${table.currency} = 'USD')`),
    digestCheck: check("runtime_budget_admission_grants_digest_check", sql`${table.exposureDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeBudgetReservations = pgTable(
  "runtime_budget_reservations",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), admittedPrincipalId: text("admitted_principal_id").notNull(), principalId: text("principal_id"), runId: text("run_id").notNull(), policyId: text("policy_id").notNull(), policyRevisionId: text("policy_revision_id").notNull(), periodId: text("period_id").notNull(), scope: text("scope").notNull(), currency: text("currency").notNull(), reservedAmount: text("reserved_amount").notNull(), heldAmount: text("held_amount").notNull(), settledAmount: text("settled_amount").notNull(), releasedAmount: text("released_amount").notNull(), state: text("state").notNull(), pricingSnapshotIds: jsonb("pricing_snapshot_ids").$type<string[]>().notNull(), reservation: jsonb("reservation").$type<BudgetReservation>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_budget_reservations_workspace_id_unique").on(table.workspaceId, table.id),
    runPolicyUnique: uniqueIndex("runtime_budget_reservations_run_policy_unique").on(table.workspaceId, table.runId, table.policyId),
    periodStateIdx: index("runtime_budget_reservations_period_state_idx").on(table.workspaceId, table.periodId, table.state),
    principalCreatedIdx: index("runtime_budget_reservations_principal_created_idx").on(table.workspaceId, table.admittedPrincipalId, table.createdAt),
    revisionIdx: index("runtime_budget_reservations_revision_idx").on(table.workspaceId, table.policyRevisionId),
    admissionFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [runtimeBudgetAdmissions.workspaceId, runtimeBudgetAdmissions.runId], name: "runtime_budget_reservations_admission_fk" }).onDelete("restrict"),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeBudgetPolicies.workspaceId, runtimeBudgetPolicies.id], name: "runtime_budget_reservations_policy_fk" }).onDelete("restrict"),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicyRevisions.id], name: "runtime_budget_reservations_revision_fk" }).onDelete("restrict"),
    periodFk: foreignKey({ columns: [table.workspaceId, table.periodId], foreignColumns: [runtimeBudgetPeriods.workspaceId, runtimeBudgetPeriods.id], name: "runtime_budget_reservations_period_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_reservations_principal_fk" }).onDelete("restrict"),
    admittedPrincipalFk: foreignKey({ columns: [table.workspaceId, table.admittedPrincipalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_reservations_admitted_principal_fk" }).onDelete("restrict"),
    scopeCheck: check("runtime_budget_reservations_scope_check", sql`(${table.scope} = 'workspace' and ${table.principalId} is null) or (${table.scope} = 'principal' and ${table.principalId} is not null)`),
    amountCheck: check("runtime_budget_reservations_amount_check", sql`${table.reservedAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.heldAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.settledAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.releasedAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.heldAmount}::numeric <= ${table.reservedAmount}::numeric and ${table.releasedAmount}::numeric <= ${table.reservedAmount}::numeric`),
    stateCheck: check("runtime_budget_reservations_state_check", sql`${table.state} in ('held', 'settled', 'released', 'outcome_unknown', 'held_unknown_cost') and ${table.currency} ~ '^[A-Z]{3}$'`),
  }),
);

/** One immutable provider-launch allocation under the accepted Run envelope. */
export const runtimeBudgetAttemptAllocations = pgTable(
  "runtime_budget_attempt_allocations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    runId: text("run_id").notNull(),
    stepAttemptId: text("step_attempt_id").notNull(),
    stepId: text("step_id").notNull(),
    attempt: integer("attempt").notNull(),
    effectKey: text("effect_key").notNull(),
    credentialEffectRef: text("credential_effect_ref").notNull(),
    provider: text("provider").notNull(),
    providerOperation: text("provider_operation").notNull(),
    model: text("model").notNull(),
    sourceAmount: text("source_amount"),
    sourceCurrency: text("source_currency"),
    grantId: text("grant_id"),
    grantAmountCents: integer("grant_amount_cents"),
    requestDigest: text("request_digest").notNull(),
    allocation: jsonb("allocation").$type<BudgetAttemptAllocationInput>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_budget_attempt_allocations_workspace_id_unique").on(table.workspaceId, table.id),
    attemptUnique: uniqueIndex("runtime_budget_attempt_allocations_attempt_unique").on(table.workspaceId, table.runId, table.stepAttemptId),
    runStepIdx: index("runtime_budget_attempt_allocations_run_step_idx").on(table.workspaceId, table.runId, table.stepId, table.attempt),
    grantIdx: index("runtime_budget_attempt_allocations_grant_idx").on(table.grantId),
    admissionFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [runtimeBudgetAdmissions.workspaceId, runtimeBudgetAdmissions.runId], name: "runtime_budget_attempt_allocations_admission_fk" }).onDelete("restrict"),
    attemptFk: foreignKey({ columns: [table.workspaceId, table.runId, table.stepAttemptId], foreignColumns: [workflowStepAttempts.workspaceId, workflowStepAttempts.runId, workflowStepAttempts.id], name: "runtime_budget_attempt_allocations_attempt_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_budget_attempt_allocations_principal_fk" }).onDelete("restrict"),
    grantFk: foreignKey({ columns: [table.grantId], foreignColumns: [credentialSpendGrants.id], name: "runtime_budget_attempt_allocations_grant_fk" }).onDelete("restrict"),
    attemptCheck: check("runtime_budget_attempt_allocations_attempt_check", sql`${table.attempt} > 0`),
    amountCheck: check("runtime_budget_attempt_allocations_amount_check", sql`(${table.sourceAmount} is null and ${table.sourceCurrency} is null) or (${table.sourceAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.sourceCurrency} ~ '^[A-Z]{3}$')`),
    grantAmountCheck: check("runtime_budget_attempt_allocations_grant_amount_check", sql`(${table.grantId} is null and ${table.grantAmountCents} is null) or (${table.grantId} is not null and ${table.grantAmountCents} >= 0)`),
    digestCheck: check("runtime_budget_attempt_allocations_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeBudgetAttemptReservationAllocations = pgTable(
  "runtime_budget_attempt_reservation_allocations",
  {
    workspaceId: text("workspace_id").notNull(),
    allocationId: text("allocation_id").notNull(),
    reservationId: text("reservation_id").notNull(),
    amount: text("amount"),
    currency: text("currency").notNull(),
    basis: text("basis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.allocationId, table.reservationId], name: "runtime_budget_attempt_reservation_allocations_pk" }),
    allocationFk: foreignKey({ columns: [table.workspaceId, table.allocationId], foreignColumns: [runtimeBudgetAttemptAllocations.workspaceId, runtimeBudgetAttemptAllocations.id], name: "runtime_budget_attempt_reservation_allocations_allocation_fk" }).onDelete("restrict"),
    reservationFk: foreignKey({ columns: [table.workspaceId, table.reservationId], foreignColumns: [runtimeBudgetReservations.workspaceId, runtimeBudgetReservations.id], name: "runtime_budget_attempt_reservation_allocations_reservation_fk" }).onDelete("restrict"),
    reservationIdx: index("runtime_budget_attempt_reservation_allocations_reservation_idx").on(table.workspaceId, table.reservationId),
    valueCheck: check("runtime_budget_attempt_reservation_allocations_value_check", sql`(${table.basis} = 'exact' and ${table.amount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$') or (${table.basis} = 'envelope_bound' and ${table.amount} is null)`),
    currencyCheck: check("runtime_budget_attempt_reservation_allocations_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  }),
);

export const runtimeBudgetReservationEvents = pgTable(
  "runtime_budget_reservation_events",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), reservationId: text("reservation_id").notNull(), runId: text("run_id").notNull(), settlementId: text("settlement_id"), costValuationId: text("cost_valuation_id"), eventType: text("event_type").notNull(), amount: text("amount"), currency: text("currency"), event: jsonb("event").$type<Record<string, unknown>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    reservationFk: foreignKey({ columns: [table.workspaceId, table.reservationId], foreignColumns: [runtimeBudgetReservations.workspaceId, runtimeBudgetReservations.id], name: "runtime_budget_reservation_events_reservation_fk" }).onDelete("restrict"),
    valuationFk: foreignKey({ columns: [table.workspaceId, table.costValuationId], foreignColumns: [runtimeCostValuations.workspaceId, runtimeCostValuations.id], name: "runtime_budget_reservation_events_valuation_fk" }).onDelete("restrict"),
    reservationOccurredIdx: index("runtime_budget_reservation_events_reservation_occurred_idx").on(table.workspaceId, table.reservationId, table.occurredAt),
    valuationIdx: index("runtime_budget_reservation_events_valuation_idx").on(table.workspaceId, table.costValuationId),
    eventCheck: check("runtime_budget_reservation_events_event_check", sql`${table.eventType} in ('held', 'settled', 'released', 'outcome_unknown', 'held_unknown_cost') and ((${table.amount} is null and ${table.currency} is null) or (${table.amount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.currency} ~ '^[A-Z]{3}$'))`),
  }),
);

export const runtimeBudgetSettlementReceipts = pgTable(
  "runtime_budget_settlement_receipts",
  { workspaceId: text("workspace_id").notNull(), costValuationId: text("cost_valuation_id").notNull(), runId: text("run_id").notNull(), requestDigest: text("request_digest").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.costValuationId], name: "runtime_budget_settlement_receipts_pk" }),
    valuationFk: foreignKey({ columns: [table.workspaceId, table.costValuationId], foreignColumns: [runtimeCostValuations.workspaceId, runtimeCostValuations.id], name: "runtime_budget_settlement_receipts_valuation_fk" }).onDelete("restrict"),
  }),
);

export const runtimeWorkspacePricingOverrides = pgTable(
  "runtime_workspace_pricing_overrides",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), provider: text("provider").notNull(), providerOperation: text("provider_operation").notNull(), model: text("model").notNull(), serviceTier: text("service_tier").notNull(), dimension: text("dimension").notNull(), unit: text("unit").notNull(), price: text("price").notNull(), currency: text("currency").notNull(), perQuantity: text("per_quantity").notNull(), runCeiling: text("run_ceiling").notNull(), sourceRef: text("source_ref").notNull(), effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(), status: text("status").notNull(), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }), revokedByUserId: text("revoked_by_user_id").references(() => user.id, { onDelete: "restrict" }), override: jsonb("override").$type<WorkspacePricingOverride>().notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_workspace_pricing_overrides_workspace_id_unique").on(table.workspaceId, table.id),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_workspace_pricing_overrides_workspace_fk" }).onDelete("restrict"),
    activeIdentityUnique: uniqueIndex("runtime_workspace_pricing_overrides_active_identity_unique").on(table.workspaceId, table.provider, table.providerOperation, table.model, table.serviceTier, table.dimension).where(sql`${table.status} = 'active'`),
    decimalCheck: check("runtime_workspace_pricing_overrides_decimal_check", sql`${table.price} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.perQuantity} ~ '^[1-9][0-9]*(\\.[0-9]+)?$' and ${table.runCeiling} ~ '^[1-9][0-9]*(\\.[0-9]+)?$' and ${table.currency} ~ '^[A-Z]{3}$'`),
  }),
);

/** Immutable snapshots of pricing override creation and revocation. */
export const runtimeWorkspacePricingOverrideRevisions = pgTable(
  "runtime_workspace_pricing_override_revisions",
  { id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), overrideId: text("override_id").notNull(), revision: integer("revision").notNull(), eventType: text("event_type").notNull(), override: jsonb("override").$type<WorkspacePricingOverride>().notNull(), actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull() },
  (table) => ({
    overrideRevisionUnique: uniqueIndex("runtime_workspace_pricing_override_revisions_unique").on(table.workspaceId, table.overrideId, table.revision),
    overrideFk: foreignKey({ columns: [table.workspaceId, table.overrideId], foreignColumns: [runtimeWorkspacePricingOverrides.workspaceId, runtimeWorkspacePricingOverrides.id], name: "runtime_workspace_pricing_override_revisions_override_fk" }).onDelete("restrict"),
    eventCheck: check("runtime_workspace_pricing_override_revisions_event_check", sql`${table.eventType} in ('created', 'revoked') and ${table.revision} > 0`),
  }),
);

export const runtimeSpendControls = pgTable(
  "runtime_spend_controls",
  { workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "restrict" }), suspended: boolean("suspended").notNull(), revision: integer("revision").notNull(), reason: text("reason").notNull(), updatedByUserId: text("updated_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), authorizationEvidenceRef: text("authorization_evidence_ref"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull() },
  (table) => ({
    revisionCheck: check("runtime_spend_controls_revision_check", sql`${table.revision} > 0 and length(${table.reason}) between 1 and 500`),
    authorizationEvidenceRefCheck: check("runtime_spend_controls_authorization_evidence_ref_check", sql`${table.authorizationEvidenceRef} is null or length(${table.authorizationEvidenceRef}) between 1 and 200`),
  }),
);

export const runtimeSpendControlEvents = pgTable(
  "runtime_spend_control_events",
  { id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), revision: integer("revision").notNull(), suspended: boolean("suspended").notNull(), reason: text("reason").notNull(), actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), authorizationEvidenceRef: text("authorization_evidence_ref"), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull() },
  (table) => ({
    workspaceRevisionUnique: uniqueIndex("runtime_spend_control_events_workspace_revision_unique").on(table.workspaceId, table.revision),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_spend_control_events_workspace_fk" }).onDelete("restrict"),
    valueCheck: check("runtime_spend_control_events_value_check", sql`${table.revision} > 0 and length(${table.reason}) between 1 and 500`),
    authorizationEvidenceRefCheck: check("runtime_spend_control_events_authorization_evidence_ref_check", sql`${table.authorizationEvidenceRef} is null or length(${table.authorizationEvidenceRef}) between 1 and 200`),
  }),
);

export const runtimeQuotaPolicies = pgTable(
  "runtime_quota_policies",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), principalId: text("principal_id"), scope: text("scope").notNull(), kind: text("kind").notNull(), boundary: text("boundary").notNull(), dimension: text("dimension").notNull(), unit: text("unit").notNull(), window: text("window").notNull(), timezone: text("timezone").notNull(), reservationRule: text("reservation_rule").notNull(), status: text("status").notNull(), currentRevisionId: text("current_revision_id").notNull(), policy: jsonb("policy").$type<QuotaPolicy>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_quota_policies_workspace_id_unique").on(table.workspaceId, table.id),
    workspaceIdentityUnique: uniqueIndex("runtime_quota_policies_active_workspace_identity_unique").on(table.workspaceId, table.kind, table.boundary, table.dimension, table.unit, table.window, table.timezone, table.reservationRule).where(sql`${table.status} = 'active' and ${table.principalId} is null`),
    principalIdentityUnique: uniqueIndex("runtime_quota_policies_active_principal_identity_unique").on(table.workspaceId, table.principalId, table.kind, table.boundary, table.dimension, table.unit, table.window, table.timezone, table.reservationRule).where(sql`${table.status} = 'active' and ${table.principalId} is not null`),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_quota_policies_workspace_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_quota_policies_principal_fk" }).onDelete("restrict"),
    scopeCheck: check("runtime_quota_policies_scope_check", sql`(${table.scope} = 'workspace' and ${table.principalId} is null) or (${table.scope} = 'principal' and ${table.principalId} is not null)`),
    jsonShapeCheck: check("runtime_quota_policies_json_shape_check", sql`${table.policy} @> jsonb_build_object('schema', 'quota-policy/v1', 'id', ${table.id}, 'workspaceId', ${table.workspaceId}, 'principalId', ${table.principalId}, 'scope', ${table.scope}, 'kind', ${table.kind}, 'boundary', ${table.boundary}, 'dimension', ${table.dimension}, 'unit', ${table.unit}, 'window', ${table.window}, 'timezone', ${table.timezone}, 'reservationRule', ${table.reservationRule}, 'status', ${table.status}, 'currentRevisionId', ${table.currentRevisionId}) and ${table.policy} ?& array['createdAt','updatedAt'] and jsonb_typeof(${table.policy}->'createdAt') = 'string' and jsonb_typeof(${table.policy}->'updatedAt') = 'string'`),
    identityCheck: check("runtime_quota_policies_identity_check", sql`${table.kind} in ('admission','concurrency','rate','storage','usage') and ${table.dimension} ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$' and ${table.unit} in ('count','byte','millisecond','megapixel') and ${table.window} in ('concurrent','calendar_minute','calendar_hour','calendar_day','calendar_week','calendar_month','lifetime') and ${table.status} in ('active','revoked') and ((${table.kind} = 'admission' and ${table.boundary} = 'run_admission' and ${table.window} <> 'concurrent' and ${table.reservationRule} = 'consume') or (${table.kind} = 'concurrency' and ${table.boundary} = 'run_concurrency' and ${table.window} = 'concurrent' and ${table.reservationRule} = 'release_on_terminal' and ${table.unit} = 'count') or (${table.kind} = 'rate' and ${table.boundary} = 'provider_effect' and ${table.window} not in ('concurrent','lifetime') and ${table.reservationRule} = 'consume') or (${table.kind} = 'storage' and ${table.boundary} = 'artifact_storage' and ${table.window} in ('concurrent','lifetime') and ${table.reservationRule} = 'release_on_transition' and ${table.unit} = 'byte') or (${table.kind} = 'usage' and ${table.boundary} = 'usage_settlement' and ${table.window} <> 'concurrent' and ${table.reservationRule} = 'consume'))`),
    jsonScalarCheck: check("runtime_quota_policies_json_scalar_check", sql`${table.policy}->>'schema' = 'quota-policy/v1' and ${table.policy}->>'id' = ${table.id} and ${table.policy}->>'workspaceId' = ${table.workspaceId} and (${table.policy}->>'principalId') is not distinct from ${table.principalId} and ${table.policy}->>'scope' = ${table.scope} and ${table.policy}->>'kind' = ${table.kind} and ${table.policy}->>'boundary' = ${table.boundary} and ${table.policy}->>'dimension' = ${table.dimension} and ${table.policy}->>'unit' = ${table.unit} and ${table.policy}->>'window' = ${table.window} and ${table.policy}->>'timezone' = ${table.timezone} and ${table.policy}->>'reservationRule' = ${table.reservationRule} and ${table.policy}->>'status' = ${table.status} and ${table.policy}->>'currentRevisionId' = ${table.currentRevisionId} and (${table.policy}->>'createdAt')::timestamptz = ${table.createdAt} and (${table.policy}->>'updatedAt')::timestamptz = ${table.updatedAt}`),
  }),
);

export const runtimeQuotaPolicyRevisions = pgTable(
  "runtime_quota_policy_revisions",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), policyId: text("policy_id").notNull(), principalId: text("principal_id"), revision: integer("revision").notNull(), warningThreshold: text("warning_threshold").notNull(), hardLimit: text("hard_limit").notNull(), exhaustionBehavior: text("exhaustion_behavior").notNull(), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), revisionRecord: jsonb("revision_record").$type<QuotaPolicyRevision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_quota_policy_revisions_workspace_id_unique").on(table.workspaceId, table.id),
    policyIdUnique: uniqueIndex("runtime_quota_policy_revisions_policy_id_unique").on(table.workspaceId, table.policyId, table.id),
    policyRevisionUnique: uniqueIndex("runtime_quota_policy_revisions_policy_revision_unique").on(table.workspaceId, table.policyId, table.revision),
    jsonShapeCheck: check("runtime_quota_policy_revisions_json_shape_check", sql`${table.revisionRecord} @> jsonb_build_object('schema', 'quota-policy-revision/v1', 'id', ${table.id}, 'workspaceId', ${table.workspaceId}, 'policyId', ${table.policyId}, 'principalId', ${table.principalId}, 'revision', ${table.revision}, 'warningThreshold', ${table.warningThreshold}, 'hardLimit', ${table.hardLimit}, 'exhaustionBehavior', ${table.exhaustionBehavior}, 'createdByUserId', ${table.createdByUserId}) and ${table.revisionRecord} ? 'createdAt' and jsonb_typeof(${table.revisionRecord}->'createdAt') = 'string'`),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeQuotaPolicies.workspaceId, runtimeQuotaPolicies.id], name: "runtime_quota_policy_revisions_policy_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_quota_policy_revisions_principal_fk" }).onDelete("restrict"),
    valueCheck: check("runtime_quota_policy_revisions_value_check", sql`${table.revision} > 0 and ${table.warningThreshold} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.hardLimit} ~ '^[1-9][0-9]*(\\.[0-9]+)?$' and ${table.warningThreshold}::numeric <= ${table.hardLimit}::numeric and ${table.exhaustionBehavior} in ('deny','wait')`),
    jsonScalarCheck: check("runtime_quota_policy_revisions_json_scalar_check", sql`${table.revisionRecord}->>'schema' = 'quota-policy-revision/v1' and ${table.revisionRecord}->>'id' = ${table.id} and ${table.revisionRecord}->>'workspaceId' = ${table.workspaceId} and ${table.revisionRecord}->>'policyId' = ${table.policyId} and (${table.revisionRecord}->>'principalId') is not distinct from ${table.principalId} and (${table.revisionRecord}->>'revision')::integer = ${table.revision} and ${table.revisionRecord}->>'warningThreshold' = ${table.warningThreshold} and ${table.revisionRecord}->>'hardLimit' = ${table.hardLimit} and ${table.revisionRecord}->>'exhaustionBehavior' = ${table.exhaustionBehavior} and ${table.revisionRecord}->>'createdByUserId' = ${table.createdByUserId} and (${table.revisionRecord}->>'createdAt')::timestamptz = ${table.createdAt}`),
  }),
);

export const runtimeQuotaAdminReceipts = pgTable(
  "runtime_quota_admin_receipts",
  { workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), resourceId: text("resource_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.idempotencyKey], name: "runtime_quota_admin_receipts_pk" }),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_quota_admin_receipts_workspace_fk" }).onDelete("restrict"),
    digestCheck: check("runtime_quota_admin_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeQuotaWindows = pgTable(
  "runtime_quota_windows",
  { id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), policyId: text("policy_id").notNull(), kind: text("kind").notNull(), timezone: text("timezone").notNull(), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_quota_windows_workspace_id_unique").on(table.workspaceId, table.id),
    finiteWindowUnique: uniqueIndex("runtime_quota_windows_finite_window_unique").on(table.workspaceId, table.policyId, table.startsAt, table.endsAt).where(sql`${table.endsAt} is not null`),
    openWindowUnique: uniqueIndex("runtime_quota_windows_open_window_unique").on(table.workspaceId, table.policyId, table.startsAt).where(sql`${table.endsAt} is null`),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeQuotaPolicies.workspaceId, runtimeQuotaPolicies.id], name: "runtime_quota_windows_policy_fk" }).onDelete("restrict"),
    intervalCheck: check("runtime_quota_windows_interval_check", sql`(${table.kind} in ('concurrent','lifetime') and ${table.endsAt} is null) or (${table.kind} in ('calendar_minute','calendar_hour','calendar_day','calendar_week','calendar_month') and ${table.endsAt} > ${table.startsAt})`),
  }),
);

export const runtimeQuotaReservations = pgTable(
  "runtime_quota_reservations",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), admittedPrincipalId: text("admitted_principal_id").notNull(), principalId: text("principal_id"), runId: text("run_id"), transitionKey: text("transition_key").notNull(), boundary: text("boundary").notNull(), subjectKind: text("subject_kind").notNull(), subjectId: text("subject_id").notNull(), policyId: text("policy_id").notNull(), policyRevisionId: text("policy_revision_id").notNull(), windowId: text("window_id").notNull(), scope: text("scope").notNull(), kind: text("kind").notNull(), dimension: text("dimension").notNull(), unit: text("unit").notNull(), reservationRule: text("reservation_rule").notNull(), reservedAmount: text("reserved_amount").notNull(), heldAmount: text("held_amount").notNull(), settledAmount: text("settled_amount").notNull(), releasedAmount: text("released_amount").notNull(), overageAmount: text("overage_amount").notNull(), state: text("state").notNull(), reservation: jsonb("reservation").$type<QuotaReservation>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_quota_reservations_workspace_id_unique").on(table.workspaceId, table.id),
    transitionPolicyUnique: uniqueIndex("runtime_quota_reservations_transition_policy_unique").on(table.workspaceId, table.transitionKey, table.policyRevisionId),
    windowStateIdx: index("runtime_quota_reservations_window_state_idx").on(table.workspaceId, table.windowId, table.state),
    subjectIdx: index("runtime_quota_reservations_subject_idx").on(table.workspaceId, table.subjectKind, table.subjectId),
    runIdx: index("runtime_quota_reservations_run_idx").on(table.workspaceId, table.runId),
    jsonShapeCheck: check("runtime_quota_reservations_json_shape_check", sql`${table.reservation} @> jsonb_build_object('schema', 'quota-reservation/v1', 'id', ${table.id}, 'workspaceId', ${table.workspaceId}, 'admittedPrincipalId', ${table.admittedPrincipalId}, 'principalId', ${table.principalId}, 'runId', ${table.runId}, 'transitionKey', ${table.transitionKey}, 'boundary', ${table.boundary}, 'subject', jsonb_build_object('kind', ${table.subjectKind}, 'id', ${table.subjectId}), 'policyId', ${table.policyId}, 'policyRevisionId', ${table.policyRevisionId}, 'scope', ${table.scope}, 'kind', ${table.kind}, 'dimension', ${table.dimension}, 'unit', ${table.unit}, 'reservationRule', ${table.reservationRule}, 'reservedAmount', ${table.reservedAmount}, 'heldAmount', ${table.heldAmount}, 'settledAmount', ${table.settledAmount}, 'releasedAmount', ${table.releasedAmount}, 'state', ${table.state}) and ${table.reservation} ?& array['createdAt','updatedAt'] and jsonb_typeof(${table.reservation}->'createdAt') = 'string' and jsonb_typeof(${table.reservation}->'updatedAt') = 'string'`),
    runFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_quota_reservations_run_fk" }).onDelete("restrict"),
    policyFk: foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [runtimeQuotaPolicies.workspaceId, runtimeQuotaPolicies.id], name: "runtime_quota_reservations_policy_fk" }).onDelete("restrict"),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [runtimeQuotaPolicyRevisions.workspaceId, runtimeQuotaPolicyRevisions.id], name: "runtime_quota_reservations_revision_fk" }).onDelete("restrict"),
    windowFk: foreignKey({ columns: [table.workspaceId, table.windowId], foreignColumns: [runtimeQuotaWindows.workspaceId, runtimeQuotaWindows.id], name: "runtime_quota_reservations_window_fk" }).onDelete("restrict"),
    admittedPrincipalFk: foreignKey({ columns: [table.workspaceId, table.admittedPrincipalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_quota_reservations_admitted_principal_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_quota_reservations_principal_fk" }).onDelete("restrict"),
    amountCheck: check("runtime_quota_reservations_amount_check", sql`${table.reservedAmount} ~ '^[1-9][0-9]*(\\.[0-9]+)?$' and ${table.heldAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.settledAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.releasedAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.overageAmount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' and ${table.heldAmount}::numeric + ${table.settledAmount}::numeric <= ${table.reservedAmount}::numeric and ${table.releasedAmount}::numeric <= ${table.reservedAmount}::numeric and (${table.reservationRule} <> 'release_on_transition' or ${table.releasedAmount}::numeric <= ${table.settledAmount}::numeric)`),
    stateCheck: check("runtime_quota_reservations_state_check", sql`(${table.state} = 'held' and ${table.heldAmount}::numeric > 0) or (${table.state} = 'settled' and ${table.heldAmount}::numeric = 0 and (${table.settledAmount}::numeric + ${table.overageAmount}::numeric) > 0) or (${table.state} = 'released' and ${table.heldAmount}::numeric = 0 and (${table.reservationRule} = 'release_on_terminal' or (${table.reservationRule} = 'consume' and (${table.settledAmount}::numeric + ${table.overageAmount}::numeric) = 0) or (${table.reservationRule} = 'release_on_transition' and ${table.settledAmount}::numeric = ${table.releasedAmount}::numeric)))`),
    ownershipCheck: check("runtime_quota_reservations_ownership_check", sql`(${table.subjectKind} = 'artifact') or ${table.runId} is not null`),
    overageJsonCheck: check("runtime_quota_reservations_overage_json_check", sql`${table.reservation} @> jsonb_build_object('overageAmount', ${table.overageAmount})`),
    usageReconciliationCheck: check("runtime_quota_reservations_usage_reconciliation_check", sql`${table.boundary} <> 'usage_settlement' or ((${table.state} = 'held' or (${table.heldAmount}::numeric = 0 and ${table.settledAmount}::numeric + ${table.releasedAmount}::numeric = ${table.reservedAmount}::numeric)) and (${table.overageAmount}::numeric = 0 or (${table.state} = 'settled' and ${table.heldAmount}::numeric = 0 and ${table.settledAmount}::numeric = ${table.reservedAmount}::numeric and ${table.releasedAmount}::numeric = 0)))`),
    jsonScalarCheck: check("runtime_quota_reservations_json_scalar_check", sql`${table.reservation}->>'schema' = 'quota-reservation/v1' and ${table.reservation}->>'id' = ${table.id} and ${table.reservation}->>'workspaceId' = ${table.workspaceId} and ${table.reservation}->>'admittedPrincipalId' = ${table.admittedPrincipalId} and (${table.reservation}->>'principalId') is not distinct from ${table.principalId} and ${table.reservation}->>'runId' = ${table.runId} and ${table.reservation}->>'transitionKey' = ${table.transitionKey} and ${table.reservation}->>'boundary' = ${table.boundary} and ${table.reservation}->'subject'->>'kind' = ${table.subjectKind} and ${table.reservation}->'subject'->>'id' = ${table.subjectId} and ${table.reservation}->>'policyId' = ${table.policyId} and ${table.reservation}->>'policyRevisionId' = ${table.policyRevisionId} and ${table.reservation}->>'scope' = ${table.scope} and ${table.reservation}->>'kind' = ${table.kind} and ${table.reservation}->>'dimension' = ${table.dimension} and ${table.reservation}->>'unit' = ${table.unit} and ${table.reservation}->>'reservationRule' = ${table.reservationRule} and ${table.reservation}->>'reservedAmount' = ${table.reservedAmount} and ${table.reservation}->>'heldAmount' = ${table.heldAmount} and ${table.reservation}->>'settledAmount' = ${table.settledAmount} and ${table.reservation}->>'releasedAmount' = ${table.releasedAmount} and ${table.reservation}->>'state' = ${table.state} and (${table.reservation}->>'createdAt')::timestamptz = ${table.createdAt} and (${table.reservation}->>'updatedAt')::timestamptz = ${table.updatedAt}`),
  }),
);

export const runtimeQuotaWaits = pgTable(
  "runtime_quota_waits",
  { id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), admittedPrincipalId: text("admitted_principal_id").notNull(), runId: text("run_id").notNull(), transitionKey: text("transition_key").notNull(), state: text("state").notNull(), eligibleAt: timestamp("eligible_at", { withTimezone: true }), reasonCode: text("reason_code").notNull(), wait: jsonb("wait").$type<QuotaWait>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), resolvedAt: timestamp("resolved_at", { withTimezone: true }) },
  (table) => ({
    workspaceIdUnique: uniqueIndex("runtime_quota_waits_workspace_id_unique").on(table.workspaceId, table.id),
    transitionUnique: uniqueIndex("runtime_quota_waits_transition_unique").on(table.workspaceId, table.transitionKey),
    eligibleIdx: index("runtime_quota_waits_eligible_idx").on(table.workspaceId, table.state, table.eligibleAt, table.createdAt),
    jsonShapeCheck: check("runtime_quota_waits_json_shape_check", sql`${table.wait} @> jsonb_build_object('schema', 'quota-wait/v1', 'id', ${table.id}, 'workspaceId', ${table.workspaceId}, 'admittedPrincipalId', ${table.admittedPrincipalId}, 'runId', ${table.runId}, 'transitionKey', ${table.transitionKey}, 'state', ${table.state}, 'reasonCode', ${table.reasonCode}) and ${table.wait} ?& array['eligibleAt','createdAt','resolvedAt'] and (jsonb_typeof(${table.wait}->'eligibleAt') = 'string' or jsonb_typeof(${table.wait}->'eligibleAt') = 'null') and jsonb_typeof(${table.wait}->'createdAt') = 'string' and (jsonb_typeof(${table.wait}->'resolvedAt') = 'string' or jsonb_typeof(${table.wait}->'resolvedAt') = 'null')`),
    runFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_quota_waits_run_fk" }).onDelete("restrict"),
    principalFk: foreignKey({ columns: [table.workspaceId, table.admittedPrincipalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_quota_waits_principal_fk" }).onDelete("restrict"),
    stateCheck: check("runtime_quota_waits_state_check", sql`${table.state} in ('waiting','resumed','cancelled') and ${table.reasonCode} = 'QUOTA_RENEWABLE_CAPACITY_EXHAUSTED'`),
    jsonScalarCheck: check("runtime_quota_waits_json_scalar_check", sql`${table.wait}->>'schema' = 'quota-wait/v1' and ${table.wait}->>'id' = ${table.id} and ${table.wait}->>'workspaceId' = ${table.workspaceId} and ${table.wait}->>'admittedPrincipalId' = ${table.admittedPrincipalId} and ${table.wait}->>'runId' = ${table.runId} and ${table.wait}->>'transitionKey' = ${table.transitionKey} and ${table.wait}->>'state' = ${table.state} and (${table.wait}->>'eligibleAt')::timestamptz is not distinct from ${table.eligibleAt} and ${table.wait}->>'reasonCode' = ${table.reasonCode} and (${table.wait}->>'createdAt')::timestamptz = ${table.createdAt} and (${table.wait}->>'resolvedAt')::timestamptz is not distinct from ${table.resolvedAt}`),
  }),
);

export const runtimeQuotaClaimReceipts = pgTable(
  "runtime_quota_claim_receipts",
  { workspaceId: text("workspace_id").notNull(), transitionKey: text("transition_key").notNull(), requestDigest: text("request_digest").notNull(), result: jsonb("result").$type<QuotaClaimCommitResult>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.transitionKey], name: "runtime_quota_claim_receipts_pk" }), workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_quota_claim_receipts_workspace_fk" }).onDelete("restrict"), digestCheck: check("runtime_quota_claim_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }),
);

export const runtimeQuotaTransitionReceipts = pgTable(
  "runtime_quota_transition_receipts",
  { workspaceId: text("workspace_id").notNull(), transitionId: text("transition_id").notNull(), requestDigest: text("request_digest").notNull(), result: jsonb("result").$type<QuotaTransitionCommitResult>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.transitionId], name: "runtime_quota_transition_receipts_pk" }), workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_quota_transition_receipts_workspace_fk" }).onDelete("restrict"), digestCheck: check("runtime_quota_transition_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }),
);

export const runtimeQuotaUsageReconciliationReceipts = pgTable(
  "runtime_quota_usage_reconciliation_receipts",
  { workspaceId: text("workspace_id").notNull(), reconciliationId: text("reconciliation_id").notNull(), requestDigest: text("request_digest").notNull(), result: jsonb("result").$type<QuotaUsageReconciliationCommitResult>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull() },
  (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.reconciliationId], name: "runtime_quota_usage_reconciliation_receipts_pk" }), workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_quota_usage_reconciliation_receipts_workspace_fk" }).onDelete("restrict"), digestCheck: check("runtime_quota_usage_reconciliation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }),
);

export const runtimeQuotaReservationEvents = pgTable(
  "runtime_quota_reservation_events",
  { id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), reservationId: text("reservation_id").notNull(), transitionId: text("transition_id").notNull(), eventType: text("event_type").notNull(), amount: text("amount").notNull(), evidenceRef: text("evidence_ref").notNull(), event: jsonb("event").$type<Record<string, unknown>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull() },
  (table) => ({ reservationFk: foreignKey({ columns: [table.workspaceId, table.reservationId], foreignColumns: [runtimeQuotaReservations.workspaceId, runtimeQuotaReservations.id], name: "runtime_quota_reservation_events_reservation_fk" }).onDelete("restrict"), reservationOccurredIdx: index("runtime_quota_reservation_events_reservation_occurred_idx").on(table.workspaceId, table.reservationId, table.occurredAt), valueCheck: check("runtime_quota_reservation_events_value_check", sql`${table.eventType} in ('held','settled','released') and ${table.amount} ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'`) }),
);

export const runtimeContractEvidenceBackfillQuarantine = pgTable(
  "runtime_contract_evidence_backfill_quarantine",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    resourceKind: text("resource_kind").notNull(),
    resourceReferenceDigest: text("resource_reference_digest").notNull(),
    canonicalOwnerDigest: text("canonical_owner_digest").notNull(),
    reasonCode: text("reason_code").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.resourceKind, table.resourceReferenceDigest],
      name: "runtime_contract_evidence_backfill_quarantine_pk",
    }),
    kindCheck: check("runtime_contract_evidence_backfill_quarantine_kind_check", sql`${table.resourceKind} in ('run','budget_reservation','quota_reservation','quota_wait')`),
    digestCheck: check("runtime_contract_evidence_backfill_quarantine_digest_check", sql`${table.resourceReferenceDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.canonicalOwnerDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    reasonCheck: check("runtime_contract_evidence_backfill_quarantine_reason_check", sql`${table.reasonCode} = 'LEGACY_PROJECTION_INVALID'`),
  }),
);

export const runtimeContractEvidenceVersions = pgTable(
  "runtime_contract_evidence_versions",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    resourceKind: text("resource_kind").$type<ContractEvidenceVersionRecord["resourceKind"]>().notNull(),
    resourceId: text("resource_id").notNull(),
    runOwnerId: text("run_owner_id").generatedAlwaysAs(sql`case when "resource_kind" = 'run' then "resource_id" else null end`),
    budgetReservationOwnerId: text("budget_reservation_owner_id").generatedAlwaysAs(sql`case when "resource_kind" = 'budget_reservation' then "resource_id" else null end`),
    quotaReservationOwnerId: text("quota_reservation_owner_id").generatedAlwaysAs(sql`case when "resource_kind" = 'quota_reservation' then "resource_id" else null end`),
    quotaWaitOwnerId: text("quota_wait_owner_id").generatedAlwaysAs(sql`case when "resource_kind" = 'quota_wait' then "resource_id" else null end`),
    version: integer("version").notNull(),
    canonicalDigest: text("canonical_digest").notNull(),
    projectionKind: text("projection_kind").$type<ContractEvidenceVersionRecord["projectionKind"]>().notNull(),
    projection: jsonb("projection").$type<ContractEvidenceVersionRecord["projection"]>().notNull(),
    projectionDigest: text("projection_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.resourceKind, table.resourceId, table.version],
      name: "runtime_contract_evidence_versions_pk",
    }),
    latestIdx: index("runtime_contract_evidence_versions_latest_idx").on(
      table.workspaceId,
      table.resourceKind,
      table.resourceId,
      table.version,
    ),
    runOwnerFk: foreignKey({
      columns: [table.workspaceId, table.runOwnerId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "runtime_contract_evidence_versions_run_owner_fk",
    }).onDelete("cascade"),
    budgetReservationOwnerFk: foreignKey({
      columns: [table.workspaceId, table.budgetReservationOwnerId],
      foreignColumns: [runtimeBudgetReservations.workspaceId, runtimeBudgetReservations.id],
      name: "runtime_contract_evidence_versions_budget_reservation_owner_fk",
    }).onDelete("cascade"),
    quotaReservationOwnerFk: foreignKey({
      columns: [table.workspaceId, table.quotaReservationOwnerId],
      foreignColumns: [runtimeQuotaReservations.workspaceId, runtimeQuotaReservations.id],
      name: "runtime_contract_evidence_versions_quota_reservation_owner_fk",
    }).onDelete("cascade"),
    quotaWaitOwnerFk: foreignKey({
      columns: [table.workspaceId, table.quotaWaitOwnerId],
      foreignColumns: [runtimeQuotaWaits.workspaceId, runtimeQuotaWaits.id],
      name: "runtime_contract_evidence_versions_quota_wait_owner_fk",
    }).onDelete("cascade"),
    versionCheck: check("runtime_contract_evidence_versions_version_check", sql`${table.version} > 0`),
    digestCheck: check("runtime_contract_evidence_versions_digest_check", sql`${table.canonicalDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.projectionDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    kindCheck: check("runtime_contract_evidence_versions_kind_check", sql`(
      (${table.resourceKind} = 'run' and ${table.projectionKind} = 'run_summary' and ${table.projection}->>'schema' = 'support-run-summary/v1' and ${table.projection}->>'id' = ${table.resourceId}) or
      (${table.resourceKind} = 'budget_reservation' and ${table.projectionKind} = 'budget_summary' and ${table.projection}->>'schema' = 'support-budget-summary/v1' and ${table.projection}->>'id' = ${table.resourceId}) or
      (${table.resourceKind} = 'quota_reservation' and ${table.projectionKind} = 'quota_reservation_summary' and ${table.projection}->>'schema' = 'support-quota-reservation-summary/v1' and ${table.projection}->>'id' = ${table.resourceId}) or
      (${table.resourceKind} = 'quota_wait' and ${table.projectionKind} = 'quota_wait_summary' and ${table.projection}->>'schema' = 'support-quota-wait-summary/v1' and ${table.projection}->>'id' = ${table.resourceId})
    )`),
    ownerCheck: check("runtime_contract_evidence_versions_owner_check", sql`
      num_nonnulls(${table.runOwnerId}, ${table.budgetReservationOwnerId}, ${table.quotaReservationOwnerId}, ${table.quotaWaitOwnerId}) = 1
      and (
        (${table.resourceKind} = 'run' and ${table.runOwnerId} = ${table.resourceId}) or
        (${table.resourceKind} = 'budget_reservation' and ${table.budgetReservationOwnerId} = ${table.resourceId}) or
        (${table.resourceKind} = 'quota_reservation' and ${table.quotaReservationOwnerId} = ${table.resourceId}) or
        (${table.resourceKind} = 'quota_wait' and ${table.quotaWaitOwnerId} = ${table.resourceId})
      )
    `),
    projectionCheck: check("runtime_contract_evidence_versions_projection_check", sql`
      runtime_contract_evidence_projection_is_valid(
        ${table.resourceKind},
        ${table.resourceId},
        ${table.projectionKind},
        ${table.projection}
      )
    `),
  }),
);

export const runtimeObservabilityRetentionPolicies = pgTable("runtime_observability_retention_policies", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().unique(), currentRevisionId: text("current_revision_id").notNull(), status: text("status").notNull(), policy: jsonb("policy").$type<ObservabilityRetentionPolicy>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_observability_retention_policies_workspace_fk" }).onDelete("restrict"), stateCheck: check("runtime_observability_retention_policies_state_check", sql`${table.status} in ('active','expired')`) }));

export const runtimeObservabilityRetentionRevisions = pgTable("runtime_observability_retention_revisions", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), policyId: text("policy_id").notNull(), revision: integer("revision").notNull(), metricTtlSeconds: integer("metric_ttl_seconds").notNull(), traceTtlSeconds: integer("trace_ttl_seconds").notNull(), supportBundleTtlSeconds: integer("support_bundle_ttl_seconds").notNull(), revisionRecord: jsonb("revision_record").$type<ObservabilityRetentionRevision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ policyRevisionUnique: uniqueIndex("runtime_observability_retention_revisions_policy_revision_unique").on(table.workspaceId, table.policyId, table.revision), policyFk: foreignKey({ columns: [table.policyId], foreignColumns: [runtimeObservabilityRetentionPolicies.id], name: "runtime_observability_retention_revisions_policy_fk" }).onDelete("restrict"), ttlCheck: check("runtime_observability_retention_revisions_ttl_check", sql`${table.metricTtlSeconds} between 60 and 31536000 and ${table.traceTtlSeconds} between 60 and 2592000 and ${table.supportBundleTtlSeconds} between 60 and 604800`) }));

export const runtimeObservabilityAdminReceipts = pgTable("runtime_observability_admin_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), resourceId: text("resource_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.idempotencyKey], name: "runtime_observability_admin_receipts_pk" }), digestCheck: check("runtime_observability_admin_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const runtimeOperationalMetrics = pgTable("runtime_operational_metrics", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), name: text("name").notNull(), metric: jsonb("metric").$type<OperationalMetricAggregate>().notNull(), windowStartsAt: timestamp("window_starts_at", { withTimezone: true }).notNull(), windowEndsAt: timestamp("window_ends_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ expiryIdx: index("runtime_operational_metrics_expiry_idx").on(table.expiresAt, table.id), nameCheck: check("runtime_operational_metrics_name_check", sql`${table.name} in ('runtime.run.count','runtime.provider.effect.count','runtime.quota.decision.count','runtime.artifact.bytes','runtime.queue.wait_ms')`), leakageCheck: check("runtime_operational_metrics_leakage_check", sql`${table.metric}::text !~* '(prompt|content|secret|token|password|ciphertext|signed[_-]?url|authorization|headers?|provider[_-]?body|resourceId|runId|artifactId|principalId)'`) }));

export const runtimeOperationalMetricDeltaReceipts = pgTable("runtime_operational_metric_delta_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), eventId: text("event_id").notNull(), requestDigest: text("request_digest").notNull(), aggregateId: text("aggregate_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.eventId], name: "runtime_operational_metric_delta_receipts_pk" }), aggregateFk: foreignKey({ columns: [table.aggregateId], foreignColumns: [runtimeOperationalMetrics.id], name: "runtime_operational_metric_delta_receipts_aggregate_fk" }).onDelete("cascade"), digestCheck: check("runtime_operational_metric_delta_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const runtimeDiagnosticTraces = pgTable("runtime_diagnostic_traces", {
  operatorTraceRef: text("operator_trace_ref").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), trace: jsonb("trace").$type<DiagnosticTrace>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({ expiryIdx: index("runtime_diagnostic_traces_expiry_idx").on(table.expiresAt, table.operatorTraceRef), refCheck: check("runtime_diagnostic_traces_ref_check", sql`${table.operatorTraceRef} ~ '^otr_[a-f0-9]{32}$'`), leakageCheck: check("runtime_diagnostic_traces_leakage_check", sql`jsonb_typeof(${table.trace}) = 'object' and ${table.trace} ?& array['schema','operatorTraceRef','workspaceId','category','severity','code','stage','outcome','providerFamily','httpStatus','retryable','durationMs','attempt','createdAt','expiresAt'] and (${table.trace} - array['schema','operatorTraceRef','workspaceId','category','severity','code','stage','outcome','providerFamily','httpStatus','retryable','durationMs','attempt','createdAt','expiresAt']) = '{}'::jsonb and ${table.trace}->>'schema' = 'diagnostic-trace/v1' and ${table.trace}->>'operatorTraceRef' = ${table.operatorTraceRef} and ${table.trace}->>'workspaceId' = ${table.workspaceId} and ${table.trace}->>'category' in ('authorization','provider','persistence','quota','budget','artifact','runtime') and ${table.trace}->>'severity' in ('info','warning','error') and ${table.trace}->>'stage' in ('admission','planning','execution','settlement','reconciliation','storage') and ${table.trace}->>'outcome' in ('succeeded','failed','unknown','denied','waiting') and ${table.trace}->>'providerFamily' in ('google','openai','kie','internal','unknown') and ${table.trace}->>'code' ~ '^[A-Z][A-Z0-9_]{0,79}$' and case when jsonb_typeof(${table.trace}->'httpStatus') = 'number' then (${table.trace}->>'httpStatus')::integer between 100 and 599 else jsonb_typeof(${table.trace}->'httpStatus') = 'null' end and jsonb_typeof(${table.trace}->'retryable') in ('boolean','null') and case when jsonb_typeof(${table.trace}->'durationMs') = 'number' then (${table.trace}->>'durationMs')::bigint >= 0 else jsonb_typeof(${table.trace}->'durationMs') = 'null' end and case when jsonb_typeof(${table.trace}->'attempt') = 'number' then (${table.trace}->>'attempt')::integer >= 1 else jsonb_typeof(${table.trace}->'attempt') = 'null' end and jsonb_typeof(${table.trace}->'createdAt') = 'string' and (${table.trace}->>'createdAt')::timestamptz = ${table.createdAt} and jsonb_typeof(${table.trace}->'expiresAt') = 'string' and (${table.trace}->>'expiresAt')::timestamptz = ${table.expiresAt}`) }));

export const runtimeDiagnosticTraceAccessAudits = pgTable("runtime_diagnostic_trace_access_audits", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), operatorTraceRef: text("operator_trace_ref").notNull(), operatorId: text("operator_id").notNull(), outcome: text("outcome").notNull(), audit: jsonb("audit").$type<DiagnosticTraceAccessAuditEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ occurredIdx: index("runtime_diagnostic_trace_access_audits_occurred_idx").on(table.workspaceId, table.occurredAt, table.id), outcomeCheck: check("runtime_diagnostic_trace_access_audits_outcome_check", sql`${table.outcome} in ('granted','denied','not_found')`) }));

export const runtimeTelemetryOperatorGrants = pgTable("runtime_telemetry_operator_grants", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), operatorId: text("operator_id").notNull(), status: text("status").notNull(), grant: jsonb("grant").$type<WorkspaceTelemetryOperatorGrant>().notNull(), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({ workspaceIdUnique: uniqueIndex("runtime_telemetry_operator_grants_workspace_id_unique").on(table.workspaceId, table.id), activeIdx: index("runtime_telemetry_operator_grants_active_idx").on(table.workspaceId, table.operatorId, table.status, table.expiresAt), stateCheck: check("runtime_telemetry_operator_grants_state_check", sql`${table.status} in ('active','revoked','expired')`) }));

export const runtimeTelemetryOperatorGrantAudits = pgTable("runtime_telemetry_operator_grant_audits", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), grantId: text("grant_id").notNull(), eventType: text("event_type").notNull(), audit: jsonb("audit").$type<OperatorGrantAuditEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ grantFk: foreignKey({ columns: [table.workspaceId, table.grantId], foreignColumns: [runtimeTelemetryOperatorGrants.workspaceId, runtimeTelemetryOperatorGrants.id], name: "runtime_telemetry_operator_grant_audits_grant_fk" }).onDelete("restrict"), eventCheck: check("runtime_telemetry_operator_grant_audits_event_check", sql`${table.eventType} in ('grant.issued','grant.revoked','grant.expired')`) }));

export const runtimeSupportBundles = pgTable("runtime_support_bundles", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), state: text("state").notNull(), bundle: jsonb("bundle").$type<SupportBundleRecord>().notNull(), storageKey: text("storage_key"), contentDigest: text("content_digest"), sizeBytes: integer("size_bytes").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), storedAt: timestamp("stored_at", { withTimezone: true }).notNull(),
}, (table) => ({ workspaceIdUnique: uniqueIndex("runtime_support_bundles_workspace_id_unique").on(table.workspaceId, table.id), expiryIdx: index("runtime_support_bundles_expiry_idx").on(table.expiresAt, table.id), stateCheck: check("runtime_support_bundles_state_check", sql`${table.state} in ('stored','expired','revoked')`), digestCheck: check("runtime_support_bundles_digest_check", sql`${table.contentDigest} is null or ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$'`), sizeCheck: check("runtime_support_bundles_size_check", sql`${table.sizeBytes} between 1 and 10000000`) }));

export const runtimeSupportBundleBindIntents = pgTable("runtime_support_bundle_bind_intents", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), state: text("state").notNull(), selections: jsonb("selections").$type<SupportBundleBindIntent["selections"]>().notNull(), consent: jsonb("consent").$type<SupportBundleBindIntent["consent"]>().notNull(), contentDigest: text("content_digest").notNull(), sizeBytes: integer("size_bytes").notNull(), storageKey: text("storage_key").notNull(), payloadJson: text("payload_json"), bundleId: text("bundle_id"), consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  workspaceKeyUnique: uniqueIndex("runtime_support_bundle_bind_intents_workspace_key_unique").on(table.workspaceId, table.idempotencyKey),
  pendingIdx: index("runtime_support_bundle_bind_intents_pending_idx").on(table.state, table.updatedAt, table.id),
  bundleFk: foreignKey({ columns: [table.workspaceId, table.bundleId], foreignColumns: [runtimeSupportBundles.workspaceId, runtimeSupportBundles.id], name: "runtime_support_bundle_bind_intents_bundle_fk" }).onDelete("restrict"),
  digestCheck: check("runtime_support_bundle_bind_intents_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  sizeCheck: check("runtime_support_bundle_bind_intents_size_check", sql`${table.sizeBytes} between 1 and 10000000 and (${table.payloadJson} is null or octet_length(${table.payloadJson}) between 1 and 10000000)`),
  stateCheck: check("runtime_support_bundle_bind_intents_state_check", sql`(${table.state} = 'pending' and ${table.payloadJson} is not null and ${table.bundleId} is null) or (${table.state} in ('bound','cleanup') and ${table.payloadJson} is null and ${table.bundleId} is not null) or (${table.state} = 'abandoned' and ${table.payloadJson} is null and ${table.bundleId} is null)`),
}));

export const runtimeSupportBundleAuditEvents = pgTable("runtime_support_bundle_audit_events", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), bundleId: text("bundle_id").notNull(), eventType: text("event_type").notNull(), audit: jsonb("audit").$type<SupportBundleAuditEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ bundleFk: foreignKey({ columns: [table.workspaceId, table.bundleId], foreignColumns: [runtimeSupportBundles.workspaceId, runtimeSupportBundles.id], name: "runtime_support_bundle_audit_events_bundle_fk" }).onDelete("restrict"), occurredIdx: index("runtime_support_bundle_audit_events_occurred_idx").on(table.workspaceId, table.occurredAt, table.id), eventCheck: check("runtime_support_bundle_audit_events_event_check", sql`${table.eventType} in ('bundle.stored','bundle.expired','bundle.revoked')`) }));

export const runtimeSupportBundleAccessAudits = pgTable("runtime_support_bundle_access_audits", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), bundleId: text("bundle_id").notNull(), operatorId: text("operator_id").notNull(), outcome: text("outcome").notNull(), audit: jsonb("audit").$type<SupportBundleAccessAuditEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ occurredIdx: index("runtime_support_bundle_access_audits_occurred_idx").on(table.workspaceId, table.occurredAt, table.id), outcomeCheck: check("runtime_support_bundle_access_audits_outcome_check", sql`${table.outcome} in ('granted','denied','not_found')`) }));

export const runtimeSupportBundleReceipts = pgTable("runtime_support_bundle_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), bundleId: text("bundle_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.idempotencyKey], name: "runtime_support_bundle_receipts_pk" }), digestCheck: check("runtime_support_bundle_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

/** Stable Automation identities. Immutable definitions live in revision rows. */
export const runtimeAutomations = pgTable(
  "runtime_automations",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    controlState: text("control_state").notNull(),
    controlVersion: integer("control_version").notNull(),
    nextRevision: integer("next_revision").notNull(),
    nextEventSequence: integer("next_event_sequence").notNull(),
    createdByPrincipalId: text("created_by_principal_id").notNull(),
    record: jsonb("record").$type<AutomationRecord>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.id], name: "runtime_automations_pk" }),
    workspaceFk: foreignKey({ columns: [table.workspaceId], foreignColumns: [workspaces.id], name: "runtime_automations_workspace_fk" }).onDelete("restrict"),
    creatorFk: foreignKey({ columns: [table.workspaceId, table.createdByPrincipalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_automations_creator_fk" }).onDelete("restrict"),
    workspaceStateIdx: index("runtime_automations_workspace_state_idx").on(table.workspaceId, table.controlState, table.id),
    stateCheck: check("runtime_automations_state_check", sql`${table.controlState} in ('active','paused','retired')`),
    countersCheck: check("runtime_automations_counters_check", sql`${table.controlVersion} > 0 and ${table.nextRevision} > 0 and ${table.nextEventSequence} > 0`),
  }),
);

export const runtimeAutomationRevisions = pgTable(
  "runtime_automation_revisions",
  {
    workspaceId: text("workspace_id").notNull(),
    automationId: text("automation_id").notNull(),
    id: text("id").notNull(),
    revision: integer("revision").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowRevisionId: text("workflow_revision_id").notNull(),
    workflowRevision: integer("workflow_revision").notNull(),
    workflowDefinitionDigest: text("workflow_definition_digest").notNull(),
    record: jsonb("record").$type<AutomationRevisionRecord>().notNull(),
    authorPrincipalId: text("author_principal_id").notNull(),
    authorKeyId: text("author_key_id").notNull(),
    creationAuthorizationEvidenceRef: text("creation_authorization_evidence_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.automationId, table.id], name: "runtime_automation_revisions_pk" }),
    automationRevisionUnique: uniqueIndex("runtime_automation_revisions_number_unique").on(table.workspaceId, table.automationId, table.revision),
    automationIdentityUnique: uniqueIndex("runtime_automation_revisions_identity_unique").on(table.workspaceId, table.automationId, table.id, table.revision),
    automationFk: foreignKey({ columns: [table.workspaceId, table.automationId], foreignColumns: [runtimeAutomations.workspaceId, runtimeAutomations.id], name: "runtime_automation_revisions_automation_fk" }).onDelete("restrict"),
    authorFk: foreignKey({ columns: [table.workspaceId, table.authorPrincipalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_automation_revisions_author_fk" }).onDelete("restrict"),
    authorKeyFk: foreignKey({ columns: [table.authorPrincipalId, table.authorKeyId], foreignColumns: [agentKeys.principalId, agentKeys.id], name: "runtime_automation_revisions_author_key_fk" }).onDelete("restrict"),
    evidenceFk: foreignKey({ columns: [table.workspaceId, table.authorPrincipalId, table.authorKeyId, table.creationAuthorizationEvidenceRef], foreignColumns: [agentAuthorizationDecisions.workspaceId, agentAuthorizationDecisions.principalId, agentAuthorizationDecisions.keyId, agentAuthorizationDecisions.operatorTraceRef], name: "runtime_automation_revisions_evidence_fk" }).onDelete("restrict"),
    workflowRevisionFk: foreignKey({ columns: [table.workspaceId, table.workflowId, table.workflowRevisionId, table.workflowRevision, table.workflowDefinitionDigest], foreignColumns: [contentWorkflowRevisions.workspaceId, contentWorkflowRevisions.workflowId, contentWorkflowRevisions.id, contentWorkflowRevisions.revision, contentWorkflowRevisions.definitionDigest], name: "runtime_automation_revisions_workflow_revision_fk" }).onDelete("restrict"),
    digestCheck: check("runtime_automation_revisions_digest_check", sql`${table.definitionDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.workflowDefinitionDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.revision} > 0 and ${table.workflowRevision} > 0`),
  }),
);

export const runtimeAutomationRevisionArtifactBindings = pgTable(
  "runtime_automation_revision_artifact_bindings",
  {
    workspaceId: text("workspace_id").notNull(),
    automationId: text("automation_id").notNull(),
    revisionId: text("revision_id").notNull(),
    position: integer("position").notNull(),
    inputName: text("input_name").notNull(),
    artifactId: text("artifact_id").notNull(),
    contentDigest: text("content_digest").notNull(),
    kind: text("kind").notNull(),
    origin: text("origin").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.automationId, table.revisionId, table.inputName], name: "runtime_automation_revision_artifact_bindings_pk" }),
    positionUnique: uniqueIndex("runtime_automation_revision_artifact_bindings_position_unique").on(table.workspaceId, table.automationId, table.revisionId, table.position),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.revisionId], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id], name: "runtime_automation_revision_artifact_bindings_revision_fk" }).onDelete("restrict"),
    artifactContentFk: foreignKey({ columns: [table.workspaceId, table.artifactId, table.kind, table.contentDigest], foreignColumns: [artifacts.workspaceId, artifacts.id, artifacts.kind, artifacts.contentDigest], name: "runtime_automation_revision_artifact_bindings_artifact_content_fk" }).onDelete("restrict"),
    artifactOriginFk: foreignKey({ columns: [table.workspaceId, table.artifactId, table.origin], foreignColumns: [artifacts.workspaceId, artifacts.id, artifacts.origin], name: "runtime_automation_revision_artifact_bindings_artifact_origin_fk" }).onDelete("restrict"),
    positionCheck: check("runtime_automation_revision_artifact_bindings_position_check", sql`${table.position} >= 0 and length(${table.inputName}) between 1 and 200 and ${table.kind} = 'image' and ${table.origin} = 'imported' and ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeAutomationActiveRevisions = pgTable(
  "runtime_automation_active_revisions",
  {
    workspaceId: text("workspace_id").notNull(),
    automationId: text("automation_id").notNull(),
    revisionId: text("revision_id").notNull(),
    revision: integer("revision").notNull(),
    activationId: text("activation_id").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.automationId], name: "runtime_automation_active_revisions_pk" }),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.revisionId, table.revision], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id, runtimeAutomationRevisions.revision], name: "runtime_automation_active_revisions_revision_fk" }).onDelete("restrict"),
    revisionCheck: check("runtime_automation_active_revisions_revision_check", sql`${table.revision} > 0`),
  }),
);

export const runtimeAutomationRevisionActivations = pgTable(
  "runtime_automation_revision_activations",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), id: text("id").notNull(), revisionId: text("revision_id").notNull(), revision: integer("revision").notNull(), priorRevisionId: text("prior_revision_id"), actorPrincipalId: text("actor_principal_id").notNull(), actorKeyId: text("actor_key_id").notNull(), authorizationEvidenceRef: text("authorization_evidence_ref").notNull(), record: jsonb("record").$type<AutomationRevisionActivationRecord>().notNull(), activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.automationId, table.id], name: "runtime_automation_revision_activations_pk" }),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.revisionId], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id], name: "runtime_automation_revision_activations_revision_fk" }).onDelete("restrict"),
    priorRevisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.priorRevisionId], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id], name: "runtime_automation_revision_activations_prior_revision_fk" }).onDelete("restrict"),
    actorKeyFk: foreignKey({ columns: [table.actorPrincipalId, table.actorKeyId], foreignColumns: [agentKeys.principalId, agentKeys.id], name: "runtime_automation_revision_activations_actor_key_fk" }).onDelete("restrict"),
    evidenceFk: foreignKey({ columns: [table.workspaceId, table.actorPrincipalId, table.actorKeyId, table.authorizationEvidenceRef], foreignColumns: [agentAuthorizationDecisions.workspaceId, agentAuthorizationDecisions.principalId, agentAuthorizationDecisions.keyId, agentAuthorizationDecisions.operatorTraceRef], name: "runtime_automation_revision_activations_evidence_fk" }).onDelete("restrict"),
    revisionCheck: check("runtime_automation_revision_activations_revision_check", sql`${table.revision} > 0`),
  }),
);

export const runtimeAutomationOccurrences = pgTable(
  "runtime_automation_occurrences",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), id: text("id").notNull(), automationRevisionId: text("automation_revision_id").notNull(), automationRevision: integer("automation_revision").notNull(), automationRevisionDigest: text("automation_revision_digest").notNull(), sourceOccurrenceKey: text("source_occurrence_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(), state: text("state").notNull(), stage: text("stage").notNull(), desiredState: text("desired_state").notNull(), requestingPrincipalId: text("requesting_principal_id").notNull(), requestingKeyId: text("requesting_key_id").notNull(), invocationAuthorizationEvidenceRef: text("invocation_authorization_evidence_ref").notNull(), workflowId: text("workflow_id").notNull(), workflowRevisionId: text("workflow_revision_id").notNull(), workflowRevision: integer("workflow_revision").notNull(), workflowDefinitionDigest: text("workflow_definition_digest").notNull(), workflowRunId: text("workflow_run_id"), workflowRunStartSnapshotDigest: text("workflow_run_start_snapshot_digest"), failureCode: text("failure_code"), cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }), record: jsonb("record").$type<AutomationOccurrenceRecord>().notNull(), acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(), startedAt: timestamp("started_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.id], name: "runtime_automation_occurrences_pk" }),
    sourceKeyUnique: uniqueIndex("runtime_automation_occurrences_source_key_unique").on(table.workspaceId, table.automationId, table.sourceOccurrenceKey),
    automationIdUnique: uniqueIndex("runtime_automation_occurrences_automation_id_unique").on(table.workspaceId, table.automationId, table.id),
    workflowRunUnique: uniqueIndex("runtime_automation_occurrences_workflow_run_unique").on(table.workspaceId, table.workflowRunId),
    automationFk: foreignKey({ columns: [table.workspaceId, table.automationId], foreignColumns: [runtimeAutomations.workspaceId, runtimeAutomations.id], name: "runtime_automation_occurrences_automation_fk" }).onDelete("restrict"),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.automationRevisionId], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id], name: "runtime_automation_occurrences_revision_fk" }).onDelete("restrict"),
    workflowRevisionFk: foreignKey({ columns: [table.workspaceId, table.workflowId, table.workflowRevisionId, table.workflowRevision, table.workflowDefinitionDigest], foreignColumns: [contentWorkflowRevisions.workspaceId, contentWorkflowRevisions.workflowId, contentWorkflowRevisions.id, contentWorkflowRevisions.revision, contentWorkflowRevisions.definitionDigest], name: "runtime_automation_occurrences_workflow_revision_fk" }).onDelete("restrict"),
    requesterKeyFk: foreignKey({ columns: [table.requestingPrincipalId, table.requestingKeyId], foreignColumns: [agentKeys.principalId, agentKeys.id], name: "runtime_automation_occurrences_requester_key_fk" }).onDelete("restrict"),
    invocationEvidenceFk: foreignKey({ columns: [table.workspaceId, table.requestingPrincipalId, table.requestingKeyId, table.invocationAuthorizationEvidenceRef], foreignColumns: [agentAuthorizationDecisions.workspaceId, agentAuthorizationDecisions.principalId, agentAuthorizationDecisions.keyId, agentAuthorizationDecisions.operatorTraceRef], name: "runtime_automation_occurrences_invocation_evidence_fk" }).onDelete("restrict"),
    workflowRunFk: foreignKey({ columns: [table.workspaceId, table.workflowRunId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_automation_occurrences_workflow_run_fk" }).onDelete("restrict"),
    acceptedIdx: index("runtime_automation_occurrences_accepted_idx").on(table.workspaceId, table.automationId, table.acceptedAt, table.id),
    stateCheck: check("runtime_automation_occurrences_state_check", sql`${table.state} in ('queued','running','waiting','succeeded','failed','cancelled','skipped') and ${table.stage} in ('accepted','workflow_materialization','workflow_running','complete') and ${table.desiredState} in ('run','cancel')`),
    digestCheck: check("runtime_automation_occurrences_digest_check", sql`${table.automationRevisionDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.workflowDefinitionDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.workflowRevision} > 0 and ${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$' and (${table.workflowRunStartSnapshotDigest} is null or ${table.workflowRunStartSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$')`),
    runLinkCheck: check("runtime_automation_occurrences_run_link_check", sql`(${table.workflowRunId} is null and ${table.workflowRunStartSnapshotDigest} is null) or (${table.workflowRunId} is not null and ${table.workflowRunStartSnapshotDigest} is not null)`),
  }),
);

export const runtimeAutomationOccurrenceArtifacts = pgTable(
  "runtime_automation_occurrence_artifacts",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), occurrenceId: text("occurrence_id").notNull(), position: integer("position").notNull(), artifactId: text("artifact_id").notNull(), contentDigest: text("content_digest").notNull(), kind: text("kind").notNull(), origin: text("origin").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.occurrenceId, table.position], name: "runtime_automation_occurrence_artifacts_pk" }),
    artifactUnique: uniqueIndex("runtime_automation_occurrence_artifacts_unique").on(table.workspaceId, table.occurrenceId, table.artifactId),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.occurrenceId], foreignColumns: [runtimeAutomationOccurrences.workspaceId, runtimeAutomationOccurrences.automationId, runtimeAutomationOccurrences.id], name: "runtime_automation_occurrence_artifacts_occurrence_fk" }).onDelete("restrict"),
    artifactContentFk: foreignKey({ columns: [table.workspaceId, table.artifactId, table.kind, table.contentDigest], foreignColumns: [artifacts.workspaceId, artifacts.id, artifacts.kind, artifacts.contentDigest], name: "runtime_automation_occurrence_artifacts_artifact_content_fk" }).onDelete("restrict"),
    artifactOriginFk: foreignKey({ columns: [table.workspaceId, table.artifactId, table.origin], foreignColumns: [artifacts.workspaceId, artifacts.id, artifacts.origin], name: "runtime_automation_occurrence_artifacts_artifact_origin_fk" }).onDelete("restrict"),
    positionCheck: check("runtime_automation_occurrence_artifacts_position_check", sql`${table.position} >= 0 and ${table.kind} = 'image' and ${table.origin} = 'imported' and ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const runtimeAutomationStageAttempts = pgTable(
  "runtime_automation_stage_attempts",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), occurrenceId: text("occurrence_id").notNull(), id: text("id").notNull(), stage: text("stage").notNull(), attempt: integer("attempt").notNull(), effectKey: text("effect_key").notNull(), state: text("state").notNull(), workflowRunId: text("workflow_run_id"), failureCode: text("failure_code"), record: jsonb("record").$type<AutomationStageAttemptRecord>().notNull(), startedAt: timestamp("started_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.occurrenceId, table.id], name: "runtime_automation_stage_attempts_pk" }),
    attemptUnique: uniqueIndex("runtime_automation_stage_attempts_number_unique").on(table.workspaceId, table.occurrenceId, table.stage, table.attempt),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.occurrenceId], foreignColumns: [runtimeAutomationOccurrences.workspaceId, runtimeAutomationOccurrences.automationId, runtimeAutomationOccurrences.id], name: "runtime_automation_stage_attempts_occurrence_fk" }).onDelete("restrict"),
    workflowRunFk: foreignKey({ columns: [table.workspaceId, table.workflowRunId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_automation_stage_attempts_workflow_run_fk" }).onDelete("restrict"),
    stateCheck: check("runtime_automation_stage_attempts_state_check", sql`${table.stage} = 'workflow_materialization' and ${table.state} in ('running','succeeded','failed') and ${table.attempt} > 0`),
    resultCheck: check("runtime_automation_stage_attempts_result_check", sql`(${table.state} = 'running' and ${table.completedAt} is null and ${table.workflowRunId} is null and ${table.failureCode} is null) or (${table.state} = 'succeeded' and ${table.completedAt} is not null and ${table.workflowRunId} is not null and ${table.failureCode} is null) or (${table.state} = 'failed' and ${table.completedAt} is not null and ${table.workflowRunId} is null and ${table.failureCode} is not null)`),
  }),
);

export const runtimeAutomationEvents = pgTable(
  "runtime_automation_events",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), id: text("id").notNull(), sequence: integer("sequence").notNull(), type: text("type").notNull(), occurrenceId: text("occurrence_id"), revisionId: text("revision_id"), evidence: jsonb("evidence").$type<AutomationEventRecord["evidence"]>().notNull(), record: jsonb("record").$type<AutomationEventRecord>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.automationId, table.id], name: "runtime_automation_events_pk" }),
    sequenceUnique: uniqueIndex("runtime_automation_events_sequence_unique").on(table.workspaceId, table.automationId, table.sequence),
    automationFk: foreignKey({ columns: [table.workspaceId, table.automationId], foreignColumns: [runtimeAutomations.workspaceId, runtimeAutomations.id], name: "runtime_automation_events_automation_fk" }).onDelete("restrict"),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.occurrenceId], foreignColumns: [runtimeAutomationOccurrences.workspaceId, runtimeAutomationOccurrences.automationId, runtimeAutomationOccurrences.id], name: "runtime_automation_events_occurrence_fk" }).onDelete("restrict"),
    revisionFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.revisionId], foreignColumns: [runtimeAutomationRevisions.workspaceId, runtimeAutomationRevisions.automationId, runtimeAutomationRevisions.id], name: "runtime_automation_events_revision_fk" }).onDelete("restrict"),
    sequenceIdx: index("runtime_automation_events_sequence_idx").on(table.workspaceId, table.automationId, table.sequence),
    sequenceCheck: check("runtime_automation_events_sequence_check", sql`${table.sequence} > 0`),
    typeCheck: check("runtime_automation_events_type_check", sql`${table.type} in ('automation.created','automation.revision_created','automation.revision_activated','occurrence.accepted','occurrence.materialization_started','occurrence.workflow_materialized','occurrence.materialization_failed','occurrence.cancellation_requested','occurrence.cancelled','occurrence.succeeded','occurrence.failed','occurrence.retry_derived')`),
  }),
);

export const runtimeAutomationMutationReceipts = pgTable(
  "runtime_automation_mutation_receipts",
  {
    workspaceId: text("workspace_id").notNull(), principalId: text("principal_id").notNull(), keyId: text("key_id").notNull(), authorizationEvidenceRef: text("authorization_evidence_ref").notNull(), capability: text("capability").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(), resourceId: text("resource_id").notNull(), result: jsonb("result").$type<unknown>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.principalId, table.capability, table.idempotencyKey], name: "runtime_automation_mutation_receipts_pk" }),
    principalFk: foreignKey({ columns: [table.workspaceId, table.principalId], foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id], name: "runtime_automation_mutation_receipts_principal_fk" }).onDelete("restrict"),
    keyFk: foreignKey({ columns: [table.principalId, table.keyId], foreignColumns: [agentKeys.principalId, agentKeys.id], name: "runtime_automation_mutation_receipts_key_fk" }).onDelete("restrict"),
    evidenceFk: foreignKey({ columns: [table.workspaceId, table.principalId, table.keyId, table.authorizationEvidenceRef], foreignColumns: [agentAuthorizationDecisions.workspaceId, agentAuthorizationDecisions.principalId, agentAuthorizationDecisions.keyId, agentAuthorizationDecisions.operatorTraceRef], name: "runtime_automation_mutation_receipts_evidence_fk" }).onDelete("restrict"),
    fingerprintCheck: check("runtime_automation_mutation_receipts_fingerprint_check", sql`${table.requestFingerprint} ~ '^sha256:[a-f0-9]{64}$'`),
    capabilityCheck: check("runtime_automation_mutation_receipts_capability_check", sql`${table.capability} in ('automations.create@1','automation_revisions.create@1','automation_revisions.activate@1','automations.invoke@1','automation_occurrences.cancel@1','automation_occurrences.retry@1')`),
  }),
);

export const runtimeAutomationOutboxIntents = pgTable(
  "runtime_automation_outbox_intents",
  {
    id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), occurrenceId: text("occurrence_id").notNull(), purpose: text("purpose").notNull(), generation: integer("generation").notNull(), dedupeKey: text("dedupe_key").notNull(), state: text("state").notNull(), availableAt: timestamp("available_at", { withTimezone: true }).notNull(), claimToken: text("claim_token"), deliveryAttempts: integer("delivery_attempts").default(0).notNull(), claimedAt: timestamp("claimed_at", { withTimezone: true }), deliveredAt: timestamp("delivered_at", { withTimezone: true }), cancelledAt: timestamp("cancelled_at", { withTimezone: true }), record: jsonb("record").$type<AutomationOutboxIntentRecord>().notNull(),
  },
  (table) => ({
    occurrenceGenerationUnique: uniqueIndex("runtime_automation_outbox_occurrence_generation_unique").on(table.workspaceId, table.occurrenceId, table.generation),
    dedupeKeyUnique: uniqueIndex("runtime_automation_outbox_dedupe_key_unique").on(table.dedupeKey),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.occurrenceId], foreignColumns: [runtimeAutomationOccurrences.workspaceId, runtimeAutomationOccurrences.automationId, runtimeAutomationOccurrences.id], name: "runtime_automation_outbox_occurrence_fk" }).onDelete("restrict"),
    claimIdx: index("runtime_automation_outbox_claim_idx").on(table.state, table.availableAt, table.id),
    stateCheck: check("runtime_automation_outbox_state_check", sql`${table.purpose} in ('materialize_workflow','observe_workflow','cancel_workflow') and ${table.state} in ('pending','claimed','delivered','cancelled') and ${table.generation} > 0 and ${table.deliveryAttempts} >= 0`),
    lifecycleCheck: check("runtime_automation_outbox_lifecycle_check", sql`(${table.state} = 'pending' and ${table.claimToken} is null and ${table.claimedAt} is null and ${table.deliveredAt} is null and ${table.cancelledAt} is null) or (${table.state} = 'claimed' and ${table.claimToken} is not null and ${table.claimedAt} is not null and ${table.deliveredAt} is null and ${table.cancelledAt} is null) or (${table.state} = 'delivered' and ${table.claimToken} is null and ${table.claimedAt} is not null and ${table.deliveredAt} is not null and ${table.cancelledAt} is null) or (${table.state} = 'cancelled' and ${table.claimToken} is null and ${table.deliveredAt} is null and ${table.cancelledAt} is not null)`),
  }),
);

export const runtimeAutomationOccurrenceCancellations = pgTable(
  "runtime_automation_occurrence_cancellations",
  {
    workspaceId: text("workspace_id").notNull(), automationId: text("automation_id").notNull(), occurrenceId: text("occurrence_id").notNull(), id: text("id").notNull(), requestingPrincipalId: text("requesting_principal_id").notNull(), requestingKeyId: text("requesting_key_id").notNull(), authorizationEvidenceRef: text("authorization_evidence_ref").notNull(), disposition: text("disposition").notNull(), workflowRunId: text("workflow_run_id"), record: jsonb("record").$type<AutomationOccurrenceCancellationRecord>().notNull(), requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.occurrenceId], name: "runtime_automation_occurrence_cancellations_pk" }),
    idUnique: uniqueIndex("runtime_automation_occurrence_cancellations_id_unique").on(table.workspaceId, table.id),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.automationId, table.occurrenceId], foreignColumns: [runtimeAutomationOccurrences.workspaceId, runtimeAutomationOccurrences.automationId, runtimeAutomationOccurrences.id], name: "runtime_automation_occurrence_cancellations_occurrence_fk" }).onDelete("restrict"),
    requesterKeyFk: foreignKey({ columns: [table.requestingPrincipalId, table.requestingKeyId], foreignColumns: [agentKeys.principalId, agentKeys.id], name: "runtime_automation_occurrence_cancellations_requester_key_fk" }).onDelete("restrict"),
    evidenceFk: foreignKey({ columns: [table.workspaceId, table.requestingPrincipalId, table.requestingKeyId, table.authorizationEvidenceRef], foreignColumns: [agentAuthorizationDecisions.workspaceId, agentAuthorizationDecisions.principalId, agentAuthorizationDecisions.keyId, agentAuthorizationDecisions.operatorTraceRef], name: "runtime_automation_occurrence_cancellations_evidence_fk" }).onDelete("restrict"),
    workflowRunFk: foreignKey({ columns: [table.workspaceId, table.workflowRunId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "runtime_automation_occurrence_cancellations_workflow_run_fk" }).onDelete("restrict"),
    dispositionCheck: check("runtime_automation_occurrence_cancellations_disposition_check", sql`${table.disposition} in ('prevented','cancellation_requested','too_late')`),
  }),
);

/**
 * Workspace governance is a versioned resource ledger. Domain validation lives
 * in the governance service; these rows provide atomic optimistic updates,
 * Workspace isolation, and durable lifecycle projections without turning
 * Better Auth organization roles into business authority.
 */
export const workspaceGovernanceResources = pgTable(
  "workspace_governance_resources",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_governance_resources_pk",
      columns: [table.workspaceId, table.kind, table.id],
    }),
    workspaceKindStatusIdx: index(
      "workspace_governance_resources_workspace_kind_status_idx",
    ).on(table.workspaceId, table.kind, table.status, table.updatedAt),
    membershipProjectionClaimIdx: index(
      "workspace_governance_membership_projection_claim_idx",
    ).on(table.status, table.updatedAt).where(
      sql`${table.kind} = 'membership_projection' and ${table.status} in ('queued','retry_pending','processing')`,
    ),
    identityCheck: check(
      "workspace_governance_resources_identity_check",
      sql`${table.id} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.version} > 0 and length(${table.status}) between 1 and 80`,
    ),
    kindCheck: check(
      "workspace_governance_resources_kind_check",
      sql`${table.kind} in ('custom_role','member_role_assignment','invitation_binding','portfolio','portfolio_assignment','review_guest_grant','review_guest_session','approval_policy','approval_request','step_up_challenge','step_up_session','audit_export','workspace_export','workspace_import','data_region_policy','retention_policy','retention_hold','deletion_receipt','tombstone','safety_decision','safety_appeal','bulk_operation','workspace_closure','membership_projection')`,
    ),
    bodySizeCheck: check(
      "workspace_governance_resources_body_size_check",
      sql`octet_length(${table.body}::text) <= 2097152`,
    ),
  }),
);

/** Durable idempotency evidence for every governance mutation. */
export const workspaceGovernanceMutationReceipts = pgTable(
  "workspace_governance_mutation_receipts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    actorIdentity: text("actor_identity"),
    authContextDigest: text("auth_context_digest"),
    result: jsonb("result").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_governance_mutation_receipts_pk",
      columns: [table.workspaceId, table.capability, table.idempotencyKey],
    }),
    digestCheck: check(
      "workspace_governance_mutation_receipts_digest_check",
      sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.capability} ~ '^[a-z][a-z0-9_.]*@[1-9][0-9]*$' and length(${table.idempotencyKey}) between 8 and 200`,
    ),
    actorBindingCheck: check(
      "workspace_governance_mutation_receipts_actor_binding_check",
      sql`((${table.actorIdentity} is null and ${table.authContextDigest} is null) or (${table.actorIdentity} ~ '^(human|review_guest):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.authContextDigest} ~ '^sha256:[a-f0-9]{64}$'))`,
    ),
  }),
);

/** Encrypted, bounded retry delivery; permanent receipts remain redacted. */
export const workspaceGovernanceSecretDeliveries = pgTable(
  "workspace_governance_secret_deliveries",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    capability: text("capability").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    actorIdentity: text("actor_identity").notNull(),
    authContextDigest: text("auth_context_digest").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "workspace_governance_secret_deliveries_pk", columns: [table.workspaceId, table.capability, table.idempotencyKey] }),
    expiryIdx: index("workspace_governance_secret_deliveries_expiry_idx").on(table.expiresAt),
    digestCheck: check("workspace_governance_secret_deliveries_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    actorBindingCheck: check("workspace_governance_secret_deliveries_actor_binding_check", sql`${table.actorIdentity} ~ '^(human|review_guest):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.authContextDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    envelopeCheck: check("workspace_governance_secret_deliveries_envelope_check", sql`${table.encryptedPayload} like 'v1.%' and octet_length(${table.encryptedPayload}) <= 65536`),
  }),
);

/** Customer-visible append-only evidence; sensitive payloads are redacted before insertion. */
export const workspaceAuditTrailEvents = pgTable(
  "workspace_audit_trail_events",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    id: text("id").notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_audit_trail_events_pk",
      columns: [table.workspaceId, table.sequence],
    }),
    idUnique: uniqueIndex("workspace_audit_trail_events_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    workspaceTimeIdx: index("workspace_audit_trail_events_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
      table.sequence,
    ),
    sequenceCheck: check(
      "workspace_audit_trail_events_sequence_check",
      sql`${table.sequence} > 0 and octet_length(${table.event}::text) <= 65536`,
    ),
  }),
);

/**
 * Durable provenance and idempotency ledger for canonical Workspace imports.
 * The source payload is retained as portable customer data, never as authority:
 * role, credential, policy, and secret kinds are rejected before this boundary.
 */
export const workspacePortableImportRecords = pgTable(
  "workspace_portable_import_records",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    sourceManifestDigest: text("source_manifest_digest").notNull(),
    sourceId: text("source_id").notNull(),
    sourceDigest: text("source_digest").notNull(),
    destinationId: text("destination_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
    disposition: text("disposition").notNull(),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "workspace_portable_import_records_pk",
      columns: [table.workspaceId, table.idempotencyKey],
    }),
    sourceUnique: uniqueIndex("workspace_portable_import_records_source_unique").on(
      table.workspaceId,
      table.sourceManifestDigest,
      table.kind,
      table.sourceId,
    ),
    destinationIdx: index("workspace_portable_import_records_destination_idx").on(
      table.workspaceId,
      table.kind,
      table.destinationId,
    ),
    kindCheck: check(
      "workspace_portable_import_records_kind_check",
      sql`${table.kind} in ('media','content_revision','prompt','brand_source','calendar_plan','platform_export_metadata')`,
    ),
    digestCheck: check(
      "workspace_portable_import_records_digest_check",
      sql`${table.sourceManifestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.sourceDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    dispositionCheck: check(
      "workspace_portable_import_records_disposition_check",
      sql`${table.disposition} in ('created','matched','archived')`,
    ),
  }),
);

/**
 * Workspace-owned product records back the creator-facing surfaces that do not
 * belong to the generation or publishing runtimes. Their payloads are
 * validated by the product-surfaces module before crossing this boundary.
 * Revision provides optimistic concurrency; command receipts make writes
 * idempotent across retries and devices.
 */
export const workspaceProductRecords = pgTable(
  "workspace_product_records",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    revision: integer("revision").default(1).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.id],
      name: "workspace_product_records_pk",
    }),
    workspaceKindStateIdx: index(
      "workspace_product_records_workspace_kind_state_idx",
    ).on(table.workspaceId, table.kind, table.state, table.updatedAt),
    revisionCheck: check(
      "workspace_product_records_revision_check",
      sql`${table.revision} > 0`,
    ),
  }),
);

export const workspaceProductCommandReceipts = pgTable(
  "workspace_product_command_receipts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    recordId: text("record_id").notNull(),
    resultRevision: integer("result_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.workspaceId, table.idempotencyKey],
      name: "workspace_product_command_receipts_pk",
    }),
    recordFk: foreignKey({
      columns: [table.workspaceId, table.recordId],
      foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id],
      name: "workspace_product_command_receipts_record_fk",
    }).onDelete("restrict"),
    digestCheck: check(
      "workspace_product_command_receipts_digest_check",
      sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.resultRevision} > 0`,
    ),
  }),
);

/** Append-only snapshots preserve draft history without making files mutable. */
export const workspaceProductRecordRevisions = pgTable(
  "workspace_product_record_revisions",
  {
    workspaceId: text("workspace_id").notNull(),
    recordId: text("record_id").notNull(),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.recordId, table.revision], name: "workspace_product_record_revisions_pk" }),
    recordFk: foreignKey({ columns: [table.workspaceId, table.recordId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id], name: "workspace_product_record_revisions_record_fk" }).onDelete("restrict"),
    revisionCheck: check("workspace_product_record_revisions_revision_check", sql`${table.revision} > 0`),
  }),
);

/** Immutable, source-revision-bound Website and GEO measurements. */
export const productAnalyticsObservations = pgTable(
  "product_analytics_observations",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceKind: text("source_kind").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metric: text("metric").notNull(),
    value: integer("value").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowEndedAt: timestamp("window_ended_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    credentialDigest: text("credential_digest").notNull(),
    receiptSignature: text("receipt_signature").notNull(),
    scope: jsonb("scope").$type<{
      region: "mena" | "eu" | "other" | "unknown";
      consentRevision: string;
      consentPurpose: "analytics";
      retentionUntil: string;
      campaignTag: string | null;
      contentType: "page" | "article" | "landing_page" | "social_post" | "video" | "image" | "other";
      platform: "website" | "google" | "bing" | "chatgpt" | "perplexity" | "other";
      accountRefDigest: string | null;
      publishingState: "not_applicable" | "draft" | "queued" | "publishing" | "published" | "failed";
    }>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "product_analytics_observations_pk", columns: [table.workspaceId, table.id] }),
    idempotencyUnique: uniqueIndex("product_analytics_observations_idempotency_unique").on(table.workspaceId, table.sourceId, table.idempotencyKey),
    eventUnique: uniqueIndex("product_analytics_observations_event_unique").on(table.workspaceId, table.sourceId, table.eventId),
    sourceRevisionFk: foreignKey({ columns: [table.workspaceId, table.sourceId, table.sourceRevision], foreignColumns: [workspaceProductRecordRevisions.workspaceId, workspaceProductRecordRevisions.recordId, workspaceProductRecordRevisions.revision], name: "product_analytics_observations_source_revision_fk" }).onDelete("restrict"),
    rangeIdx: index("product_analytics_observations_range_idx").on(table.workspaceId, table.metric, table.windowEndedAt, table.id),
    sourceIdx: index("product_analytics_observations_source_idx").on(table.workspaceId, table.sourceId, table.windowEndedAt, table.id),
    sourceCheck: check("product_analytics_observations_source_check", sql`(${table.sourceKind} = 'website_analytics_source' and ${table.metric} = 'websiteViews' and ${table.eventType} = 'page_view') or (${table.sourceKind} = 'geo_analytics_source' and ${table.metric} = 'geoCitations' and ${table.eventType} = 'citation_observed')`),
    valueCheck: check("product_analytics_observations_value_check", sql`(${table.eventId} like 'legacy:%' and ${table.value} between 0 and 10000000) or (${table.eventId} not like 'legacy:%' and ${table.value} = 1)`),
    windowCheck: check("product_analytics_observations_window_check", sql`${table.windowEndedAt} > ${table.windowStartedAt} and ${table.windowEndedAt} <= ${table.windowStartedAt} + interval '24 hours' and ${table.occurredAt} >= ${table.windowStartedAt} and ${table.occurredAt} < ${table.windowEndedAt}`),
    digestCheck: check("product_analytics_observations_digest_check", sql`${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.credentialDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.receiptSignature} ~ '^hmac-sha256:[a-f0-9]{64}$' and ${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.eventId}) between 8 and 200 and length(${table.idempotencyKey}) between 8 and 200`),
    scopeCheck: check("product_analytics_observations_scope_check", sql`jsonb_typeof(${table.scope}) = 'object' and ${table.scope}->>'region' in ('mena','eu','other','unknown') and ${table.scope}->>'consentPurpose' = 'analytics' and length(${table.scope}->>'consentRevision') between 1 and 100 and (${table.scope}->>'retentionUntil')::timestamptz > ${table.capturedAt}`),
  }),
);

/** Recoverable, leased refresh work bound to one immutable Analytics source revision. */
export const productAnalyticsRefreshJobs = pgTable(
  "product_analytics_refresh_jobs",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceKind: text("source_kind").notNull(),
    state: text("state").notNull(),
    cursor: text("cursor"),
    processedEvents: integer("processed_events").default(0).notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    leaseOwner: text("lease_owner"),
    leaseEpoch: integer("lease_epoch").default(0).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastErrorCode: text("last_error_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "product_analytics_refresh_jobs_pk", columns: [table.workspaceId, table.id] }),
    commandUnique: uniqueIndex("product_analytics_refresh_jobs_command_unique").on(table.workspaceId, table.idempotencyKey),
    sourceRevisionFk: foreignKey({ columns: [table.workspaceId, table.sourceId, table.sourceRevision], foreignColumns: [workspaceProductRecordRevisions.workspaceId, workspaceProductRecordRevisions.recordId, workspaceProductRecordRevisions.revision], name: "product_analytics_refresh_jobs_source_revision_fk" }).onDelete("restrict"),
    dueIdx: index("product_analytics_refresh_jobs_due_idx").on(table.state, table.nextAttemptAt, table.leaseExpiresAt, table.id),
    sourceIdx: index("product_analytics_refresh_jobs_source_idx").on(table.workspaceId, table.sourceId, table.requestedAt, table.id),
    stateCheck: check("product_analytics_refresh_jobs_state_check", sql`${table.state} in ('queued','claimed','running','succeeded','failed_known','outcome_unknown') and ${table.sourceKind} in ('website_analytics_source','geo_analytics_source') and ${table.processedEvents} >= 0 and ${table.attempt} >= 0 and ${table.attempt} <= ${table.maxAttempts} and ${table.maxAttempts} between 1 and 20 and ${table.leaseEpoch} >= 0`),
    leaseCheck: check("product_analytics_refresh_jobs_lease_check", sql`(${table.state} in ('claimed','running') and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} not in ('claimed','running') and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`),
    digestCheck: check("product_analytics_refresh_jobs_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.idempotencyKey}) between 8 and 200`),
  }),
);

export const productCampaignOccurrences = pgTable(
  "product_campaign_occurrences",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignRevision: integer("campaign_revision").notNull(),
    campaignDigest: text("campaign_digest").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    format: text("format").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    state: text("state").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseGeneration: integer("lease_generation").default(0).notNull(),
    workflowRunId: text("workflow_run_id"),
    startSnapshotDigest: text("start_snapshot_digest"),
    quoteId: text("quote_id"),
    quotedAmount: text("quoted_amount"),
    currency: text("currency"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ name: "product_campaign_occurrences_pk", columns: [table.workspaceId, table.id] }),
    keyUnique: uniqueIndex("product_campaign_occurrences_key_unique").on(table.workspaceId, table.campaignId, table.occurrenceKey),
    campaignFk: foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id], name: "product_campaign_occurrences_campaign_fk" }).onDelete("restrict"),
    runFk: foreignKey({ columns: [table.workspaceId, table.workflowRunId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.id], name: "product_campaign_occurrences_run_fk" }).onDelete("restrict"),
    dueIdx: index("product_campaign_occurrences_due_idx").on(table.state, table.scheduledAt, table.id),
    campaignIdx: index("product_campaign_occurrences_campaign_idx").on(table.workspaceId, table.campaignId, table.scheduledAt, table.id),
    digestCheck: check("product_campaign_occurrences_digest_check", sql`${table.campaignRevision} > 0 and ${table.campaignDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    stateCheck: check("product_campaign_occurrences_state_check", sql`${table.state} in ('scheduled','claimed','submitting','running','succeeded','failed_known','outcome_unknown','cancelled')`),
    leaseCheck: check("product_campaign_occurrences_lease_check", sql`(${table.state} = 'claimed' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`),
    runCheck: check("product_campaign_occurrences_run_check", sql`(${table.workflowRunId} is null and ${table.startSnapshotDigest} is null) or (${table.workflowRunId} is not null and ${table.startSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$')`),
  }),
);

/** Campaign-local money and managed-credit exposure, reserved before a Workflow Run is submitted. */
export const productCampaignSpendReservations = pgTable(
  "product_campaign_spend_reservations",
  {
    workspaceId: text("workspace_id").notNull(),
    occurrenceId: text("occurrence_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignRevision: integer("campaign_revision").notNull(),
    quoteId: text("quote_id").notNull(),
    currency: text("currency").notNull(),
    quotedAmountCents: bigint("quoted_amount_cents", { mode: "number" }).notNull(),
    reservedCreditUnits: bigint("reserved_credit_units", { mode: "number" }).notNull(),
    creditUnitPriceUsd: text("credit_unit_price_usd"),
    state: text("state").notNull(),
    actualAmountCents: bigint("actual_amount_cents", { mode: "number" }),
    actualCreditUnits: bigint("actual_credit_units", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "product_campaign_spend_reservations_pk", columns: [table.workspaceId, table.occurrenceId] }),
    quoteUnique: uniqueIndex("product_campaign_spend_reservations_quote_unique").on(table.workspaceId, table.quoteId),
    occurrenceFk: foreignKey({ columns: [table.workspaceId, table.occurrenceId], foreignColumns: [productCampaignOccurrences.workspaceId, productCampaignOccurrences.id], name: "product_campaign_spend_reservations_occurrence_fk" }).onDelete("restrict"),
    campaignIdx: index("product_campaign_spend_reservations_campaign_idx").on(table.workspaceId, table.campaignId, table.state, table.createdAt),
    valuesCheck: check("product_campaign_spend_reservations_values_check", sql`${table.campaignRevision} > 0 and ${table.currency} = 'USD' and ${table.quotedAmountCents} > 0 and ${table.reservedCreditUnits} >= 0 and (${table.creditUnitPriceUsd} is null or ${table.creditUnitPriceUsd} ~ '^(0|[1-9][0-9]*)([.][0-9]+)?$') and ${table.state} in ('held','settled','released','outcome_unknown') and (${table.actualAmountCents} is null or ${table.actualAmountCents} >= 0) and (${table.actualCreditUnits} is null or ${table.actualCreditUnits} >= 0)`),
  }),
);

export const productRuntimeScanCheckpoints = pgTable(
  "product_runtime_scan_checkpoints",
  {
    scanKey: text("scan_key").primaryKey(),
    cursorAt: timestamp("cursor_at", { withTimezone: true }),
    cursorId: text("cursor_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ cursorCheck: check("product_runtime_scan_checkpoints_cursor_check", sql`(${table.cursorAt} is null and ${table.cursorId} is null) or (${table.cursorAt} is not null and ${table.cursorId} is not null)`) }),
);

/** Provider-neutral scheduled inputs for the rights-aware Inspiration feed.
 * Credentials and provider-specific configuration never live in this table;
 * adapter keys resolve through deployment configuration. */
export const inspirationTrendSources = pgTable(
  "inspiration_trend_sources",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(), adapterKey: text("adapter_key").notNull(), sourceKind: text("source_kind").notNull(), displayName: text("display_name").notNull(), state: text("state").notNull(),
    scheduleMinutes: integer("schedule_minutes").notNull(), nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(), cursor: text("cursor"),
    preferredRegions: jsonb("preferred_regions").$type<string[]>().notNull(), preferredArabicVarieties: jsonb("preferred_arabic_varieties").$type<string[]>().notNull(),
    preferredFormats: jsonb("preferred_formats").$type<string[]>().notNull(), preferredTags: jsonb("preferred_tags").$type<string[]>().notNull(), excludedTags: jsonb("excluded_tags").$type<string[]>().notNull(),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "inspiration_trend_sources_pk", columns: [table.workspaceId, table.id] }),
    dueIdx: index("inspiration_trend_sources_due_idx").on(table.state, table.nextRunAt, table.workspaceId, table.id),
    valuesCheck: check("inspiration_trend_sources_values_check", sql`${table.state} in ('active','paused') and ${table.sourceKind} in ('official_api','licensed_dataset','public_metadata','embeddable_feed','workspace_owned_analytics') and ${table.adapterKey} ~ '^[a-z][a-z0-9._-]{1,119}$' and ${table.scheduleMinutes} between 5 and 10080`),
  }),
);

export const inspirationTrendIngestionJobs = pgTable(
  "inspiration_trend_ingestion_jobs",
  {
    workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), sourceId: text("source_id").notNull(), sourceKey: text("source_key").notNull(), requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    state: text("state").notNull(), cursor: text("cursor"), rankingContext: jsonb("ranking_context").$type<import("@/lib/product-surfaces/trend-types").TrendRankingContext>().notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), leaseEpoch: integer("lease_epoch").default(0).notNull(),
    attempt: integer("attempt").default(0).notNull(), maxAttempts: integer("max_attempts").default(5).notNull(), pageCount: integer("page_count").default(0).notNull(),
    insertedCount: integer("inserted_count").default(0).notNull(), updatedCount: integer("updated_count").default(0).notNull(), replayedCount: integer("replayed_count").default(0).notNull(), restrictedCount: integer("restricted_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(), failureCode: text("failure_code"), requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(), startedAt: timestamp("started_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "inspiration_trend_ingestion_jobs_pk", columns: [table.workspaceId, table.id] }),
    sourceKeyUnique: uniqueIndex("inspiration_trend_ingestion_jobs_source_key_unique").on(table.workspaceId, table.sourceId, table.sourceKey),
    sourceFk: foreignKey({ name: "inspiration_trend_ingestion_jobs_source_fk", columns: [table.workspaceId, table.sourceId], foreignColumns: [inspirationTrendSources.workspaceId, inspirationTrendSources.id] }).onDelete("restrict"),
    dueIdx: index("inspiration_trend_ingestion_jobs_due_idx").on(table.state, table.nextAttemptAt, table.leaseExpiresAt, table.id),
    valuesCheck: check("inspiration_trend_ingestion_jobs_values_check", sql`${table.state} in ('queued','claimed','succeeded','failed_known') and ${table.leaseEpoch} >= 0 and ${table.attempt} >= 0 and ${table.attempt} <= ${table.maxAttempts} and ${table.maxAttempts} between 1 and 20 and ${table.pageCount} >= 0 and ${table.insertedCount} >= 0 and ${table.updatedCount} >= 0 and ${table.replayedCount} >= 0 and ${table.restrictedCount} >= 0`),
    leaseCheck: check("inspiration_trend_ingestion_jobs_lease_check", sql`(${table.state} = 'claimed' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`),
  }),
);

/** Mutable read projection; its immutable source, rights, and ranking evidence
 * remains in Workspace Product Record revisions and ingestion receipts. */
export const inspirationTrendFeedEntries = pgTable(
  "inspiration_trend_feed_entries",
  {
    workspaceId: text("workspace_id").notNull(), inspirationItemId: text("inspiration_item_id").notNull(), sourceId: text("source_id").notNull(), externalItemId: text("external_item_id").notNull(),
    score: integer("score").notNull(), rankingDigest: text("ranking_digest").notNull(), metricsObservedAt: timestamp("metrics_observed_at", { withTimezone: true }).notNull(), sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }).notNull(), rightsExpiresAt: timestamp("rights_expires_at", { withTimezone: true }),
    region: text("region").notNull(), contentLanguage: text("content_language").notNull(), arabicVariety: text("arabic_variety"), format: text("format").notNull(), rightsStatus: text("rights_status").notNull(), eligibleForBlitz: boolean("eligible_for_blitz").notNull(), searchableText: text("searchable_text").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "inspiration_trend_feed_entries_pk", columns: [table.workspaceId, table.inspirationItemId] }),
    sourceItemUnique: uniqueIndex("inspiration_trend_feed_entries_source_item_unique").on(table.workspaceId, table.sourceId, table.externalItemId),
    itemFk: foreignKey({ name: "inspiration_trend_feed_entries_item_fk", columns: [table.workspaceId, table.inspirationItemId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id] }).onDelete("restrict"),
    sourceFk: foreignKey({ name: "inspiration_trend_feed_entries_source_fk", columns: [table.workspaceId, table.sourceId], foreignColumns: [inspirationTrendSources.workspaceId, inspirationTrendSources.id] }).onDelete("restrict"),
    rankIdx: index("inspiration_trend_feed_entries_rank_idx").on(table.workspaceId, table.score.desc(), table.metricsObservedAt.desc(), table.inspirationItemId),
    filterIdx: index("inspiration_trend_feed_entries_filter_idx").on(table.workspaceId, table.contentLanguage, table.region, table.format, table.rightsStatus),
    valuesCheck: check("inspiration_trend_feed_entries_values_check", sql`${table.score} between 0 and 10000 and ${table.rankingDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.contentLanguage} in ('ar','en') and ${table.rightsStatus} in ('licensed','user_submitted','embeddable','metadata_only','restricted')`),
  }),
);

export const inspirationTrendIngestionReceipts = pgTable(
  "inspiration_trend_ingestion_receipts",
  {
    workspaceId: text("workspace_id").notNull(), sourceId: text("source_id").notNull(), externalItemId: text("external_item_id").notNull(), observationDigest: text("observation_digest").notNull(),
    inspirationItemId: text("inspiration_item_id").notNull(), inspirationItemRevision: integer("inspiration_item_revision").notNull(), sourceContentDigest: text("source_content_digest").notNull(), rightsEvidenceDigest: text("rights_evidence_digest").notNull(), rankingDigest: text("ranking_digest").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "inspiration_trend_ingestion_receipts_pk", columns: [table.workspaceId, table.sourceId, table.externalItemId, table.observationDigest, table.rankingDigest] }),
    sourceFk: foreignKey({ name: "inspiration_trend_ingestion_receipts_source_fk", columns: [table.workspaceId, table.sourceId], foreignColumns: [inspirationTrendSources.workspaceId, inspirationTrendSources.id] }).onDelete("restrict"),
    revisionFk: foreignKey({ name: "inspiration_trend_ingestion_receipts_revision_fk", columns: [table.workspaceId, table.inspirationItemId, table.inspirationItemRevision], foreignColumns: [workspaceProductRecordRevisions.workspaceId, workspaceProductRecordRevisions.recordId, workspaceProductRecordRevisions.revision] }).onDelete("restrict"),
    itemIdx: index("inspiration_trend_ingestion_receipts_item_idx").on(table.workspaceId, table.inspirationItemId, table.createdAt),
    digestsCheck: check("inspiration_trend_ingestion_receipts_digests_check", sql`${table.observationDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.sourceContentDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.rightsEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.rankingDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.inspirationItemRevision} > 0`),
  }),
);

/** Operator-published, licensed media packages. This global catalog is kept
 * physically separate from policy-isolated public metadata discovery. */
export const licensedTrendCatalogEntries = pgTable(
  "licensed_trend_catalog_entries",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    providerItemId: text("provider_item_id").notNull(),
    activeRevision: integer("active_revision").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    providerItemUnique: uniqueIndex("licensed_trend_catalog_entries_provider_item_unique").on(table.providerKey, table.providerItemId),
    stateIdx: index("licensed_trend_catalog_entries_state_idx").on(table.state, table.updatedAt, table.id),
    valuesCheck: check("licensed_trend_catalog_entries_values_check", sql`${table.activeRevision} > 0 and ${table.state} in ('active','paused','revoked') and ${table.providerKey} ~ '^[a-z][a-z0-9._-]{1,119}$'`),
  }),
);

export const licensedTrendCatalogRevisions = pgTable(
  "licensed_trend_catalog_revisions",
  {
    catalogId: text("catalog_id").notNull(),
    revision: integer("revision").notNull(),
    document: jsonb("document").$type<import("@/lib/product-surfaces/licensed-trend-types").LicensedTrendCatalogDocument>().notNull(),
    documentDigest: text("document_digest").notNull(),
    contentLanguage: text("content_language").notNull(),
    arabicVariety: text("arabic_variety"),
    region: text("region").notNull(),
    format: text("format").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    metricsObservedAt: timestamp("metrics_observed_at", { withTimezone: true }).notNull(),
    rightsExpiresAt: timestamp("rights_expires_at", { withTimezone: true }),
    searchableText: text("searchable_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "licensed_trend_catalog_revisions_pk", columns: [table.catalogId, table.revision] }),
    catalogFk: foreignKey({ name: "licensed_trend_catalog_revisions_catalog_fk", columns: [table.catalogId], foreignColumns: [licensedTrendCatalogEntries.id] }).onDelete("restrict"),
    browseIdx: index("licensed_trend_catalog_revisions_browse_idx").on(table.contentLanguage, table.region, table.format, table.metricsObservedAt, table.catalogId),
    valuesCheck: check("licensed_trend_catalog_revisions_values_check", sql`${table.revision} > 0 and ${table.documentDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.contentLanguage} in ('ar','en') and (${table.contentLanguage} = 'ar' or ${table.arabicVariety} is null) and ${table.metricsObservedAt} >= ${table.publishedAt}`),
    documentCheck: check("licensed_trend_catalog_revisions_document_check", sql`${table.document}->>'schema' = 'licensed-trend-catalog-entry/v1' and ${table.document}->>'id' = ${table.catalogId} and (${table.document}->>'revision')::integer = ${table.revision} and ${table.document}->>'digest' = ${table.documentDigest}`),
  }),
);

/** Ordered cursor for a contracted provider's signed catalog-event stream. */
export const licensedTrendProviderCursors = pgTable(
  "licensed_trend_provider_cursors",
  {
    providerKey: text("provider_key").primaryKey(),
    lastSequence: bigint("last_sequence", { mode: "number" }).default(0).notNull(),
    lastEventId: text("last_event_id"),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    valuesCheck: check("licensed_trend_provider_cursors_values_check", sql`${table.providerKey} ~ '^[a-z][a-z0-9._-]{1,119}$' and ${table.lastSequence} >= 0 and ((${table.lastSequence} = 0 and ${table.lastEventId} is null and ${table.lastOccurredAt} is null) or (${table.lastSequence} > 0 and ${table.lastEventId} is not null and ${table.lastOccurredAt} is not null))`),
  }),
);

/** Immutable signed input plus mutable, leased processing state. Events are
 * consumed strictly in provider sequence; gaps never get silently skipped. */
export const licensedTrendProviderEvents = pgTable(
  "licensed_trend_provider_events",
  {
    providerKey: text("provider_key").notNull(),
    eventId: text("event_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    eventDigest: text("event_digest").notNull(),
    keyId: text("key_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<import("@/lib/product-surfaces/licensed-trend-provider-contract").LicensedTrendProviderEvent>().notNull(),
    state: text("state").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    operatorNote: text("operator_note"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "licensed_trend_provider_events_pk", columns: [table.providerKey, table.eventId] }),
    sequenceUnique: uniqueIndex("licensed_trend_provider_events_sequence_unique").on(table.providerKey, table.sequence),
    providerFk: foreignKey({ name: "licensed_trend_provider_events_provider_fk", columns: [table.providerKey], foreignColumns: [licensedTrendProviderCursors.providerKey] }).onDelete("restrict"),
    dueIdx: index("licensed_trend_provider_events_due_idx").on(table.nextAttemptAt, table.providerKey, table.sequence).where(sql`${table.state} in ('queued','claimed')`),
    valuesCheck: check("licensed_trend_provider_events_values_check", sql`${table.providerKey} ~ '^[a-z][a-z0-9._-]{1,119}$' and octet_length(${table.eventId}) between 1 and 200 and ${table.sequence} > 0 and ${table.eventDigest} ~ '^sha256:[a-f0-9]{64}$' and octet_length(${table.keyId}) between 1 and 120 and ${table.payload}->>'schema' = 'licensed-trend-provider-event/v1' and ${table.payload}->>'action' in ('publish_batch','set_catalog_state') and ${table.state} in ('queued','claimed','succeeded','failed_known','outcome_unknown','skipped') and ${table.attempt} between 0 and ${table.maxAttempts} and ${table.maxAttempts} between 1 and 20 and (${table.operatorNote} is null or octet_length(${table.operatorNote}) between 8 and 500)`),
    leaseCheck: check("licensed_trend_provider_events_lease_check", sql`(${table.state} = 'claimed' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`),
  }),
);

export const licensedTrendWorkspaceEntitlements = pgTable(
  "licensed_trend_workspace_entitlements",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    catalogId: text("catalog_id").notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
    catalogDigest: text("catalog_digest").notNull(),
    state: text("state").notNull(),
    document: jsonb("document").$type<import("@/lib/product-surfaces/licensed-trend-types").LicensedTrendEntitlementDocument>().notNull(),
    documentDigest: text("document_digest").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "licensed_trend_workspace_entitlements_pk", columns: [table.workspaceId, table.id] }),
    exactGrantUnique: uniqueIndex("licensed_trend_workspace_entitlements_exact_unique").on(table.workspaceId, table.catalogId, table.catalogRevision),
    catalogRevisionFk: foreignKey({ name: "licensed_trend_workspace_entitlements_catalog_revision_fk", columns: [table.catalogId, table.catalogRevision], foreignColumns: [licensedTrendCatalogRevisions.catalogId, licensedTrendCatalogRevisions.revision] }).onDelete("restrict"),
    browseIdx: index("licensed_trend_workspace_entitlements_browse_idx").on(table.workspaceId, table.state, table.expiresAt, table.catalogId),
    valuesCheck: check("licensed_trend_workspace_entitlements_values_check", sql`${table.catalogRevision} > 0 and ${table.catalogDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.documentDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.state} in ('active','revoked') and ((${table.state} = 'active' and ${table.revokedAt} is null) or (${table.state} = 'revoked' and ${table.revokedAt} is not null)) and (${table.expiresAt} is null or ${table.expiresAt} > ${table.grantedAt})`),
    documentCheck: check("licensed_trend_workspace_entitlements_document_check", sql`${table.document}->>'schema' = 'licensed-trend-workspace-entitlement/v1' and ${table.document}->>'id' = ${table.id} and ${table.document}->>'workspaceId' = ${table.workspaceId} and ${table.document}->>'digest' = ${table.documentDigest}`),
  }),
);

/** Recoverable tenant materialization. External S3 copies are fenced by the
 * lease generation and deterministic destination keys. */
export const licensedTrendMaterializationJobs = pgTable(
  "licensed_trend_materialization_jobs",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    entitlementId: text("entitlement_id").notNull(),
    catalogId: text("catalog_id").notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
    catalogDigest: text("catalog_digest").notNull(),
    state: text("state").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    sourceDestinationKey: text("source_destination_key").notNull(),
    evidenceDestinationKey: text("evidence_destination_key").notNull(),
    sourceAssetId: text("source_asset_id").references(() => assets.id, { onDelete: "restrict" }),
    evidenceDocumentAssetId: text("evidence_document_asset_id").references(() => assets.id, { onDelete: "restrict" }),
    rightsEvidenceId: text("rights_evidence_id"),
    rightsSnapshotId: text("rights_snapshot_id"),
    inspirationItemId: text("inspiration_item_id"),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    leaseOwner: text("lease_owner"),
    leaseGeneration: integer("lease_generation").default(0).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    failureCode: text("failure_code"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "licensed_trend_materialization_jobs_pk", columns: [table.workspaceId, table.id] }),
    commandUnique: uniqueIndex("licensed_trend_materialization_jobs_command_unique").on(table.workspaceId, table.idempotencyKey),
    entitlementUnique: uniqueIndex("licensed_trend_materialization_jobs_entitlement_unique").on(table.workspaceId, table.entitlementId),
    entitlementFk: foreignKey({ name: "licensed_trend_materialization_jobs_entitlement_fk", columns: [table.workspaceId, table.entitlementId], foreignColumns: [licensedTrendWorkspaceEntitlements.workspaceId, licensedTrendWorkspaceEntitlements.id] }).onDelete("restrict"),
    catalogRevisionFk: foreignKey({ name: "licensed_trend_materialization_jobs_catalog_revision_fk", columns: [table.catalogId, table.catalogRevision], foreignColumns: [licensedTrendCatalogRevisions.catalogId, licensedTrendCatalogRevisions.revision] }).onDelete("restrict"),
    inspirationItemFk: foreignKey({ name: "licensed_trend_materialization_jobs_inspiration_item_fk", columns: [table.workspaceId, table.inspirationItemId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id] }).onDelete("restrict"),
    dueIdx: index("licensed_trend_materialization_jobs_due_idx").on(table.state, table.nextAttemptAt, table.leaseExpiresAt, table.id),
    valuesCheck: check("licensed_trend_materialization_jobs_values_check", sql`${table.catalogRevision} > 0 and ${table.catalogDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.idempotencyKey}) between 8 and 200 and ${table.state} in ('queued','claimed','succeeded','failed_known') and ${table.attempt} >= 0 and ${table.attempt} <= ${table.maxAttempts} and ${table.maxAttempts} between 1 and 20 and ${table.leaseGeneration} >= 0`),
    leaseCheck: check("licensed_trend_materialization_jobs_lease_check", sql`(${table.state} = 'claimed' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`),
  }),
);

/** Policy-isolated YouTube chart configuration. YouTube API Data must never
 * enter the scored/immutable Inspiration tables above. */
export const youtubeTrendDiscoverySources = pgTable(
  "youtube_trend_discovery_sources",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    regionCode: text("region_code").notNull(),
    categoryId: text("category_id").default("0").notNull(),
    displayName: text("display_name").notNull(),
    state: text("state").default("active").notNull(),
    scheduleMinutes: integer("schedule_minutes").default(360).notNull(),
    pageSize: integer("page_size").default(25).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "youtube_trend_discovery_sources_pk", columns: [table.workspaceId, table.id] }),
    chartUnique: uniqueIndex("youtube_trend_discovery_sources_chart_unique").on(table.workspaceId, table.regionCode, table.categoryId),
    dueIdx: index("youtube_trend_discovery_sources_due_idx").on(table.nextRunAt, table.workspaceId, table.id).where(sql`${table.state} = 'active'`),
    valuesCheck: check("youtube_trend_discovery_sources_values_check", sql`${table.regionCode} ~ '^[A-Z]{2}$' and ${table.categoryId} ~ '^(0|[1-9][0-9]*)$' and ${table.state} in ('active','paused') and ${table.scheduleMinutes} between 60 and 10080 and ${table.pageSize} between 1 and 50 and length(${table.displayName}) between 1 and 200`),
  }),
);

/** Mutable, purgeable latest-view projection of YouTube API Data. Counter
 * strings preserve the API's unsigned-long values without lossy conversion. */
export const youtubeTrendDiscoveryEntries = pgTable(
  "youtube_trend_discovery_entries",
  {
    workspaceId: text("workspace_id").notNull(),
    sourceId: text("source_id").notNull(),
    videoId: text("video_id").notNull(),
    providerRank: integer("provider_rank").notNull(),
    title: text("title").notNull(),
    channelId: text("channel_id").notNull(),
    channelTitle: text("channel_title").notNull(),
    sourceUrl: text("source_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    viewCount: text("view_count"),
    likeCount: text("like_count"),
    commentCount: text("comment_count"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "youtube_trend_discovery_entries_pk", columns: [table.workspaceId, table.sourceId, table.videoId] }),
    sourceFk: foreignKey({ name: "youtube_trend_discovery_entries_source_fk", columns: [table.workspaceId, table.sourceId], foreignColumns: [youtubeTrendDiscoverySources.workspaceId, youtubeTrendDiscoverySources.id] }).onDelete("cascade"),
    providerOrderIdx: index("youtube_trend_discovery_entries_order_idx").on(table.workspaceId, table.sourceId, table.providerRank, table.videoId),
    expiryIdx: index("youtube_trend_discovery_entries_expiry_idx").on(table.expiresAt, table.workspaceId, table.sourceId),
    valuesCheck: check("youtube_trend_discovery_entries_values_check", sql`${table.providerRank} between 1 and 50 and length(${table.videoId}) between 1 and 32 and length(${table.title}) between 1 and 240 and length(${table.channelId}) between 1 and 200 and length(${table.channelTitle}) between 1 and 200 and ${table.sourceUrl} = 'https://www.youtube.com/watch?v=' || ${table.videoId} and (${table.thumbnailUrl} is null or ${table.thumbnailUrl} ~ '^https://') and (${table.viewCount} is null or ${table.viewCount} ~ '^(0|[1-9][0-9]*)$') and (${table.likeCount} is null or ${table.likeCount} ~ '^(0|[1-9][0-9]*)$') and (${table.commentCount} is null or ${table.commentCount} ~ '^(0|[1-9][0-9]*)$') and ${table.publishedAt} <= ${table.observedAt} and ${table.expiresAt} > ${table.observedAt} and ${table.expiresAt} <= ${table.observedAt} + interval '30 days'`),
  }),
);

export const youtubeTrendDiscoveryJobs = pgTable(
  "youtube_trend_discovery_jobs",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceKey: text("source_key").notNull(),
    state: text("state").default("queued").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(4).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseGeneration: integer("lease_generation").default(0).notNull(),
    failureCode: text("failure_code"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "youtube_trend_discovery_jobs_pk", columns: [table.workspaceId, table.id] }),
    sourceKeyUnique: uniqueIndex("youtube_trend_discovery_jobs_source_key_unique").on(table.workspaceId, table.sourceId, table.sourceKey),
    activeSourceUnique: uniqueIndex("youtube_trend_discovery_jobs_active_source_unique").on(table.workspaceId, table.sourceId).where(sql`${table.state} in ('queued','claimed')`),
    sourceFk: foreignKey({ name: "youtube_trend_discovery_jobs_source_fk", columns: [table.workspaceId, table.sourceId], foreignColumns: [youtubeTrendDiscoverySources.workspaceId, youtubeTrendDiscoverySources.id] }).onDelete("cascade"),
    dueIdx: index("youtube_trend_discovery_jobs_due_idx").on(table.nextAttemptAt, table.workspaceId, table.id).where(sql`${table.state} = 'queued'`),
    valuesCheck: check("youtube_trend_discovery_jobs_values_check", sql`${table.state} in ('queued','claimed','succeeded','failed_known') and ${table.attempt} between 0 and ${table.maxAttempts} and ${table.maxAttempts} between 1 and 10 and ${table.leaseGeneration} >= 0 and length(${table.sourceKey}) between 1 and 200 and ((${table.state} = 'claimed' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'claimed' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null))`),
  }),
);

export const productBlitzReplenishmentRuns = pgTable(
  "product_blitz_replenishment_runs",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(), campaignId: text("campaign_id").notNull(), sourceKey: text("source_key").notNull(), invocation: text("invocation").notNull(), actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), state: text("state").notNull(),
    leaseToken: text("lease_token"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), leaseGeneration: integer("lease_generation").default(0).notNull(), policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(), createdCount: integer("created_count").default(0).notNull(), stopReason: text("stop_reason"), failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ name: "product_blitz_replenishment_runs_pk", columns: [table.workspaceId, table.id] }),
    sourceUnique: uniqueIndex("product_blitz_replenishment_runs_source_unique").on(table.workspaceId, table.campaignId, table.sourceKey),
    campaignFk: foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id], name: "product_blitz_replenishment_runs_campaign_fk" }).onDelete("restrict"),
    leaseIdx: index("product_blitz_replenishment_runs_lease_idx").on(table.state, table.leaseExpiresAt, table.id),
    lifecycleCheck: check("product_blitz_replenishment_runs_lifecycle_check", sql`${table.invocation} in ('daily','manual') and ${table.state} in ('claimed','succeeded','failed_known') and ${table.createdCount} >= 0`),
  }),
);

export const productBlitzReplenishmentItems = pgTable(
  "product_blitz_replenishment_items",
  {
    workspaceId: text("workspace_id").notNull(), runId: text("run_id").notNull(), position: integer("position").notNull(), sourceRecordId: text("source_record_id").notNull(), blitzItemId: text("blitz_item_id").notNull(), rationaleDigest: text("rationale_digest").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "product_blitz_replenishment_items_pk", columns: [table.workspaceId, table.runId, table.position] }),
    sourceUnique: uniqueIndex("product_blitz_replenishment_items_source_unique").on(table.workspaceId, table.runId, table.sourceRecordId),
    blitzUnique: uniqueIndex("product_blitz_replenishment_items_blitz_unique").on(table.workspaceId, table.blitzItemId),
    runFk: foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [productBlitzReplenishmentRuns.workspaceId, productBlitzReplenishmentRuns.id], name: "product_blitz_replenishment_items_run_fk" }).onDelete("restrict"),
    sourceFk: foreignKey({ columns: [table.workspaceId, table.sourceRecordId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id], name: "product_blitz_replenishment_items_source_fk" }).onDelete("restrict"),
    blitzFk: foreignKey({ columns: [table.workspaceId, table.blitzItemId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id], name: "product_blitz_replenishment_items_blitz_fk" }).onDelete("restrict"),
    positionCheck: check("product_blitz_replenishment_items_position_check", sql`${table.position} >= 0 and ${table.rationaleDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

/**
 * Persistent Creator Personas are a separate safety-critical aggregate rather
 * than an untyped product-record payload. Evidence and usage rows are
 * append-only so an output can always resolve the exact consent, disclosure,
 * provider acceptance, and Persona revision that admitted it.
 */
export const creatorPersonas = pgTable(
  "creator_personas",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    name: text("name").notNull(),
    contentLanguage: text("content_language").notNull(),
    arabicVariety: text("arabic_variety"),
    disclosure: text("disclosure").notNull(),
    revision: integer("revision").default(1).notNull(),
    reusableModelRef: text("reusable_model_ref"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    suspendedReasonCode: text("suspended_reason_code"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_personas_pk", columns: [table.workspaceId, table.id] }),
    stateCursorIdx: index("creator_personas_workspace_state_cursor_idx").on(table.workspaceId, table.state, table.updatedAt, table.id),
    retentionIdx: index("creator_personas_retention_idx").on(table.state, table.retentionUntil),
    kindCheck: check("creator_personas_kind_check", sql`${table.kind} in ('synthetic','consented_likeness')`),
    stateCheck: check("creator_personas_state_check", sql`${table.state} in ('draft','consent_review','ready_to_train','training','review','active','training_failed','suspended','consent_expired','deleted')`),
    localeCheck: check("creator_personas_locale_check", sql`${table.contentLanguage} in ('ar','en') and (${table.arabicVariety} is null or ${table.arabicVariety} in ('msa','gulf','egyptian','levantine','maghrebi'))`),
    revisionCheck: check("creator_personas_revision_check", sql`${table.revision} > 0`),
  }),
);

export const creatorPersonaEvidence = pgTable(
  "creator_persona_evidence",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    personaId: text("persona_id").notNull(),
    personaRevision: integer("persona_revision").notNull(),
    type: text("type").notNull(),
    issuer: text("issuer").notNull(),
    subjectDigest: text("subject_digest").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    provider: text("provider"),
    providerPolicyVersion: text("provider_policy_version"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    verifiedByUserId: text("verified_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_evidence_pk", columns: [table.workspaceId, table.id] }),
    personaFk: foreignKey({ name: "creator_persona_evidence_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    activeIdx: index("creator_persona_evidence_active_idx").on(table.workspaceId, table.personaId, table.type, table.expiresAt),
    typeCheck: check("creator_persona_evidence_type_check", sql`${table.type} in ('likeness_consent','provider_acceptance','disclosure_review','abuse_review')`),
    digestCheck: check("creator_persona_evidence_digest_check", sql`${table.subjectDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    windowCheck: check("creator_persona_evidence_window_check", sql`${table.expiresAt} > ${table.effectiveAt}`),
  }),
);

export const creatorPersonaTrainingSources = pgTable(
  "creator_persona_training_sources",
  {
    workspaceId: text("workspace_id").notNull(),
    personaId: text("persona_id").notNull(),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    assetChecksum: text("asset_checksum").notNull(),
    consentEvidenceId: text("consent_evidence_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_training_sources_pk", columns: [table.workspaceId, table.personaId, table.assetId] }),
    personaFk: foreignKey({ name: "creator_persona_training_sources_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    evidenceFk: foreignKey({ name: "creator_persona_training_sources_evidence_fk", columns: [table.workspaceId, table.consentEvidenceId], foreignColumns: [creatorPersonaEvidence.workspaceId, creatorPersonaEvidence.id] }).onDelete("restrict"),
    orderUnique: uniqueIndex("creator_persona_training_sources_order_unique").on(table.workspaceId, table.personaId, table.ordinal),
    ordinalCheck: check("creator_persona_training_sources_ordinal_check", sql`${table.ordinal} >= 0`),
    checksumCheck: check("creator_persona_training_sources_checksum_check", sql`${table.assetChecksum} ~ '^sha256:[a-f0-9]{64}$'`),
  }),
);

export const creatorPersonaTrainingAdmissions = pgTable(
  "creator_persona_training_admissions",
  {
    workspaceId: text("workspace_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    personaId: text("persona_id").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    jobId: text("job_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    admissionSnapshot: jsonb("admission_snapshot").$type<Record<string, unknown>>().notNull(),
    retryOfJobId: text("retry_of_job_id"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_training_admissions_pk", columns: [table.workspaceId, table.idempotencyKey] }),
    jobUnique: uniqueIndex("creator_persona_training_admissions_job_unique").on(table.workspaceId, table.jobId),
    personaFk: foreignKey({ name: "creator_persona_training_admissions_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    digestCheck: check("creator_persona_training_admissions_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    revisionCheck: check("creator_persona_training_admissions_revision_check", sql`${table.expectedRevision} > 0`),
    windowCheck: check("creator_persona_training_admissions_window_check", sql`${table.expiresAt} > ${table.createdAt}`),
  }),
);

export const creatorPersonaTrainingJobs = pgTable(
  "creator_persona_training_jobs",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    personaId: text("persona_id").notNull(),
    personaRevision: integer("persona_revision").notNull(),
    state: text("state").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    qualificationDigest: text("qualification_digest").notNull(),
    inputSchemaDigest: text("input_schema_digest"),
    qualificationId: text("qualification_id"),
    qualificationRevision: integer("qualification_revision"),
    qualificationExpiresAt: timestamp("qualification_expires_at", { withTimezone: true }),
    qualificationSnapshot: jsonb("qualification_snapshot").$type<Record<string, unknown>>(),
    quoteAmountUsd: text("quote_amount_usd"),
    quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }),
    reservationIds: jsonb("reservation_ids").$type<string[]>(),
    regionPolicyId: text("region_policy_id"),
    regionPolicyVersion: integer("region_policy_version"),
    regionEvidenceDigest: text("region_evidence_digest"),
    region: text("region"),
    regionRouteId: text("region_route_id"),
    regionEvidenceExpiresAt: timestamp("region_evidence_expires_at", { withTimezone: true }),
    retryOfJobId: text("retry_of_job_id"),
    providerAcceptanceEvidenceId: text("provider_acceptance_evidence_id").notNull(),
    operationId: text("operation_id").notNull(),
    providerJobRef: text("provider_job_ref"),
    resultModelRef: text("result_model_ref"),
    failureCode: text("failure_code"),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_training_jobs_pk", columns: [table.workspaceId, table.id] }),
    personaFk: foreignKey({ name: "creator_persona_training_jobs_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    acceptanceFk: foreignKey({ name: "creator_persona_training_jobs_acceptance_fk", columns: [table.workspaceId, table.providerAcceptanceEvidenceId], foreignColumns: [creatorPersonaEvidence.workspaceId, creatorPersonaEvidence.id] }).onDelete("restrict"),
    retryFk: foreignKey({ name: "creator_persona_training_jobs_retry_fk", columns: [table.workspaceId, table.retryOfJobId], foreignColumns: [table.workspaceId, table.id] }).onDelete("restrict"),
    operationUnique: uniqueIndex("creator_persona_training_jobs_operation_unique").on(table.workspaceId, table.operationId),
    personaCursorIdx: index("creator_persona_training_jobs_persona_cursor_idx").on(table.workspaceId, table.personaId, table.createdAt, table.id),
    stateCursorIdx: index("creator_persona_training_jobs_state_cursor_idx").on(table.workspaceId, table.state, table.updatedAt, table.id),
    retryIdx: index("creator_persona_training_jobs_retry_idx").on(table.workspaceId, table.retryOfJobId),
    stateCheck: check("creator_persona_training_jobs_state_check", sql`${table.state} in ('queued','admitted','running','waiting_provider','succeeded','failed_known','outcome_unknown','cancelled')`),
    digestCheck: check("creator_persona_training_jobs_digest_check", sql`${table.qualificationDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    admissionCompleteCheck: check("creator_persona_training_jobs_admission_complete_check", sql`(${table.inputSchemaDigest} is null and ${table.qualificationId} is null and ${table.qualificationRevision} is null and ${table.qualificationExpiresAt} is null and ${table.qualificationSnapshot} is null and ${table.quoteAmountUsd} is null and ${table.quoteExpiresAt} is null and ${table.reservationIds} is null and ${table.regionPolicyId} is null and ${table.regionPolicyVersion} is null and ${table.regionEvidenceDigest} is null and ${table.region} is null and ${table.regionRouteId} is null and ${table.regionEvidenceExpiresAt} is null) or (${table.inputSchemaDigest} is not null and ${table.qualificationId} is not null and ${table.qualificationRevision} is not null and ${table.qualificationExpiresAt} is not null and ${table.qualificationSnapshot} is not null and ${table.quoteAmountUsd} is not null and ${table.quoteExpiresAt} is not null and ${table.reservationIds} is not null and ${table.regionPolicyId} is not null and ${table.regionPolicyVersion} is not null and ${table.regionEvidenceDigest} is not null and ${table.region} is not null and ${table.regionRouteId} is not null and ${table.regionEvidenceExpiresAt} is not null)`),
  }),
);

export const creatorPersonaUsages = pgTable(
  "creator_persona_usages",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    personaId: text("persona_id").notNull(),
    personaRevision: integer("persona_revision").notNull(),
    purpose: text("purpose").notNull(),
    resourceId: text("resource_id").notNull(),
    consentEvidenceId: text("consent_evidence_id"),
    providerAcceptanceEvidenceId: text("provider_acceptance_evidence_id").notNull(),
    disclosureEvidenceId: text("disclosure_evidence_id").notNull(),
    disclosure: text("disclosure").notNull(),
    boundByUserId: text("bound_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_usages_pk", columns: [table.workspaceId, table.id] }),
    personaFk: foreignKey({ name: "creator_persona_usages_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    acceptanceFk: foreignKey({ name: "creator_persona_usages_acceptance_fk", columns: [table.workspaceId, table.providerAcceptanceEvidenceId], foreignColumns: [creatorPersonaEvidence.workspaceId, creatorPersonaEvidence.id] }).onDelete("restrict"),
    disclosureFk: foreignKey({ name: "creator_persona_usages_disclosure_fk", columns: [table.workspaceId, table.disclosureEvidenceId], foreignColumns: [creatorPersonaEvidence.workspaceId, creatorPersonaEvidence.id] }).onDelete("restrict"),
    consentFk: foreignKey({ name: "creator_persona_usages_consent_fk", columns: [table.workspaceId, table.consentEvidenceId], foreignColumns: [creatorPersonaEvidence.workspaceId, creatorPersonaEvidence.id] }).onDelete("restrict"),
    resourceUnique: uniqueIndex("creator_persona_usages_resource_unique").on(table.workspaceId, table.personaId, table.purpose, table.resourceId),
    resourceIdx: index("creator_persona_usages_resource_idx").on(table.workspaceId, table.purpose, table.resourceId),
    personaCursorIdx: index("creator_persona_usages_persona_cursor_idx").on(table.workspaceId, table.personaId, table.createdAt, table.id),
    purposeCheck: check("creator_persona_usages_purpose_check", sql`${table.purpose} in ('generation','content_set','channel','blitz')`),
  }),
);

export const creatorPersonaEvents = pgTable(
  "creator_persona_events",
  {
    workspaceId: text("workspace_id").notNull(),
    personaId: text("persona_id").notNull(),
    revision: integer("revision").notNull(),
    id: text("id").notNull(),
    type: text("type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_events_pk", columns: [table.workspaceId, table.personaId, table.revision] }),
    idUnique: uniqueIndex("creator_persona_events_id_unique").on(table.workspaceId, table.id),
    personaFk: foreignKey({ name: "creator_persona_events_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    revisionCheck: check("creator_persona_events_revision_check", sql`${table.revision} > 0`),
  }),
);

export const creatorPersonaCommandReceipts = pgTable(
  "creator_persona_command_receipts",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    personaId: text("persona_id").notNull(),
    resultRevision: integer("result_revision").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "creator_persona_command_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }),
    personaFk: foreignKey({ name: "creator_persona_command_receipts_persona_fk", columns: [table.workspaceId, table.personaId], foreignColumns: [creatorPersonas.workspaceId, creatorPersonas.id] }).onDelete("restrict"),
    digestCheck: check("creator_persona_command_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.resultRevision} > 0`),
  }),
);

/** Versioned commercial terms; historical subscriptions never point at mutable pricing. */
export const billingPlanVersions = pgTable("billing_plan_versions", {
  planId: text("plan_id").notNull(), version: integer("version").notNull(), status: text("status").notNull(),
  authoredName: jsonb("authored_name").$type<{ ar: string; en: string }>().notNull(), currency: text("currency").notNull(), priceMinor: bigint("price_minor", { mode: "number" }).notNull(), billingInterval: text("billing_interval").notNull(), taxMode: text("tax_mode").notNull(),
  trialDays: integer("trial_days").notNull(), trialCreditUnits: bigint("trial_credit_units", { mode: "number" }).notNull(), entitlements: jsonb("entitlements").$type<Record<string, number | boolean>>().notNull(), termsDigest: text("terms_digest").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), retiredAt: timestamp("retired_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ pk: primaryKey({ name: "billing_plan_versions_pk", columns: [table.planId, table.version] }), activeIdx: index("billing_plan_versions_active_idx").on(table.status, table.effectiveAt), valuesCheck: check("billing_plan_versions_values_check", sql`${table.version} > 0 and ${table.status} in ('draft','active','retired') and ${table.currency} ~ '^[A-Z]{3}$' and ${table.priceMinor} >= 0 and ${table.billingInterval} in ('month','year','one_time') and ${table.taxMode} in ('inclusive','exclusive') and ${table.trialDays} between 0 and 90 and ${table.trialCreditUnits} >= 0 and ${table.termsDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const billingTrialGrants = pgTable("billing_trial_grants", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), beneficiaryIdentityDigest: text("beneficiary_identity_digest").notNull(), planId: text("plan_id").notNull(), planVersion: integer("plan_version").notNull(), status: text("status").notNull(), grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => ({ beneficiaryUnique: uniqueIndex("billing_trial_grants_beneficiary_unique").on(table.beneficiaryIdentityDigest), workspaceIdx: index("billing_trial_grants_workspace_idx").on(table.workspaceId, table.status), planFk: foreignKey({ name: "billing_trial_grants_plan_fk", columns: [table.planId, table.planVersion], foreignColumns: [billingPlanVersions.planId, billingPlanVersions.version] }).onDelete("restrict"), digestCheck: check("billing_trial_grants_digest_check", sql`${table.beneficiaryIdentityDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.status} in ('active','consumed','expired','revoked') and ${table.expiresAt} > ${table.grantedAt}`) }));

export const workspaceSubscriptions = pgTable("workspace_subscriptions", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "restrict" }), state: text("state").notNull(), planId: text("plan_id").notNull(), planVersion: integer("plan_version").notNull(), trialGrantId: text("trial_grant_id").references(() => billingTrialGrants.id, { onDelete: "restrict" }), merchantCustomerRef: text("merchant_customer_ref"), merchantSubscriptionRef: text("merchant_subscription_ref"), merchantLastEventAt: timestamp("merchant_last_event_at", { withTimezone: true }), merchantLastEventId: text("merchant_last_event_id"), currentPeriodStartsAt: timestamp("current_period_starts_at", { withTimezone: true }).notNull(), currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }).notNull(), graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }), revision: integer("revision").default(1).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ planFk: foreignKey({ name: "workspace_subscriptions_plan_fk", columns: [table.planId, table.planVersion], foreignColumns: [billingPlanVersions.planId, billingPlanVersions.version] }).onDelete("restrict"), stateIdx: index("workspace_subscriptions_state_idx").on(table.state, table.currentPeriodEndsAt), stateCheck: check("workspace_subscriptions_state_check", sql`${table.state} in ('trialing','active','past_due','grace','cancel_at_period_end','cancelled','suspended') and ${table.revision} > 0 and ${table.currentPeriodEndsAt} > ${table.currentPeriodStartsAt} and (${table.graceEndsAt} is null or ${table.graceEndsAt} >= ${table.currentPeriodEndsAt})`) }));

export const workspaceSubscriptionEvents = pgTable("workspace_subscription_events", {
  workspaceId: text("workspace_id").notNull(), revision: integer("revision").notNull(), id: text("id").notNull(), fromState: text("from_state"), toState: text("to_state").notNull(), reasonCode: text("reason_code").notNull(), actorRef: text("actor_ref").notNull(), facts: jsonb("facts").$type<Record<string, unknown>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "workspace_subscription_events_pk", columns: [table.workspaceId, table.revision] }), subscriptionFk: foreignKey({ name: "workspace_subscription_events_subscription_fk", columns: [table.workspaceId], foreignColumns: [workspaceSubscriptions.workspaceId] }).onDelete("restrict"), idUnique: uniqueIndex("workspace_subscription_events_id_unique").on(table.id), stateCheck: check("workspace_subscription_events_state_check", sql`${table.revision} > 0 and ${table.toState} in ('trialing','active','past_due','grace','cancel_at_period_end','cancelled','suspended')`) }));

export const managedExecutionCommercialQuotes = pgTable("managed_execution_commercial_quotes", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), purposeRef: text("purpose_ref").notNull(), state: text("state").notNull(), maxCreditDebit: bigint("max_credit_debit", { mode: "number" }).notNull(), localPriceMinor: bigint("local_price_minor", { mode: "number" }), currency: text("currency"), taxMinor: bigint("tax_minor", { mode: "number" }), pricingSnapshotDigest: text("pricing_snapshot_digest").notNull(), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "restrict" }), acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "managed_execution_commercial_quotes_pk", columns: [table.workspaceId, table.id] }), purposeUnique: uniqueIndex("managed_execution_commercial_quotes_purpose_unique").on(table.workspaceId, table.purposeRef), stateIdx: index("managed_execution_commercial_quotes_state_idx").on(table.workspaceId, table.state, table.expiresAt), valuesCheck: check("managed_execution_commercial_quotes_values_check", sql`${table.state} in ('offered','accepted','reserved','settled','released','outcome_unknown','expired') and ${table.maxCreditDebit} > 0 and ${table.pricingSnapshotDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.expiresAt} > ${table.issuedAt} and ((${table.currency} is null and ${table.localPriceMinor} is null and ${table.taxMinor} is null) or (${table.currency} ~ '^[A-Z]{3}$' and ${table.localPriceMinor} >= 0 and ${table.taxMinor} >= 0))`) }));

export const generationCreditBuckets = pgTable("generation_credit_buckets", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), kind: text("kind").notNull(), sourceRef: text("source_ref").notNull(), grantedUnits: bigint("granted_units", { mode: "number" }).notNull(), availableUnits: bigint("available_units", { mode: "number" }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }), revision: integer("revision").default(1).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_credit_buckets_pk", columns: [table.workspaceId, table.id] }), sourceUnique: uniqueIndex("generation_credit_buckets_source_unique").on(table.workspaceId, table.kind, table.sourceRef), spendOrderIdx: index("generation_credit_buckets_spend_order_idx").on(table.workspaceId, table.kind, table.expiresAt, table.createdAt, table.id), valuesCheck: check("generation_credit_buckets_values_check", sql`${table.kind} in ('allowance','purchased','referral') and ${table.grantedUnits} >= 0 and ${table.availableUnits} between 0 and ${table.grantedUnits} and ${table.revision} > 0 and ((${table.kind} = 'allowance' and ${table.expiresAt} is not null) or (${table.kind} <> 'allowance'))`) }));

export const generationCreditReservations = pgTable("generation_credit_reservations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), quoteId: text("quote_id").notNull(), state: text("state").notNull(), maxDebitUnits: bigint("max_debit_units", { mode: "number" }).notNull(), settledUnits: bigint("settled_units", { mode: "number" }), allocations: jsonb("allocations").$type<Array<{ bucketId: string; units: number }>>().notNull(), externalEffectRef: text("external_effect_ref"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_credit_reservations_pk", columns: [table.workspaceId, table.id] }), quoteFk: foreignKey({ name: "generation_credit_reservations_quote_fk", columns: [table.workspaceId, table.quoteId], foreignColumns: [managedExecutionCommercialQuotes.workspaceId, managedExecutionCommercialQuotes.id] }).onDelete("restrict"), quoteUnique: uniqueIndex("generation_credit_reservations_quote_unique").on(table.workspaceId, table.quoteId), effectUnique: uniqueIndex("generation_credit_reservations_effect_unique").on(table.workspaceId, table.externalEffectRef), stateIdx: index("generation_credit_reservations_state_idx").on(table.workspaceId, table.state, table.updatedAt), valuesCheck: check("generation_credit_reservations_values_check", sql`${table.state} in ('held','settled','released','outcome_unknown') and ${table.maxDebitUnits} > 0 and (${table.settledUnits} is null or ${table.settledUnits} between 0 and ${table.maxDebitUnits})`) }));

export const generationCreditLedgerEntries = pgTable("generation_credit_ledger_entries", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), sequence: integer("sequence").notNull(), id: text("id").notNull(), bucketId: text("bucket_id").notNull(), reservationId: text("reservation_id"), entryType: text("entry_type").notNull(), deltaUnits: bigint("delta_units", { mode: "number" }).notNull(), balanceAfterUnits: bigint("balance_after_units", { mode: "number" }).notNull(), sourceRef: text("source_ref").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_credit_ledger_entries_pk", columns: [table.workspaceId, table.sequence] }), idUnique: uniqueIndex("generation_credit_ledger_entries_id_unique").on(table.workspaceId, table.id), bucketFk: foreignKey({ name: "generation_credit_ledger_entries_bucket_fk", columns: [table.workspaceId, table.bucketId], foreignColumns: [generationCreditBuckets.workspaceId, generationCreditBuckets.id] }).onDelete("restrict"), reservationFk: foreignKey({ name: "generation_credit_ledger_entries_reservation_fk", columns: [table.workspaceId, table.reservationId], foreignColumns: [generationCreditReservations.workspaceId, generationCreditReservations.id] }).onDelete("restrict"), bucketCursorIdx: index("generation_credit_ledger_entries_bucket_cursor_idx").on(table.workspaceId, table.bucketId, table.sequence), valuesCheck: check("generation_credit_ledger_entries_values_check", sql`${table.sequence} > 0 and ${table.entryType} in ('grant','purchase','referral_reward','reserve','release','settle','refund','expire','clawback','clawback_reverse') and ${table.balanceAfterUnits} >= 0`) }));

export const commercialCommandReceipts = pgTable("commercial_command_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "commercial_command_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }),
  digestCheck: check("commercial_command_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

export const merchantCheckoutSessions = pgTable("merchant_checkout_sessions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), purposeKind: text("purpose_kind").notNull(), purposeRef: text("purpose_ref").notNull(), state: text("state").notNull(), commercialSnapshot: jsonb("commercial_snapshot").$type<Record<string, unknown>>().notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), taxMinor: bigint("tax_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), termsDigest: text("terms_digest").notNull(), merchantCheckoutRef: text("merchant_checkout_ref"), merchantCustomerRef: text("merchant_customer_ref"), merchantEffectRef: text("merchant_effect_ref"), recoveryAttempts: integer("recovery_attempts").default(0).notNull(), nextRecoveryAt: timestamp("next_recovery_at", { withTimezone: true }).defaultNow().notNull(), recoveryLeaseOwner: text("recovery_lease_owner"), recoveryLeaseExpiresAt: timestamp("recovery_lease_expires_at", { withTimezone: true }), lastRecoveryStatus: text("last_recovery_status"), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "merchant_checkout_sessions_pk", columns: [table.workspaceId, table.id] }), idUnique: uniqueIndex("merchant_checkout_sessions_id_unique").on(table.id), purposeUnique: uniqueIndex("merchant_checkout_sessions_purpose_unique").on(table.workspaceId, table.purposeKind, table.purposeRef), providerRefUnique: uniqueIndex("merchant_checkout_sessions_provider_ref_unique").on(table.merchantCheckoutRef), effectRefUnique: uniqueIndex("merchant_checkout_sessions_effect_ref_unique").on(table.merchantEffectRef), recoveryIdx: index("merchant_checkout_sessions_due_recovery_idx").on(table.state, table.nextRecoveryAt, table.id), valuesCheck: check("merchant_checkout_sessions_values_check", sql`${table.purposeKind} in ('subscription','credit_pack','channel_onboarding') and ${table.state} in ('creating','ready','completed','failed_known','expired','cancelled','outcome_unknown') and ${table.amountMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$' and ${table.termsDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.expiresAt} > ${table.createdAt} and ${table.recoveryAttempts} >= 0`) }));

export const merchantWebhookReceipts = pgTable("merchant_webhook_receipts", {
  provider: text("provider").notNull(), eventId: text("event_id").notNull(), payloadDigest: text("payload_digest").notNull(), eventType: text("event_type").notNull(), checkoutId: text("checkout_id").notNull().references(() => merchantCheckoutSessions.id, { onDelete: "restrict" }), merchantEffectRef: text("merchant_effect_ref").notNull(), state: text("state").notNull(), failureCode: text("failure_code"), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "merchant_webhook_receipts_pk", columns: [table.provider, table.eventId] }), effectUnique: uniqueIndex("merchant_webhook_receipts_effect_unique").on(table.provider, table.merchantEffectRef, table.eventType), stateIdx: index("merchant_webhook_receipts_state_idx").on(table.state, table.receivedAt, table.eventId), valuesCheck: check("merchant_webhook_receipts_values_check", sql`${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.eventType} in ('checkout.completed','checkout.failed','checkout.expired','checkout.cancelled') and ${table.state} in ('received','processing','applied','ignored','failed_known','outcome_unknown')`) }));

export const merchantSubscriptionWebhookReceipts = pgTable("merchant_subscription_webhook_receipts", {
  provider: text("provider").notNull(), eventId: text("event_id").notNull(), payloadDigest: text("payload_digest").notNull(), eventType: text("event_type").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), merchantSubscriptionRef: text("merchant_subscription_ref").notNull(), merchantTransactionRef: text("merchant_transaction_ref"), state: text("state").notNull(), failureCode: text("failure_code"), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "merchant_subscription_webhook_receipts_pk", columns: [table.provider, table.eventId] }), workspaceIdx: index("merchant_subscription_webhook_receipts_workspace_idx").on(table.workspaceId, table.providerOccurredAt, table.eventId), stateIdx: index("merchant_subscription_webhook_receipts_state_idx").on(table.state, table.receivedAt, table.eventId), valuesCheck: check("merchant_subscription_webhook_receipts_values_check", sql`${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.eventType} in ('subscription.payment_completed','subscription.active','subscription.grace','subscription.cancel_at_period_end','subscription.cancelled','subscription.suspended') and ${table.state} in ('received','processing','applied','ignored','outcome_unknown')`) }));

export const merchantBillingTransactions = pgTable("merchant_billing_transactions", {
  provider: text("provider").notNull(), transactionRef: text("transaction_ref").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), checkoutId: text("checkout_id"), purposeKind: text("purpose_kind").notNull(), merchantCustomerRef: text("merchant_customer_ref").notNull(), merchantSubscriptionRef: text("merchant_subscription_ref"), merchantReceiptRef: text("merchant_receipt_ref").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), refundedMinor: bigint("refunded_minor", { mode: "number" }).default(0).notNull(), currency: text("currency").notNull(), invoiceNumber: text("invoice_number"), periodStartsAt: timestamp("period_starts_at", { withTimezone: true }), periodEndsAt: timestamp("period_ends_at", { withTimezone: true }), status: text("status").notNull(), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "merchant_billing_transactions_pk", columns: [table.provider, table.transactionRef] }), workspaceIdx: index("merchant_billing_transactions_workspace_idx").on(table.workspaceId, table.providerOccurredAt, table.transactionRef), subscriptionIdx: index("merchant_billing_transactions_subscription_idx").on(table.provider, table.merchantSubscriptionRef, table.providerOccurredAt), valuesCheck: check("merchant_billing_transactions_values_check", sql`${table.purposeKind} in ('subscription','credit_pack','channel_onboarding','subscription_renewal') and ${table.amountMinor} >= 0 and ${table.refundedMinor} between 0 and ${table.amountMinor} and ${table.currency} ~ '^[A-Z]{3}$' and ${table.status} in ('completed','partially_refunded','refunded','disputed','chargeback_reversed') and ((${table.periodStartsAt} is null and ${table.periodEndsAt} is null) or (${table.periodStartsAt} is not null and ${table.periodEndsAt} > ${table.periodStartsAt}))`) }));

export const merchantBillingAdjustmentEvents = pgTable("merchant_billing_adjustment_events", {
  provider: text("provider").notNull(), eventId: text("event_id").notNull(), adjustmentRef: text("adjustment_ref").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), transactionRef: text("transaction_ref").notNull(), merchantSubscriptionRef: text("merchant_subscription_ref"), merchantCustomerRef: text("merchant_customer_ref").notNull(), action: text("action").notNull(), status: text("status").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), reason: text("reason").notNull(), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "merchant_billing_adjustment_events_pk", columns: [table.provider, table.eventId] }), adjustmentIdx: index("merchant_billing_adjustment_events_adjustment_idx").on(table.provider, table.adjustmentRef, table.providerOccurredAt, table.eventId), transactionIdx: index("merchant_billing_adjustment_events_transaction_idx").on(table.provider, table.transactionRef, table.providerOccurredAt, table.eventId), valuesCheck: check("merchant_billing_adjustment_events_values_check", sql`${table.action} in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and ${table.status} in ('pending_approval','approved','rejected','reversed') and ${table.amountMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$'`) }));

export const merchantAdjustmentWebhookReceipts = pgTable("merchant_adjustment_webhook_receipts", {
  provider: text("provider").notNull(), eventId: text("event_id").notNull(), payloadDigest: text("payload_digest").notNull(), adjustmentRef: text("adjustment_ref").notNull(), transactionRef: text("transaction_ref").notNull(), merchantSubscriptionRef: text("merchant_subscription_ref"), merchantCustomerRef: text("merchant_customer_ref").notNull(), action: text("action").notNull(), status: text("status").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), reason: text("reason").notNull(), state: text("state").notNull(), attempt: integer("attempt").default(0).notNull(), maxAttempts: integer("max_attempts").default(12).notNull(), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), lastErrorCode: text("last_error_code"), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "merchant_adjustment_webhook_receipts_pk", columns: [table.provider, table.eventId] }), transactionIdx: index("merchant_adjustment_webhook_receipts_transaction_idx").on(table.provider, table.transactionRef, table.state, table.nextAttemptAt), dueIdx: index("merchant_adjustment_webhook_receipts_due_idx").on(table.nextAttemptAt, table.provider, table.eventId).where(sql`${table.state} in ('received','pending_dependency','processing')`), valuesCheck: check("merchant_adjustment_webhook_receipts_values_check", sql`${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.action} in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and ${table.status} in ('pending_approval','approved','rejected','reversed') and ${table.amountMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$' and octet_length(${table.reason}) between 1 and 4096 and ${table.state} in ('received','pending_dependency','processing','applied','failed_known','outcome_unknown') and ${table.maxAttempts} between 1 and 50 and ${table.attempt} between 0 and ${table.maxAttempts} and ((${table.state} = 'processing' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.state} <> 'processing' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null))`) }));

export const merchantBillingAdjustments = pgTable("merchant_billing_adjustments", {
  provider: text("provider").notNull(), adjustmentRef: text("adjustment_ref").notNull(), eventId: text("event_id").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), transactionRef: text("transaction_ref").notNull(), merchantSubscriptionRef: text("merchant_subscription_ref"), merchantCustomerRef: text("merchant_customer_ref").notNull(), action: text("action").notNull(), status: text("status").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), reason: text("reason").notNull(), providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "merchant_billing_adjustments_pk", columns: [table.provider, table.adjustmentRef] }), transactionIdx: index("merchant_billing_adjustments_transaction_idx").on(table.provider, table.transactionRef, table.providerOccurredAt), valuesCheck: check("merchant_billing_adjustments_values_check", sql`${table.action} in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and ${table.status} in ('pending_approval','approved','rejected','reversed') and ${table.amountMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$'`) }));

export const merchantCreditLiabilities = pgTable("merchant_credit_liabilities", {
  provider: text("provider").notNull(), transactionRef: text("transaction_ref").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), bucketId: text("bucket_id").notNull(), targetClawbackUnits: bigint("target_clawback_units", { mode: "number" }).notNull(), appliedClawbackUnits: bigint("applied_clawback_units", { mode: "number" }).notNull(), outstandingUnits: bigint("outstanding_units", { mode: "number" }).notNull(), state: text("state").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "merchant_credit_liabilities_pk", columns: [table.provider, table.transactionRef] }), transactionFk: foreignKey({ name: "merchant_credit_liabilities_transaction_fk", columns: [table.provider, table.transactionRef], foreignColumns: [merchantBillingTransactions.provider, merchantBillingTransactions.transactionRef] }).onDelete("restrict"), bucketFk: foreignKey({ name: "merchant_credit_liabilities_bucket_fk", columns: [table.workspaceId, table.bucketId], foreignColumns: [generationCreditBuckets.workspaceId, generationCreditBuckets.id] }).onDelete("restrict"), workspaceIdx: index("merchant_credit_liabilities_workspace_idx").on(table.workspaceId, table.state, table.updatedAt), valuesCheck: check("merchant_credit_liabilities_values_check", sql`${table.targetClawbackUnits} >= 0 and ${table.appliedClawbackUnits} >= 0 and ${table.outstandingUnits} >= 0 and ${table.targetClawbackUnits} = ${table.appliedClawbackUnits} + ${table.outstandingUnits} and ((${table.state} = 'open' and ${table.outstandingUnits} > 0) or (${table.state} = 'clear' and ${table.outstandingUnits} = 0))`) }));

export const merchantExecutionHolds = pgTable("merchant_execution_holds", {
  provider: text("provider").notNull(), transactionRef: text("transaction_ref").notNull(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), merchantSubscriptionRef: text("merchant_subscription_ref").notNull(), periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(), periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(), reason: text("reason").notNull(), state: text("state").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "merchant_execution_holds_pk", columns: [table.provider, table.transactionRef] }), transactionFk: foreignKey({ name: "merchant_execution_holds_transaction_fk", columns: [table.provider, table.transactionRef], foreignColumns: [merchantBillingTransactions.provider, merchantBillingTransactions.transactionRef] }).onDelete("restrict"), workspaceIdx: index("merchant_execution_holds_workspace_idx").on(table.workspaceId, table.state, table.updatedAt), activePeriodIdx: index("merchant_execution_holds_active_period_idx").on(table.workspaceId, table.merchantSubscriptionRef, table.periodStartsAt, table.periodEndsAt).where(sql`${table.state} = 'active'`), valuesCheck: check("merchant_execution_holds_values_check", sql`${table.periodEndsAt} > ${table.periodStartsAt} and ${table.reason} in ('refunded','disputed') and ${table.state} in ('active','released')`) }));

export const workspaceNotificationPreferences = pgTable("workspace_notification_preferences", {
  workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(), deliveryLocale: text("delivery_locale"), billingEmailEnabled: boolean("billing_email_enabled").default(true).notNull(), channelEmailEnabled: boolean("channel_email_enabled").default(true).notNull(), publishingEmailEnabled: boolean("publishing_email_enabled").default(true).notNull(), creditEmailEnabled: boolean("credit_email_enabled").default(true).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "workspace_notification_preferences_pk", columns: [table.workspaceId, table.userId] }), membershipFk: foreignKey({ name: "workspace_notification_preferences_membership_fk", columns: [table.workspaceId, table.userId], foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId] }).onDelete("cascade"), userIdx: index("workspace_notification_preferences_user_idx").on(table.userId, table.workspaceId), localeCheck: check("workspace_notification_preferences_locale_check", sql`${table.deliveryLocale} is null or ${table.deliveryLocale} in ('ar','en')`) }));

export const workspaceNotificationEvents = pgTable("workspace_notification_events", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), eventType: text("event_type").notNull(), sourceRef: text("source_ref").notNull(), requiredPermission: text("required_permission").notNull(), severity: text("severity").notNull(), facts: jsonb("facts").$type<Record<string, string | number | boolean | null>>().notNull(), actionPath: text("action_path").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "workspace_notification_events_pk", columns: [table.workspaceId, table.id] }), sourceUnique: uniqueIndex("workspace_notification_events_source_unique").on(table.workspaceId, table.sourceRef), workspaceFk: foreignKey({ name: "workspace_notification_events_workspace_fk", columns: [table.workspaceId], foreignColumns: [workspaces.id] }).onDelete("restrict"), cursorIdx: index("workspace_notification_events_cursor_idx").on(table.workspaceId, table.occurredAt.desc(), table.id.desc()), permissionCursorIdx: index("workspace_notification_events_permission_cursor_idx").on(table.workspaceId, table.requiredPermission, table.occurredAt.desc(), table.id.desc()), valuesCheck: check("workspace_notification_events_values_check", sql`${table.eventType} in ('billing.refund_applied','billing.refund_reversed','billing.dispute_opened','billing.dispute_resolved','security.credential_created','security.credential_rotated','security.credential_revoked','security.credential_status_changed','security.spend_authority_changed','channel.consent_expiring','channel.reconnect_required','publishing.approval_requested','publishing.approval_approved','publishing.approval_denied','publishing.delivery_failed','publishing.delivery_outcome_unknown','publishing.social_failed','credits.low','credits.exhausted') and ${table.requiredPermission} in ('workspaces:write','social:view','social:manage','product:billing:read') and ((${table.eventType} like 'billing.%' and ${table.requiredPermission} = 'product:billing:read') or (${table.eventType} like 'credits.%' and ${table.requiredPermission} = 'product:billing:read') or (${table.eventType} like 'security.%' and ${table.requiredPermission} = 'workspaces:write') or (${table.eventType} like 'channel.%' and ${table.requiredPermission} = 'social:manage') or (${table.eventType} = 'publishing.approval_requested' and ${table.requiredPermission} = 'social:manage') or (${table.eventType} in ('publishing.approval_approved','publishing.approval_denied','publishing.delivery_failed','publishing.delivery_outcome_unknown','publishing.social_failed') and ${table.requiredPermission} = 'social:view')) and ${table.severity} in ('info','warning','critical') and octet_length(${table.sourceRef}) between 1 and 500 and octet_length(${table.facts}::text) between 2 and 8192 and octet_length(${table.actionPath}) between 1 and 501 and ${table.actionPath} ~ '^/[A-Za-z0-9/_?=&.-]*$'`) }));

export const workspaceNotificationRecipients = pgTable("workspace_notification_recipients", {
  workspaceId: text("workspace_id").notNull(), eventId: text("event_id").notNull(), userId: text("user_id").notNull(), deliveryLocale: text("delivery_locale").notNull(), inAppState: text("in_app_state").default("unread").notNull(), emailState: text("email_state").notNull(), attempt: integer("attempt").default(0).notNull(), maxAttempts: integer("max_attempts").default(8).notNull(), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), lastErrorCode: text("last_error_code"), catalogVersion: text("catalog_version"), renderedTitle: text("rendered_title"), renderedBody: text("rendered_body"), renderedActionLabel: text("rendered_action_label"), emailActionUrl: text("email_action_url"), emailPayloadDigest: text("email_payload_digest"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), readAt: timestamp("read_at", { withTimezone: true }), emailDeliveredAt: timestamp("email_delivered_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "workspace_notification_recipients_pk", columns: [table.workspaceId, table.eventId, table.userId] }), eventFk: foreignKey({ name: "workspace_notification_recipients_event_fk", columns: [table.workspaceId, table.eventId], foreignColumns: [workspaceNotificationEvents.workspaceId, workspaceNotificationEvents.id] }).onDelete("cascade"), membershipFk: foreignKey({ name: "workspace_notification_recipients_membership_fk", columns: [table.workspaceId, table.userId], foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId] }).onDelete("cascade"), userCursorIdx: index("workspace_notification_recipients_user_cursor_idx").on(table.workspaceId, table.userId, table.createdAt.desc(), table.eventId.desc()), emailDueIdx: index("workspace_notification_recipients_email_due_idx").on(table.nextAttemptAt, table.workspaceId, table.eventId, table.userId).where(sql`${table.emailState} in ('pending','processing')`), valuesCheck: check("workspace_notification_recipients_values_check", sql`${table.deliveryLocale} in ('ar','en') and ${table.inAppState} in ('unread','read') and ${table.emailState} in ('pending','processing','delivered','suppressed','failed_known','outcome_unknown') and ${table.maxAttempts} between 1 and 20 and ${table.attempt} between 0 and ${table.maxAttempts} and ((${table.inAppState} = 'unread' and ${table.readAt} is null) or (${table.inAppState} = 'read' and ${table.readAt} is not null)) and ((${table.emailState} = 'processing' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.emailState} <> 'processing' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)) and ((${table.emailState} = 'delivered' and ${table.emailDeliveredAt} is not null) or (${table.emailState} <> 'delivered' and ${table.emailDeliveredAt} is null))`), snapshotCheck: check("workspace_notification_recipients_snapshot_check", sql`((${table.catalogVersion} is null and ${table.renderedTitle} is null and ${table.renderedBody} is null and ${table.renderedActionLabel} is null and ${table.emailActionUrl} is null and ${table.emailPayloadDigest} is null) or (octet_length(${table.catalogVersion}) between 1 and 80 and octet_length(${table.renderedTitle}) between 1 and 500 and octet_length(${table.renderedBody}) between 1 and 4096 and octet_length(${table.renderedActionLabel}) between 1 and 200 and octet_length(${table.emailActionUrl}) between 9 and 2048 and ${table.emailActionUrl} ~ '^https?://[^[:space:]]+$' and ${table.emailPayloadDigest} ~ '^sha256:[a-f0-9]{64}$'))`) }));

export const workspaceNotificationCreditStates = pgTable("workspace_notification_credit_states", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "restrict" }), balanceState: text("balance_state").notNull(), availableUnits: bigint("available_units", { mode: "number" }).notNull(), warningThreshold: bigint("warning_threshold", { mode: "number" }).default(10).notNull(), episode: integer("episode").default(0).notNull(), lastLedgerSequence: integer("last_ledger_sequence").default(0).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ valuesCheck: check("workspace_notification_credit_states_values_check", sql`${table.balanceState} in ('healthy','low','exhausted') and ${table.availableUnits} >= 0 and ${table.warningThreshold} between 1 and 1000000 and ${table.episode} >= 0 and ${table.lastLedgerSequence} >= 0`) }));

export const generationCreditPackVersions = pgTable("generation_credit_pack_versions", {
  packId: text("pack_id").notNull(), version: integer("version").notNull(), status: text("status").notNull(), authoredName: jsonb("authored_name").$type<{ ar: string; en: string }>().notNull(), creditUnits: bigint("credit_units", { mode: "number" }).notNull(), priceMinor: bigint("price_minor", { mode: "number" }).notNull(), taxMinor: bigint("tax_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), termsDigest: text("terms_digest").notNull(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), retiredAt: timestamp("retired_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_credit_pack_versions_pk", columns: [table.packId, table.version] }), activeIdx: index("generation_credit_pack_versions_active_idx").on(table.status, table.effectiveAt, table.retiredAt), valuesCheck: check("generation_credit_pack_versions_values_check", sql`${table.version}>0 and ${table.status} in ('draft','active','retired') and ${table.creditUnits}>0 and ${table.priceMinor}>0 and ${table.taxMinor}>=0 and ${table.currency} ~ '^[A-Z]{3}$' and ${table.termsDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const workspaceReferralCodes = pgTable("workspace_referral_codes", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), code: text("code").notNull(), rewardMode: text("reward_mode").notNull(), status: text("status").notNull(), recipientUserId: text("recipient_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "workspace_referral_codes_pk", columns: [table.workspaceId, table.id] }), codeUnique: uniqueIndex("workspace_referral_codes_code_unique").on(table.code), valuesCheck: check("workspace_referral_codes_values_check", sql`${table.rewardMode} in ('generation_credit','cash') and ${table.status} in ('active','paused','closed') and ${table.code} ~ '^[A-Z0-9-]{6,32}$'`) }));

export const referralCaptureReceipts = pgTable("referral_capture_receipts", {
  id: text("id").primaryKey(),
  referralCodeId: text("referral_code_id").notNull(),
  referrerWorkspaceId: text("referrer_workspace_id").notNull(),
  visitorTokenDigest: text("visitor_token_digest").notNull(),
  state: text("state").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attributedAt: timestamp("attributed_at", { withTimezone: true }),
}, (table) => ({
  codeFk: foreignKey({ name: "referral_capture_receipts_code_fk", columns: [table.referrerWorkspaceId, table.referralCodeId], foreignColumns: [workspaceReferralCodes.workspaceId, workspaceReferralCodes.id] }).onDelete("restrict"),
  visitorUnique: uniqueIndex("referral_capture_receipts_visitor_unique").on(table.visitorTokenDigest),
  referrerCursorIdx: index("referral_capture_receipts_referrer_cursor_idx").on(table.referrerWorkspaceId, table.capturedAt, table.id),
  expiryIdx: index("referral_capture_receipts_expiry_idx").on(table.state, table.expiresAt),
  valuesCheck: check("referral_capture_receipts_values_check", sql`${table.visitorTokenDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.state} in ('captured','attributed','expired','superseded') and ${table.expiresAt} > ${table.capturedAt} and ((${table.state} = 'attributed' and ${table.attributedAt} is not null) or (${table.state} <> 'attributed' and ${table.attributedAt} is null))`),
}));

export const referralAttributions = pgTable("referral_attributions", {
  id: text("id").primaryKey(), captureId: text("capture_id"), referralCodeId: text("referral_code_id").notNull(), referrerWorkspaceId: text("referrer_workspace_id").notNull(), referredIdentityDigest: text("referred_identity_digest").notNull(), referredWorkspaceId: text("referred_workspace_id").references(() => workspaces.id, { onDelete: "restrict" }), state: text("state").notNull(), attributionDigest: text("attribution_digest").notNull(), attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull(), qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
}, (table) => ({ captureFk: foreignKey({ name: "referral_attributions_capture_fk", columns: [table.captureId], foreignColumns: [referralCaptureReceipts.id] }).onDelete("restrict"), codeFk: foreignKey({ name: "referral_attributions_code_fk", columns: [table.referrerWorkspaceId, table.referralCodeId], foreignColumns: [workspaceReferralCodes.workspaceId, workspaceReferralCodes.id] }).onDelete("restrict"), captureUnique: uniqueIndex("referral_attributions_capture_unique").on(table.captureId), recipientUnique: uniqueIndex("referral_attributions_recipient_unique").on(table.referredIdentityDigest), referrerIdx: index("referral_attributions_referrer_idx").on(table.referrerWorkspaceId, table.state, table.attributedAt), valuesCheck: check("referral_attributions_values_check", sql`${table.state} in ('attributed','qualified','rewarded','fraud_hold','refunded','clawed_back','rejected') and ${table.referredIdentityDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.attributionDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const referralRewards = pgTable("referral_rewards", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), attributionId: text("attribution_id").notNull().references(() => referralAttributions.id, { onDelete: "restrict" }), mode: text("mode").notNull(), state: text("state").notNull(), creditUnits: bigint("credit_units", { mode: "number" }), cashMinor: bigint("cash_minor", { mode: "number" }), currency: text("currency"), thresholdMinor: bigint("threshold_minor", { mode: "number" }), taxEvidenceRef: text("tax_evidence_ref"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "referral_rewards_pk", columns: [table.workspaceId, table.id] }), attributionUnique: uniqueIndex("referral_rewards_attribution_unique").on(table.attributionId), stateIdx: index("referral_rewards_state_idx").on(table.workspaceId, table.state, table.updatedAt), valuesCheck: check("referral_rewards_values_check", sql`${table.mode} in ('generation_credit','cash') and ${table.state} in ('pending','available','payout_pending','paid','fraud_hold','refunded','clawed_back') and ((${table.mode} = 'generation_credit' and ${table.creditUnits} > 0 and ${table.cashMinor} is null and ${table.currency} is null) or (${table.mode} = 'cash' and ${table.cashMinor} > 0 and ${table.currency} ~ '^[A-Z]{3}$' and ${table.creditUnits} is null))`) }));

export const referralPayoutLedgerEntries = pgTable("referral_payout_ledger_entries", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), sequence: integer("sequence").notNull(), id: text("id").notNull(), rewardId: text("reward_id").notNull(), entryType: text("entry_type").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), merchantPayoutRef: text("merchant_payout_ref"), taxEvidenceRef: text("tax_evidence_ref"), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "referral_payout_ledger_entries_pk", columns: [table.workspaceId, table.sequence] }), rewardFk: foreignKey({ name: "referral_payout_ledger_entries_reward_fk", columns: [table.workspaceId, table.rewardId], foreignColumns: [referralRewards.workspaceId, referralRewards.id] }).onDelete("restrict"), idUnique: uniqueIndex("referral_payout_ledger_entries_id_unique").on(table.workspaceId, table.id), rewardIdx: index("referral_payout_ledger_entries_reward_idx").on(table.workspaceId, table.rewardId, table.sequence), valuesCheck: check("referral_payout_ledger_entries_values_check", sql`${table.sequence} > 0 and ${table.entryType} in ('earned','hold','release','paid','refund','clawback') and ${table.amountMinor} <> 0 and ${table.currency} ~ '^[A-Z]{3}$'`) }));

export const referralFraudEvidence = pgTable("referral_fraud_evidence", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), attributionId: text("attribution_id").notNull().references(() => referralAttributions.id, { onDelete: "restrict" }), decision: text("decision").notNull(), policyVersion: text("policy_version").notNull(), evidenceDigest: text("evidence_digest").notNull(), reviewerRef: text("reviewer_ref").notNull(), decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "referral_fraud_evidence_pk", columns: [table.workspaceId, table.id] }), attributionIdx: index("referral_fraud_evidence_attribution_idx").on(table.workspaceId, table.attributionId, table.decidedAt), valuesCheck: check("referral_fraud_evidence_values_check", sql`${table.decision} in ('clear','hold','reject') and ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const channelOnboardingOfferVersions = pgTable("channel_onboarding_offer_versions", {
  offerId: text("offer_id").notNull(), version: integer("version").notNull(), platform: socialPlatformEnum("platform").notNull(), status: text("status").notNull(), authoredName: jsonb("authored_name").$type<{ ar: string; en: string }>().notNull(), authoredDescription: jsonb("authored_description").$type<{ ar: string; en: string }>().notNull(), supportedRegions: jsonb("supported_regions").$type<string[]>().notNull(), customerRequirements: jsonb("customer_requirements").$type<Array<{ key: string; label: { ar: string; en: string }; instructions: { ar: string; en: string }; required: boolean }>>().notNull(), maxPartnerHours: integer("max_partner_hours").notNull(), localPriceMinor: bigint("local_price_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), taxMode: text("tax_mode").notNull(), termsDigest: text("terms_digest").notNull(), compliancePolicyVersion: text("compliance_policy_version").notNull(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), retiredAt: timestamp("retired_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_offer_versions_pk", columns: [table.offerId, table.version] }), activeIdx: index("channel_onboarding_offer_versions_active_idx").on(table.status, table.platform, table.effectiveAt), valuesCheck: check("channel_onboarding_offer_versions_values_check", sql`${table.version} > 0 and ${table.status} in ('draft','active','retired') and ${table.maxPartnerHours} between 0 and 100 and ${table.localPriceMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$' and ${table.taxMode} = 'inclusive' and ${table.termsDigest} ~ '^sha256:[a-f0-9]{64}$' and jsonb_array_length(${table.supportedRegions}) > 0`) }));

export const channelOnboardingPartners = pgTable("channel_onboarding_partners", {
  id: text("id").primaryKey(), legalName: text("legal_name").notNull(), status: text("status").notNull(), supportedPlatforms: jsonb("supported_platforms").$type<string[]>().notNull(), supportedRegions: jsonb("supported_regions").$type<string[]>().notNull(), vettingDigest: text("vetting_digest").notNull(), policyVersion: text("policy_version").notNull(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ eligibilityIdx: index("channel_onboarding_partners_eligibility_idx").on(table.status, table.expiresAt), valuesCheck: check("channel_onboarding_partners_values_check", sql`${table.status} in ('vetted','suspended','revoked') and ${table.vettingDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.expiresAt} > ${table.effectiveAt} and jsonb_array_length(${table.supportedPlatforms}) > 0 and jsonb_array_length(${table.supportedRegions}) > 0`) }));

export const channelOnboardingCommercialQuotes = pgTable("channel_onboarding_commercial_quotes", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), purposeRef: text("purpose_ref").notNull(), offerId: text("offer_id").notNull(), offerVersion: integer("offer_version").notNull(), state: text("state").notNull(), subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(), taxMinor: bigint("tax_minor", { mode: "number" }).notNull(), totalMinor: bigint("total_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), termsDigest: text("terms_digest").notNull(), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "restrict" }), acceptedAt: timestamp("accepted_at", { withTimezone: true }), merchantPaymentRef: text("merchant_payment_ref"), merchantRefundRef: text("merchant_refund_ref"),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_commercial_quotes_pk", columns: [table.workspaceId, table.id] }), offerFk: foreignKey({ name: "channel_onboarding_commercial_quotes_offer_fk", columns: [table.offerId, table.offerVersion], foreignColumns: [channelOnboardingOfferVersions.offerId, channelOnboardingOfferVersions.version] }).onDelete("restrict"), purposeUnique: uniqueIndex("channel_onboarding_commercial_quotes_purpose_unique").on(table.workspaceId, table.purposeRef), stateIdx: index("channel_onboarding_commercial_quotes_state_idx").on(table.workspaceId, table.state, table.expiresAt), valuesCheck: check("channel_onboarding_commercial_quotes_values_check", sql`${table.state} in ('offered','accepted','payment_pending','paid','refunded','cancelled','failed','expired') and ${table.subtotalMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.totalMinor} = ${table.subtotalMinor} + ${table.taxMinor} and ${table.currency} ~ '^[A-Z]{3}$' and ${table.termsDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.expiresAt} > ${table.issuedAt}`) }));

export const channelOnboardingOrders = pgTable("channel_onboarding_orders", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), offerId: text("offer_id").notNull(), offerVersion: integer("offer_version").notNull(), platform: socialPlatformEnum("platform").notNull(), region: text("region").notNull(), state: text("state").notNull(), revision: integer("revision").default(1).notNull(), quoteId: text("quote_id"), credentialProfileId: text("credential_profile_id").references(() => credentialProfiles.id, { onDelete: "restrict" }), connectedSocialAccountId: text("connected_social_account_id").references(() => socialAccounts.id, { onDelete: "restrict" }), complianceEvidenceDigest: text("compliance_evidence_digest").notNull(), blockedReasonCode: text("blocked_reason_code"), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_orders_pk", columns: [table.workspaceId, table.id] }), offerFk: foreignKey({ name: "channel_onboarding_orders_offer_fk", columns: [table.offerId, table.offerVersion], foreignColumns: [channelOnboardingOfferVersions.offerId, channelOnboardingOfferVersions.version] }).onDelete("restrict"), quoteFk: foreignKey({ name: "channel_onboarding_orders_quote_fk", columns: [table.workspaceId, table.quoteId], foreignColumns: [channelOnboardingCommercialQuotes.workspaceId, channelOnboardingCommercialQuotes.id] }).onDelete("restrict"), stateCursorIdx: index("channel_onboarding_orders_state_cursor_idx").on(table.workspaceId, table.state, table.updatedAt, table.id), stateCheck: check("channel_onboarding_orders_state_check", sql`${table.state} in ('draft','quoted','payment_pending','accepted','customer_action','partner_action','readiness_review','ready_to_connect','connected','blocked','cancelled','refunded','failed') and ${table.revision} > 0 and ${table.complianceEvidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const channelOnboardingPartnerAssignments = pgTable("channel_onboarding_partner_assignments", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), orderId: text("order_id").notNull(), partnerId: text("partner_id").notNull().references(() => channelOnboardingPartners.id, { onDelete: "restrict" }), purpose: text("purpose").notNull(), scope: jsonb("scope").$type<{ permittedActions: string[]; orderId: string; platform: string; region: string }>().notNull(), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }), assignedByUserId: text("assigned_by_user_id").references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_partner_assignments_pk", columns: [table.workspaceId, table.id] }), orderFk: foreignKey({ name: "channel_onboarding_partner_assignments_order_fk", columns: [table.workspaceId, table.orderId], foreignColumns: [channelOnboardingOrders.workspaceId, channelOnboardingOrders.id] }).onDelete("restrict"), activeIdx: index("channel_onboarding_partner_assignments_active_idx").on(table.workspaceId, table.orderId, table.expiresAt), valuesCheck: check("channel_onboarding_partner_assignments_values_check", sql`${table.purpose} in ('guided_setup','readiness_review','support') and ${table.expiresAt} > ${table.startsAt} and (${table.expiresAt}-${table.startsAt}) <= interval '14 days' and ${table.scope} ?& array['permittedActions','orderId','platform','region'] and not (${table.scope}->'permittedActions' ?| array['credential.read','credential.write','publish','impersonate'])`) }));

export const channelOnboardingTasks = pgTable("channel_onboarding_tasks", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), orderId: text("order_id").notNull(), assignmentId: text("assignment_id"), actorKind: text("actor_kind").notNull(), kind: text("kind").notNull(), status: text("status").notNull(), instructions: jsonb("instructions").$type<{ ar: string; en: string }>().notNull(), evidenceDigest: text("evidence_digest"), dueAt: timestamp("due_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_tasks_pk", columns: [table.workspaceId, table.id] }), orderFk: foreignKey({ name: "channel_onboarding_tasks_order_fk", columns: [table.workspaceId, table.orderId], foreignColumns: [channelOnboardingOrders.workspaceId, channelOnboardingOrders.id] }).onDelete("restrict"), assignmentFk: foreignKey({ name: "channel_onboarding_tasks_assignment_fk", columns: [table.workspaceId, table.assignmentId], foreignColumns: [channelOnboardingPartnerAssignments.workspaceId, channelOnboardingPartnerAssignments.id] }).onDelete("restrict"), orderIdx: index("channel_onboarding_tasks_order_idx").on(table.workspaceId, table.orderId, table.status, table.createdAt), valuesCheck: check("channel_onboarding_tasks_values_check", sql`${table.actorKind} in ('customer','partner','system') and ${table.status} in ('open','completed','cancelled') and (${table.evidenceDigest} is null or ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$')`) }));

export const channelOnboardingReadinessReviews = pgTable("channel_onboarding_readiness_reviews", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), orderId: text("order_id").notNull(), decision: text("decision").notNull(), checklist: jsonb("checklist").$type<Record<string, boolean>>().notNull(), evidenceDigest: text("evidence_digest").notNull(), reviewerRef: text("reviewer_ref").notNull(), reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_readiness_reviews_pk", columns: [table.workspaceId, table.id] }), orderFk: foreignKey({ name: "channel_onboarding_readiness_reviews_order_fk", columns: [table.workspaceId, table.orderId], foreignColumns: [channelOnboardingOrders.workspaceId, channelOnboardingOrders.id] }).onDelete("restrict"), orderIdx: index("channel_onboarding_readiness_reviews_order_idx").on(table.workspaceId, table.orderId, table.reviewedAt), valuesCheck: check("channel_onboarding_readiness_reviews_values_check", sql`${table.decision} in ('ready','customer_action','partner_action','blocked') and ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

export const channelOnboardingCredentialHandoffs = pgTable("channel_onboarding_credential_handoffs", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), orderId: text("order_id").notNull(), credentialProfileId: text("credential_profile_id").notNull().references(() => credentialProfiles.id, { onDelete: "restrict" }), profileVersion: integer("profile_version").notNull(), provider: text("provider").notNull(), handedOffByUserId: text("handed_off_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), handedOffAt: timestamp("handed_off_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_credential_handoffs_pk", columns: [table.workspaceId, table.id] }), orderFk: foreignKey({ name: "channel_onboarding_credential_handoffs_order_fk", columns: [table.workspaceId, table.orderId], foreignColumns: [channelOnboardingOrders.workspaceId, channelOnboardingOrders.id] }).onDelete("restrict"), orderVersionUnique: uniqueIndex("channel_onboarding_credential_handoffs_order_version_unique").on(table.workspaceId, table.orderId, table.profileVersion), versionCheck: check("channel_onboarding_credential_handoffs_version_check", sql`${table.profileVersion} > 0`) }));

export const channelOnboardingEvents = pgTable("channel_onboarding_events", {
  workspaceId: text("workspace_id").notNull(), orderId: text("order_id").notNull(), revision: integer("revision").notNull(), id: text("id").notNull(), fromState: text("from_state"), toState: text("to_state").notNull(), actorRef: text("actor_ref").notNull(), reasonCode: text("reason_code").notNull(), facts: jsonb("facts").$type<Record<string, unknown>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_events_pk", columns: [table.workspaceId, table.orderId, table.revision] }), orderFk: foreignKey({ name: "channel_onboarding_events_order_fk", columns: [table.workspaceId, table.orderId], foreignColumns: [channelOnboardingOrders.workspaceId, channelOnboardingOrders.id] }).onDelete("restrict"), idUnique: uniqueIndex("channel_onboarding_events_id_unique").on(table.workspaceId, table.id), revisionCheck: check("channel_onboarding_events_revision_check", sql`${table.revision} > 0`) }));

export const channelOnboardingCommandReceipts = pgTable("channel_onboarding_command_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), result: jsonb("result").$type<Record<string, unknown>>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ pk: primaryKey({ name: "channel_onboarding_command_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }), digestCheck: check("channel_onboarding_command_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$'`) }));

/** Immutable, deploy-seeded revisions that govern every Content draft and render. */
export const contentFormatDefinitionRevisions = pgTable("content_format_definition_revisions", {
  definitionId: text("definition_id").notNull(),
  revision: integer("revision").notNull(),
  format: text("format").notNull(),
  status: text("status").notNull(),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  documentDigest: text("document_digest").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_format_definition_revisions_pk", columns: [table.definitionId, table.revision] }),
  formatStatusIdx: index("content_format_definition_revisions_format_status_idx").on(table.format, table.status, table.revision),
  valuesCheck: check("content_format_definition_revisions_values_check", sql`${table.definitionId} = 'content-format:' || ${table.format} and ${table.revision} > 0 and ${table.status} in ('draft','active','retired') and ${table.documentDigest} ~ '^sha256:[a-f0-9]{64}$' and ((${table.status} = 'active' and ${table.activatedAt} is not null and ${table.retiredAt} is null) or ${table.status} <> 'active')`),
}));

/** Workspace-owned licensed themes. Revisions are immutable and drafts pin an exact revision. */
export const contentThemes = pgTable("content_themes", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull(),
  activeRevision: integer("active_revision"),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "content_themes_pk", columns: [table.workspaceId, table.id] }),
  stateIdx: index("content_themes_state_idx").on(table.workspaceId, table.state, table.updatedAt),
  valuesCheck: check("content_themes_values_check", sql`${table.state} in ('draft','active','archived') and (${table.activeRevision} is null or ${table.activeRevision} > 0)`),
}));

export const contentThemeRevisions = pgTable("content_theme_revisions", {
  workspaceId: text("workspace_id").notNull(),
  themeId: text("theme_id").notNull(),
  revision: integer("revision").notNull(),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  documentDigest: text("document_digest").notNull(),
  licenseEvidenceIds: jsonb("license_evidence_ids").$type<string[]>().notNull(),
  licenseExpiresAt: timestamp("license_expires_at", { withTimezone: true }),
  authoredByUserId: text("authored_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_theme_revisions_pk", columns: [table.workspaceId, table.themeId, table.revision] }),
  themeFk: foreignKey({ name: "content_theme_revisions_theme_fk", columns: [table.workspaceId, table.themeId], foreignColumns: [contentThemes.workspaceId, contentThemes.id] }).onDelete("restrict"),
  digestUnique: uniqueIndex("content_theme_revisions_digest_unique").on(table.workspaceId, table.themeId, table.documentDigest),
  valuesCheck: check("content_theme_revisions_values_check", sql`${table.revision} > 0 and ${table.documentDigest} ~ '^sha256:[a-f0-9]{64}$' and jsonb_array_length(${table.licenseEvidenceIds}) > 0`),
}));

/** Pinned output-similarity decisions; rows are append-only audit evidence. */
export const blitzSimilarityEvidence = pgTable("blitz_similarity_evidence", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(),
  blitzItemId: text("blitz_item_id").notNull(),
  blitzItemRevision: integer("blitz_item_revision").notNull(),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  candidateAssetId: text("candidate_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  evaluatorId: text("evaluator_id").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  evidenceDigest: text("evidence_digest").notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "blitz_similarity_evidence_pk", columns: [table.workspaceId, table.id] }),
  itemFk: foreignKey({ name: "blitz_similarity_evidence_item_fk", columns: [table.workspaceId, table.blitzItemId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id] }).onDelete("restrict"),
  candidateUnique: uniqueIndex("blitz_similarity_evidence_candidate_unique").on(table.workspaceId, table.blitzItemId, table.blitzItemRevision, table.candidateAssetId),
  statusIdx: index("blitz_similarity_evidence_status_idx").on(table.workspaceId, table.status, table.evaluatedAt),
  valuesCheck: check("blitz_similarity_evidence_values_check", sql`${table.blitzItemRevision} > 0 and ${table.status} in ('passed','blocked') and ${table.evidenceDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

/** Durable human-attribution and replay receipt for canonical Calendar reschedules. */
export const calendarRescheduleCommands = pgTable("calendar_reschedule_commands", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  state: text("state").notNull(),
  initiatingUserId: text("initiating_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  initiatingPrincipalId: text("initiating_principal_id").notNull(),
  initiatingKeyId: text("initiating_key_id").notNull(),
  authorizationEvidenceRef: text("authorization_evidence_ref").notNull(),
  servicePrincipalId: text("service_principal_id").notNull(),
  serviceKeyId: text("service_key_id").notNull(),
  sourceRevisionId: text("source_revision_id").notNull(),
  sourceRevision: integer("source_revision").notNull(),
  targetId: text("target_id").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "calendar_reschedule_commands_pk", columns: [table.workspaceId, table.idempotencyKey] }),
  sourceIdx: index("calendar_reschedule_commands_source_idx").on(table.workspaceId, table.sourceRevisionId, table.targetId, table.createdAt),
  valuesCheck: check("calendar_reschedule_commands_values_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.state} in ('pending','completed') and ${table.sourceRevision} > 0 and length(${table.idempotencyKey}) between 8 and 200 and ((${table.state} = 'pending' and ${table.result} is null and ${table.completedAt} is null) or (${table.state} = 'completed' and ${table.result} is not null and ${table.completedAt} is not null))`),
}));

/** Append-only personal consent revisions for third-party advertising measurement. */
export const marketingAttributionConsents = pgTable("marketing_attribution_consents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  revision: integer("revision").notNull(),
  purpose: text("purpose").notNull(),
  status: text("status").notNull(),
  noticeVersion: text("notice_version").notNull(),
  regionReviewVersion: text("region_review_version").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "marketing_attribution_consents_pk", columns: [table.workspaceId, table.userId, table.provider, table.revision] }),
  currentIdx: index("marketing_attribution_consents_current_idx").on(table.workspaceId, table.userId, table.provider, table.revision),
  valuesCheck: check("marketing_attribution_consents_values_check", sql`${table.provider} = 'x_ads' and ${table.purpose} = 'advertising_attribution' and ${table.status} in ('active','revoked') and ${table.revision} > 0 and length(${table.noticeVersion}) between 1 and 100 and length(${table.regionReviewVersion}) between 1 and 100 and ${table.expiresAt} > ${table.issuedAt}`),
}));

/** Privacy-minimised server-side conversion outbox; payloads are scrubbed at terminal state. */
export const marketingAttributionEvents = pgTable("marketing_attribution_events", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  eventName: text("event_name").notNull(),
  conversionId: text("conversion_id").notNull(),
  consentRevision: integer("consent_revision").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  state: text("state").notNull(),
  attempt: integer("attempt").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(6).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "marketing_attribution_events_pk", columns: [table.workspaceId, table.id] }),
  conversionUnique: uniqueIndex("marketing_attribution_events_conversion_unique").on(table.provider, table.conversionId),
  dueIdx: index("marketing_attribution_events_due_idx").on(table.state, table.nextAttemptAt, table.leaseExpiresAt, table.id),
  subjectIdx: index("marketing_attribution_events_subject_idx").on(table.workspaceId, table.userId, table.provider, table.state),
  consentFk: foreignKey({ name: "marketing_attribution_events_consent_fk", columns: [table.workspaceId, table.userId, table.provider, table.consentRevision], foreignColumns: [marketingAttributionConsents.workspaceId, marketingAttributionConsents.userId, marketingAttributionConsents.provider, marketingAttributionConsents.revision] }).onDelete("restrict"),
  valuesCheck: check("marketing_attribution_events_values_check", sql`${table.provider} = 'x_ads' and ${table.eventName} in ('sign_up','trial_started','purchase') and ${table.id} ~ '^mae_[a-f0-9]{32}$' and ${table.conversionId} ~ '^mac_[a-f0-9]{64}$' and ${table.consentRevision} > 0 and ${table.state} in ('queued','delivering','delivered','cancelled','failed_known','outcome_unknown') and ${table.attempt} >= 0 and ${table.maxAttempts} between 1 and 12 and ${table.attempt} <= ${table.maxAttempts} and octet_length(${table.payload}::text) <= 4096 and ${table.expiresAt} > ${table.createdAt}`),
}));

/** Minimal immutable evidence for data already disclosed to an advertising provider. */
export const marketingAttributionDeliveryReceipts = pgTable("marketing_attribution_delivery_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  eventId: text("event_id").notNull(),
  provider: text("provider").notNull(),
  conversionId: text("conversion_id").notNull(),
  eventName: text("event_name").notNull(),
  outcome: text("outcome").notNull(),
  requestDigest: text("request_digest").notNull(),
  providerDebugId: text("provider_debug_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "marketing_attribution_delivery_receipts_pk", columns: [table.workspaceId, table.eventId] }),
  eventFk: foreignKey({ name: "marketing_attribution_delivery_receipts_event_fk", columns: [table.workspaceId, table.eventId], foreignColumns: [marketingAttributionEvents.workspaceId, marketingAttributionEvents.id] }).onDelete("restrict"),
  expiryIdx: index("marketing_attribution_delivery_receipts_expiry_idx").on(table.expiresAt),
  valuesCheck: check("marketing_attribution_delivery_receipts_values_check", sql`${table.provider} = 'x_ads' and ${table.eventName} in ('sign_up','trial_started','purchase') and ${table.outcome} in ('accepted','outcome_unknown') and ${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.expiresAt} > ${table.deliveredAt}`),
}));

/** Replay-safe commands for consent changes and conversion admission. */
export const marketingAttributionMutationReceipts = pgTable("marketing_attribution_mutation_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "marketing_attribution_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }),
  expiryIdx: index("marketing_attribution_mutation_receipts_expiry_idx").on(table.expiresAt),
  valuesCheck: check("marketing_attribution_mutation_receipts_values_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.idempotencyKey}) between 8 and 200 and ${table.expiresAt} > ${table.createdAt}`),
}));

export type WorkspaceRole = typeof workspaceRoleEnum.enumValues[number];
export type ProjectStatus = typeof projectStatusEnum.enumValues[number];
export type AssetType = typeof assetTypeEnum.enumValues[number];
export type StorageProvider = typeof storageProviderEnum.enumValues[number];
export type GenerationStatus = typeof generationStatusEnum.enumValues[number];
export type SocialPlatform = typeof socialPlatformEnum.enumValues[number];
export type SocialPostStatus = typeof socialPostStatusEnum.enumValues[number];
export type SocialEventType = typeof socialEventTypeEnum.enumValues[number];
export type SocialEventSeverity = typeof socialEventSeverityEnum.enumValues[number];
export type SocialWebhookDeliveryStatus =
  typeof socialWebhookDeliveryStatusEnum.enumValues[number];
export type SocialDispatchRunState =
  typeof socialDispatchRunStateEnum.enumValues[number];
export type SocialTokenRefreshLeaseState =
  typeof socialTokenRefreshLeaseStateEnum.enumValues[number];
export type SocialWebhookDeadLetterReplayState =
  typeof socialWebhookDeadLetterReplayStateEnum.enumValues[number];
export type AutomationTaskState = typeof automationTaskStateEnum.enumValues[number];
export type SavedPromptMode = typeof savedPromptModeEnum.enumValues[number];
