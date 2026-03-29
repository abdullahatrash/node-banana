"use server";

import { headers } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { assets, workspaceMembers, workspaces } from "@/lib/db/schema";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import {
  ensurePersonalWorkspaceForUser,
  getProject,
  softDeleteProject,
  listProjectAssets,
} from "@/lib/studio/repository";
import { listProjects } from "@/lib/studio/repository";

// ── Types (serializable — no Date objects) ────────────────────────────

export interface SAWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface SAProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string | null;
  sourceDirectoryPath: string | null;
  updatedAt: string | null;
}

export interface SAProjectDetail extends SAProjectSummary {
  workflowJson: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface SAAsset {
  id: string;
  workspaceId: string;
  type: string | null;
  storageProvider: string | null;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  createdAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function requireUser() {
  const reqHeaders = await headers();
  const user = await getAuthenticatedUserFromHeaders(reqHeaders);
  if (!user) throw new Error("Not authenticated.");
  return user;
}

async function requireWorkspace(userId: string, userName: string | null, userEmail: string | null) {
  const { workspaceId } = await ensurePersonalWorkspaceForUser({
    userId,
    userName,
    userEmail,
  });
  return workspaceId;
}

function toISOStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// ── Actions ───────────────────────────────────────────────────────────

export async function fetchWorkspaces(): Promise<SAWorkspace[]> {
  if (!isDatabaseConfigured()) return [];

  const user = await requireUser();
  const db = getDb();

  let rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, user.id),
        isNull(workspaces.deletedAt),
      ),
    );

  if (rows.length === 0) {
    await ensurePersonalWorkspaceForUser({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
    });

    rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, user.id),
          isNull(workspaces.deletedAt),
        ),
      );
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
  }));
}

export async function fetchProjects(workspaceId: string): Promise<SAProjectSummary[]> {
  if (!isDatabaseConfigured()) return [];

  const user = await requireUser();
  await requireWorkspace(user.id, user.name, user.email);

  const rows = await listProjects(workspaceId);

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    sourceDirectoryPath: row.sourceDirectoryPath,
    updatedAt: toISOStringOrNull(row.updatedAt),
  }));
}

export async function fetchProjectDetail(
  workspaceId: string,
  projectId: string,
): Promise<{ project: SAProjectDetail | null; assets: SAAsset[] }> {
  if (!isDatabaseConfigured()) return { project: null, assets: [] };

  const user = await requireUser();
  await requireWorkspace(user.id, user.name, user.email);

  const [projectRow, assetRows] = await Promise.all([
    getProject(workspaceId, projectId),
    listProjectAssets(workspaceId, projectId),
  ]);

  const project: SAProjectDetail | null = projectRow
    ? {
        id: projectRow.id,
        workspaceId: projectRow.workspaceId,
        name: projectRow.name,
        slug: projectRow.slug,
        description: projectRow.description,
        status: projectRow.status,
        sourceDirectoryPath: projectRow.sourceDirectoryPath,
        workflowJson: projectRow.workflowJson as Record<string, unknown> | null,
        updatedAt: toISOStringOrNull(projectRow.updatedAt),
        createdAt: toISOStringOrNull(projectRow.createdAt),
      }
    : null;

  const projectAssets: SAAsset[] = assetRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
    updatedAt: toISOStringOrNull(row.updatedAt),
    createdAt: toISOStringOrNull(row.createdAt),
  }));

  return { project, assets: projectAssets };
}

export async function deleteProject(workspaceId: string, projectId: string): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("Database not configured.");

  const user = await requireUser();
  await requireWorkspace(user.id, user.name, user.email);

  const deleted = await softDeleteProject(workspaceId, projectId);
  if (!deleted) throw new Error("Project not found.");
}

export async function deleteAsset(assetId: string): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("Database not configured.");

  const user = await requireUser();
  const db = getDb();

  const workspaceId = await requireWorkspace(user.id, user.name, user.email);

  await db
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.workspaceId, workspaceId),
        isNull(assets.deletedAt),
      ),
    );
}
