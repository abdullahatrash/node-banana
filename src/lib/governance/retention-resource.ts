import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { assets, savedPrompts, socialPosts } from "@/lib/db/schema";
import type { RetentionClass } from "./types";

export interface GovernanceRetentionResourceDescriptor {
  resourceKind: "media" | "prompt" | "social_post";
  resourceId: string;
  retentionClass: RetentionClass;
  createdAt: Date;
  authoritativeSystems: string[];
}

export interface GovernanceRetentionResourcePort {
  resolve(input: { workspaceId: string; resourceKind: string; resourceId: string }): Promise<GovernanceRetentionResourceDescriptor | null>;
}

export const UNCONFIGURED_GOVERNANCE_RETENTION_RESOURCE_PORT: GovernanceRetentionResourcePort = {
  resolve: async () => null,
};

function authoritativeSystems(): string[] {
  const configured = (process.env.GOVERNANCE_DELETION_SYSTEMS ?? "primary")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ["primary", "backup", "logging"].includes(value));
  return [...new Set(["primary", ...configured])].sort();
}

/** Resolves retention identity only from exact Workspace-owned canonical rows. */
export class DrizzleGovernanceRetentionResourcePort implements GovernanceRetentionResourcePort {
  constructor(private readonly database: () => ReturnType<typeof getDb>) {}

  async resolve(input: { workspaceId: string; resourceKind: string; resourceId: string }): Promise<GovernanceRetentionResourceDescriptor | null> {
    const db = this.database();
    if (input.resourceKind === "media" || input.resourceKind === "asset") {
      const [row] = await db.select({ id: assets.id, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.resourceId), isNull(assets.deletedAt))).limit(1);
      return row ? { resourceKind: "media", resourceId: row.id, retentionClass: "workspace_media", createdAt: row.createdAt, authoritativeSystems: authoritativeSystems() } : null;
    }
    if (input.resourceKind === "prompt") {
      const [row] = await db.select({ id: savedPrompts.id, createdAt: savedPrompts.createdAt }).from(savedPrompts).where(and(eq(savedPrompts.workspaceId, input.workspaceId), eq(savedPrompts.id, input.resourceId), isNull(savedPrompts.deletedAt))).limit(1);
      return row ? { resourceKind: "prompt", resourceId: row.id, retentionClass: "recoverable_draft", createdAt: row.createdAt, authoritativeSystems: authoritativeSystems() } : null;
    }
    if (input.resourceKind === "social_post" || input.resourceKind === "calendar_plan") {
      const [row] = await db.select({ id: socialPosts.id, createdAt: socialPosts.createdAt, publishedAt: socialPosts.publishedAt }).from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.resourceId))).limit(1);
      return row ? { resourceKind: "social_post", resourceId: row.id, retentionClass: row.publishedAt ? "published_lineage" : "recoverable_draft", createdAt: row.createdAt, authoritativeSystems: authoritativeSystems() } : null;
    }
    return null;
  }
}
