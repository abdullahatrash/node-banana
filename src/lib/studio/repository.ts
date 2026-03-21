import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  assetTypeEnum,
  assets,
  projects,
  storageProviderEnum,
  user,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

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

    return updated ?? null;
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
