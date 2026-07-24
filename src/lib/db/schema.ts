import {
  bigint,
  boolean,
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
export const agentPrincipalStatusEnum = pgEnum("agent_principal_status", [
  "active",
  "suspended",
  "revoked",
]);

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
    sponsorIdx: index("agent_principals_sponsor_idx").on(table.sponsorUserId),
  }),
);

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
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    prefixUnique: uniqueIndex("agent_keys_prefix_unique").on(table.lookupPrefix),
    principalIdx: index("agent_keys_principal_idx").on(table.principalId),
    expiryIdx: index("agent_keys_expiry_idx").on(table.expiresAt),
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
    workspaceIdx: index("social_accounts_workspace_idx").on(table.workspaceId),
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
