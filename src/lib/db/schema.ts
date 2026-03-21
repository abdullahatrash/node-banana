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
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    tokenUnique: uniqueIndex("session_token_unique").on(table.token),
    userIdIdx: index("session_user_id_idx").on(table.userId),
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

export type WorkspaceRole = typeof workspaceRoleEnum.enumValues[number];
export type ProjectStatus = typeof projectStatusEnum.enumValues[number];
export type AssetType = typeof assetTypeEnum.enumValues[number];
export type StorageProvider = typeof storageProviderEnum.enumValues[number];
export type GenerationStatus = typeof generationStatusEnum.enumValues[number];

