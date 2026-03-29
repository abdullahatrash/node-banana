import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  assetTypeEnum,
  assets,
  member,
  organization,
  projects,
  type WorkspaceRole,
  workspaceSettings,
  storageProviderEnum,
  user,
  workspaceMembers,
  workspaceStorageLimits,
  workspaces,
} from "@/lib/db/schema";

type AssetUploadState = "pending" | "ready" | "failed";

export const DEFAULT_WORKSPACE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

function asMetadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getAssetUploadState(value: unknown): AssetUploadState {
  const metadata = asMetadataRecord(value);
  const uploadState = metadata.uploadState;
  if (uploadState === "ready" || uploadState === "failed") {
    return uploadState;
  }
  return "pending";
}

function canTransitionUploadState(
  currentState: AssetUploadState,
  nextState: "ready" | "failed",
): boolean {
  if (currentState === "pending") return true;
  return currentState === nextState;
}

export class StudioAssetNotFoundError extends Error {
  constructor() {
    super("Asset not found.");
    this.name = "StudioAssetNotFoundError";
  }
}

export class StudioAssetUploadTransitionError extends Error {
  currentState: AssetUploadState;
  nextState: "ready" | "failed";

  constructor(currentState: AssetUploadState, nextState: "ready" | "failed") {
    super(`Invalid upload state transition: ${currentState} -> ${nextState}`);
    this.name = "StudioAssetUploadTransitionError";
    this.currentState = currentState;
    this.nextState = nextState;
  }
}

export class StudioAssetQuotaExceededError extends Error {
  quotaBytes: number;
  projectedBytes: number;
  readyUsedBytes: number;
  pendingReservedBytes: number;

  constructor(input: {
    quotaBytes: number;
    projectedBytes: number;
    readyUsedBytes: number;
    pendingReservedBytes: number;
  }) {
    super("Workspace storage quota exceeded.");
    this.name = "StudioAssetQuotaExceededError";
    this.quotaBytes = input.quotaBytes;
    this.projectedBytes = input.projectedBytes;
    this.readyUsedBytes = input.readyUsedBytes;
    this.pendingReservedBytes = input.pendingReservedBytes;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function timestampSuffix(): string {
  return Math.floor(Date.now() / 1000).toString(36);
}

function fallbackEmailForUser(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safe || "local-user"}@local.nodebanana`;
}

function organizationIdForWorkspace(workspaceId: string): string {
  return `org_${workspaceId}`;
}

function organizationMemberId(workspaceId: string, userId: string): string {
  return `mbr_${workspaceId}_${userId}`;
}

function toOrganizationRole(role: WorkspaceRole): "owner" | "admin" | "member" {
  if (role === "owner" || role === "admin") {
    return role;
  }
  return "member";
}

export async function ensureWorkspaceOrganizationMapping(input: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  brandKit?: Record<string, unknown> | null;
}): Promise<{ organizationId: string }> {
  const db = getDb();
  const now = new Date();
  const organizationId = organizationIdForWorkspace(input.workspaceId);

  await db
    .insert(organization)
    .values({
      id: organizationId,
      name: input.workspaceName,
      slug: input.workspaceSlug,
      metadata: input.brandKit ? JSON.stringify({ brandKit: input.brandKit }) : null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: organization.id,
      set: {
        name: input.workspaceName,
        slug: input.workspaceSlug,
        metadata: input.brandKit ? JSON.stringify({ brandKit: input.brandKit }) : null,
      },
    });

  await db
    .insert(workspaceSettings)
    .values({
      workspaceId: input.workspaceId,
      organizationId,
      planTier: "free",
      brandKit: input.brandKit ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: {
        organizationId,
        brandKit: input.brandKit ?? null,
        updatedAt: now,
      },
    });

  return { organizationId };
}

export async function ensureWorkspaceOrganizationMappingByWorkspaceId(
  workspaceId: string,
): Promise<{ organizationId: string }> {
  const db = getDb();
  const [workspaceRow] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      brandKit: workspaces.brandKit,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);

  if (!workspaceRow) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  return ensureWorkspaceOrganizationMapping({
    workspaceId: workspaceRow.id,
    workspaceName: workspaceRow.name,
    workspaceSlug: workspaceRow.slug,
    brandKit: workspaceRow.brandKit ?? null,
  });
}

export async function ensureOrganizationMembership(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [settings] = await db
    .select({
      organizationId: workspaceSettings.organizationId,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, input.workspaceId))
    .limit(1);

  const organizationId =
    settings?.organizationId ||
    (await ensureWorkspaceOrganizationMappingByWorkspaceId(input.workspaceId))
      .organizationId;

  await db
    .insert(member)
    .values({
      id: organizationMemberId(input.workspaceId, input.userId),
      organizationId,
      userId: input.userId,
      role: toOrganizationRole(input.role),
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [member.organizationId, member.userId],
      set: {
        role: toOrganizationRole(input.role),
      },
    });
}

export async function ensureWorkspaceStorageLimit(
  workspaceId: string,
  quotaBytes: number = DEFAULT_WORKSPACE_QUOTA_BYTES,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(workspaceStorageLimits)
    .values({
      workspaceId,
      quotaBytes,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function ensureWorkspaceUser(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(user)
    .values({
      id: userId,
      email: fallbackEmailForUser(userId),
      name: "Local User",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: "Local Workspace",
      slug: workspaceId,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await ensureWorkspaceStorageLimit(workspaceId);
  await ensureWorkspaceOrganizationMapping({
    workspaceId,
    workspaceName: "Local Workspace",
    workspaceSlug: workspaceId,
    brandKit: null,
  });
  await ensureOrganizationMembership({
    workspaceId,
    userId,
    role: "owner",
  });
}

function buildWorkspaceName(userName: string | null | undefined, userEmail: string | null | undefined): string {
  const trimmedName = typeof userName === "string" ? userName.trim() : "";
  if (trimmedName) {
    return `${trimmedName}'s Workspace`;
  }

  const email = typeof userEmail === "string" ? userEmail.trim() : "";
  const localPart = email.split("@")[0]?.trim();
  if (localPart) {
    return `${localPart}'s Workspace`;
  }

  return "Personal Workspace";
}

export async function ensurePersonalWorkspaceForUser(input: {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
}): Promise<{ workspaceId: string; slug: string }> {
  const db = getDb();

  const [existingMembership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      name: workspaces.name,
      slug: workspaces.slug,
      brandKit: workspaces.brandKit,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, input.userId), isNull(workspaces.deletedAt)))
    .limit(1);

  if (existingMembership) {
    await ensureWorkspaceStorageLimit(existingMembership.workspaceId);
    await ensureWorkspaceOrganizationMapping({
      workspaceId: existingMembership.workspaceId,
      workspaceName: existingMembership.name,
      workspaceSlug: existingMembership.slug,
      brandKit: existingMembership.brandKit ?? null,
    });
    await ensureOrganizationMembership({
      workspaceId: existingMembership.workspaceId,
      userId: input.userId,
      role: existingMembership.role,
    });
    return {
      workspaceId: existingMembership.workspaceId,
      slug: existingMembership.slug,
    };
  }

  const baseName = buildWorkspaceName(input.userName, input.userEmail);
  const baseSlug =
    slugify(baseName) ||
    slugify(input.userEmail || "") ||
    `workspace-${input.userId.slice(0, 8)}`;

  for (let attempt = 0; attempt < 8; attempt++) {
    const slug =
      attempt === 0
        ? baseSlug
        : `${baseSlug}-${timestampSuffix()}-${attempt}`;
    const workspaceId = `ws_${randomUUID()}`;
    const now = new Date();

    const [createdWorkspace] = await db
      .insert(workspaces)
      .values({
        id: workspaceId,
        name: baseName,
        slug,
        ownerUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({
        id: workspaces.id,
        slug: workspaces.slug,
      });

    if (!createdWorkspace) {
      continue;
    }

    await db
      .insert(workspaceMembers)
      .values({
        workspaceId: createdWorkspace.id,
        userId: input.userId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: {
          role: "owner",
          updatedAt: now,
        },
      });

    await ensureWorkspaceStorageLimit(createdWorkspace.id);
    await ensureWorkspaceOrganizationMapping({
      workspaceId: createdWorkspace.id,
      workspaceName: baseName,
      workspaceSlug: createdWorkspace.slug,
      brandKit: null,
    });
    await ensureOrganizationMembership({
      workspaceId: createdWorkspace.id,
      userId: input.userId,
      role: "owner",
    });

    return {
      workspaceId: createdWorkspace.id,
      slug: createdWorkspace.slug,
    };
  }

  throw new Error("Failed to provision personal workspace for user.");
}

interface UpsertProjectInput {
  workspaceId: string;
  userId: string;
  projectId?: string;
  name: string;
  description?: string | null;
  workflowJson?: Record<string, unknown> | null;
  sourceDirectoryPath?: string | null;
}

export async function upsertProject(input: UpsertProjectInput) {
  const db = getDb();
  const now = new Date();

  await ensureWorkspaceUser(input.workspaceId, input.userId);

  const projectSlugBase = slugify(input.name) || "project";
  const resolvedProjectId = input.projectId || `proj_${randomUUID()}`;

  if (input.projectId) {
    const [updated] = await db
      .update(projects)
      .set({
        name: input.name,
        description: input.description || null,
        workflowJson: input.workflowJson || null,
        sourceDirectoryPath: input.sourceDirectoryPath || null,
        updatedAt: now,
        lastOpenedAt: now,
        deletedAt: null,
      })
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.workspaceId, input.workspaceId),
        ),
      )
      .returning();

    if (updated) {
      return updated;
    }
    // No existing row matched — fall through to INSERT with the provided ID
  }

  const candidateSlug = `${projectSlugBase}-${timestampSuffix()}`;

  const [created] = await db
    .insert(projects)
    .values({
      id: resolvedProjectId,
      workspaceId: input.workspaceId,
      name: input.name,
      slug: candidateSlug,
      description: input.description || null,
      workflowJson: input.workflowJson || null,
      sourceDirectoryPath: input.sourceDirectoryPath || null,
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    })
    .returning();

  return created;
}

export async function listProjects(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt));
}

export async function countProjects(workspaceId: string): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
  return result?.count ?? 0;
}

export async function getProject(workspaceId: string, projectId: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    );
  return project ?? null;
}

export async function softDeleteProject(workspaceId: string, projectId: string) {
  const db = getDb();
  const now = new Date();

  const [deleted] = await db
    .update(projects)
    .set({
      deletedAt: now,
      status: "archived",
      updatedAt: now,
    })
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    )
    .returning();

  return deleted ?? null;
}

interface FinalizeAssetUploadInput {
  workspaceId: string;
  assetId: string;
  uploadState: "ready" | "failed";
  sizeBytes?: number;
  checksum?: string;
  mimeType?: string;
  error?: string;
}

export async function finalizeAssetUpload(input: FinalizeAssetUploadInput) {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, input.workspaceId),
        eq(assets.id, input.assetId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new StudioAssetNotFoundError();
  }

  const currentState = getAssetUploadState(existing.metadata);
  if (!canTransitionUploadState(currentState, input.uploadState)) {
    throw new StudioAssetUploadTransitionError(currentState, input.uploadState);
  }

  const existingMetadata = asMetadataRecord(existing.metadata);
  const nextMetadata: Record<string, unknown> = {
    ...existingMetadata,
    uploadState: input.uploadState,
  };

  if (input.uploadState === "ready") {
    nextMetadata.uploadedAt =
      typeof existingMetadata.uploadedAt === "string" &&
      existingMetadata.uploadedAt.trim()
        ? existingMetadata.uploadedAt
        : now.toISOString();
    delete nextMetadata.failedAt;
    delete nextMetadata.uploadError;
  } else {
    nextMetadata.failedAt = now.toISOString();
    nextMetadata.uploadError = input.error || "Upload failed";
  }

  const [updated] = await db
    .update(assets)
    .set({
      metadata: nextMetadata,
      sizeBytes:
        typeof input.sizeBytes === "number" ? input.sizeBytes : existing.sizeBytes,
      checksum: input.checksum ?? existing.checksum,
      mimeType: input.mimeType ?? existing.mimeType,
      updatedAt: now,
    })
    .where(
      and(
        eq(assets.workspaceId, input.workspaceId),
        eq(assets.id, input.assetId),
        isNull(assets.deletedAt),
      ),
    )
    .returning();

  if (!updated) {
    throw new StudioAssetNotFoundError();
  }

  return updated;
}

function parseByteCount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

interface RecordPendingS3AssetWithQuotaInput {
  workspaceId: string;
  userId: string;
  projectId?: string | null;
  type: (typeof assetTypeEnum.enumValues)[number];
  storageBucket?: string | null;
  storageKey: string;
  mimeType?: string | null;
  originalFileName?: string | null;
  expectedSizeBytes: number;
}

export async function recordPendingS3AssetWithQuota(
  input: RecordPendingS3AssetWithQuotaInput,
) {
  const db = getDb();
  const now = new Date();
  const pendingExpiresAt = new Date(
    now.getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();

  await ensureWorkspaceUser(input.workspaceId, input.userId);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
    );

    await tx
      .insert(workspaceStorageLimits)
      .values({
        workspaceId: input.workspaceId,
        quotaBytes: DEFAULT_WORKSPACE_QUOTA_BYTES,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const [workspaceLimit] = await tx
      .select({
        quotaBytes: workspaceStorageLimits.quotaBytes,
      })
      .from(workspaceStorageLimits)
      .where(eq(workspaceStorageLimits.workspaceId, input.workspaceId))
      .limit(1);

    const quotaBytes =
      typeof workspaceLimit?.quotaBytes === "number"
        ? workspaceLimit.quotaBytes
        : DEFAULT_WORKSPACE_QUOTA_BYTES;

    const [readyUsage] = await tx
      .select({
        total: sql<string>`coalesce(sum(${assets.sizeBytes}), 0)::text`,
      })
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, input.workspaceId),
          eq(assets.storageProvider, "s3"),
          isNull(assets.deletedAt),
          sql`${assets.metadata} ->> 'uploadState' = 'ready'`,
        ),
      );

    const [pendingUsage] = await tx
      .select({
        total: sql<string>`coalesce(sum(case
          when jsonb_typeof(${assets.metadata} -> 'expectedSizeBytes') = 'number'
            then (${assets.metadata} ->> 'expectedSizeBytes')::bigint
          else 0
        end), 0)::text`,
      })
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, input.workspaceId),
          eq(assets.storageProvider, "s3"),
          isNull(assets.deletedAt),
          sql`${assets.metadata} ->> 'uploadState' = 'pending'`,
          sql`(${assets.metadata} ->> 'pendingExpiresAt')::timestamptz > now()`,
        ),
      );

    const readyUsedBytes = parseByteCount(readyUsage?.total);
    const pendingReservedBytes = parseByteCount(pendingUsage?.total);
    const projectedBytes =
      readyUsedBytes + pendingReservedBytes + input.expectedSizeBytes;

    if (projectedBytes > quotaBytes) {
      throw new StudioAssetQuotaExceededError({
        quotaBytes,
        projectedBytes,
        readyUsedBytes,
        pendingReservedBytes,
      });
    }

    const [asset] = await tx
      .insert(assets)
      .values({
        id: `asset_${randomUUID()}`,
        workspaceId: input.workspaceId,
        projectId: input.projectId || null,
        type: input.type,
        storageProvider: "s3",
        storageBucket: input.storageBucket || null,
        storageKey: input.storageKey,
        mimeType: input.mimeType || null,
        metadata: {
          uploadState: "pending",
          originalFileName: input.originalFileName || null,
          pendingExpiresAt,
          expectedSizeBytes: input.expectedSizeBytes,
        },
        createdByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [assets.storageProvider, assets.storageKey],
        set: {
          projectId: input.projectId || null,
          mimeType: input.mimeType || null,
          metadata: {
            uploadState: "pending",
            originalFileName: input.originalFileName || null,
            pendingExpiresAt,
            expectedSizeBytes: input.expectedSizeBytes,
          },
          updatedAt: now,
          deletedAt: null,
        },
      })
      .returning();

    return asset;
  });
}

interface RecordAssetInput {
  workspaceId: string;
  userId: string;
  projectId?: string | null;
  type: (typeof assetTypeEnum.enumValues)[number];
  storageProvider: (typeof storageProviderEnum.enumValues)[number];
  storageBucket?: string | null;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAsset(input: RecordAssetInput) {
  const db = getDb();
  const now = new Date();

  await ensureWorkspaceUser(input.workspaceId, input.userId);

  const [asset] = await db
    .insert(assets)
    .values({
      id: `asset_${randomUUID()}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId || null,
      type: input.type,
      storageProvider: input.storageProvider,
      storageBucket: input.storageBucket || null,
      storageKey: input.storageKey,
      mimeType: input.mimeType || null,
      sizeBytes: input.sizeBytes ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      checksum: input.checksum || null,
      metadata: input.metadata || null,
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [assets.storageProvider, assets.storageKey],
      set: {
        projectId: input.projectId || null,
        mimeType: input.mimeType || null,
        sizeBytes: input.sizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        durationSeconds: input.durationSeconds ?? null,
        checksum: input.checksum || null,
        metadata: input.metadata || null,
        updatedAt: now,
        deletedAt: null,
      },
    })
    .returning();

  return asset;
}

export async function listProjectAssets(workspaceId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(desc(assets.createdAt));
}

export async function getAsset(workspaceId: string, assetId: string) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.deletedAt),
      ),
    );

  return asset ?? null;
}

export async function softDeleteAsset(workspaceId: string, assetId: string) {
  const db = getDb();
  const now = new Date();

  const [asset] = await db
    .update(assets)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.deletedAt),
      ),
    )
    .returning();

  return asset ?? null;
}
