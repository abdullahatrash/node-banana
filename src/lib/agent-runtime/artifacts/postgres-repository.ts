import {
  and,
  desc,
  eq,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  artifactAuditEvents,
  artifactContents,
  artifactMutationReceipts,
  artifacts,
  artifactUploads,
} from "@/lib/db/schema";
import type {
  ArtifactAuditEventRecord,
  ArtifactCommitResult,
  ArtifactContentRecord,
  ArtifactMutationReceiptRecord,
  ArtifactRecord,
  ArtifactRepository,
  ArtifactUploadRecord,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function mapArtifact(row: typeof artifacts.$inferSelect): ArtifactRecord {
  return {
    ...row,
    kind: row.kind as ArtifactRecord["kind"],
    origin: row.origin as ArtifactRecord["origin"],
    retentionMode:
      row.retentionMode as ArtifactRecord["retentionMode"],
  };
}

function mapContent(
  row: typeof artifactContents.$inferSelect,
): ArtifactContentRecord {
  return { ...row, kind: row.kind as ArtifactContentRecord["kind"] };
}

function mapUpload(
  row: typeof artifactUploads.$inferSelect,
): ArtifactUploadRecord {
  return {
    ...row,
    status: row.status as ArtifactUploadRecord["status"],
  };
}

function mutationLock(receipt: ArtifactMutationReceiptRecord): string {
  return [
    receipt.workspaceId,
    receipt.principalId,
    receipt.capability,
    receipt.idempotencyKey,
  ].join(":");
}

async function lockMutation(
  tx: Tx,
  receipt: ArtifactMutationReceiptRecord,
): Promise<ArtifactCommitResult | null> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${mutationLock(receipt)}, 0))`,
  );
  const rows = await tx
    .select()
    .from(artifactMutationReceipts)
    .where(
      and(
        eq(artifactMutationReceipts.workspaceId, receipt.workspaceId),
        eq(artifactMutationReceipts.principalId, receipt.principalId),
        eq(artifactMutationReceipts.capability, receipt.capability),
        eq(
          artifactMutationReceipts.idempotencyKey,
          receipt.idempotencyKey,
        ),
      ),
    )
    .limit(1)
    .for("update");
  const found = rows[0];
  if (!found) return null;
  return found.requestFingerprint === receipt.requestFingerprint
    ? { kind: "replayed", resourceId: found.resourceId }
    : { kind: "conflict" };
}

async function insertOrVerifyContent(
  tx: Tx,
  content: ArtifactContentRecord,
): Promise<boolean> {
  await tx
    .insert(artifactContents)
    .values(content)
    .onConflictDoNothing({
      target: [artifactContents.workspaceId, artifactContents.digest],
    });
  const rows = await tx
    .select()
    .from(artifactContents)
    .where(
      and(
        eq(artifactContents.workspaceId, content.workspaceId),
        eq(artifactContents.digest, content.digest),
      ),
    )
    .limit(1)
    .for("update");
  const found = rows[0];
  return Boolean(
    found &&
      found.kind === content.kind &&
      found.mediaType === content.mediaType &&
      found.sizeBytes === content.sizeBytes &&
      found.inlineText === content.inlineText &&
      found.storageKey === content.storageKey &&
      found.width === content.width &&
      found.height === content.height,
  );
}

export class DrizzleArtifactRepository implements ArtifactRepository {
  constructor(private readonly getDatabase: () => Db) {}

  async readMutationReceipt(
    input: Parameters<ArtifactRepository["readMutationReceipt"]>[0],
  ) {
    const rows = await this.getDatabase()
      .select()
      .from(artifactMutationReceipts)
      .where(
        and(
          eq(artifactMutationReceipts.workspaceId, input.workspaceId),
          eq(artifactMutationReceipts.principalId, input.principalId),
          eq(artifactMutationReceipts.capability, input.capability),
          eq(
            artifactMutationReceipts.idempotencyKey,
            input.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) return { kind: "absent" as const };
    return found.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, resourceId: found.resourceId }
      : { kind: "conflict" as const };
  }

  async commitTextImport(
    input: Parameters<ArtifactRepository["commitTextImport"]>[0],
  ): Promise<ArtifactCommitResult> {
    return this.getDatabase().transaction(async (tx) => {
      const replay = await lockMutation(tx, input.receipt);
      if (replay) return replay;
      if (!(await insertOrVerifyContent(tx, input.content))) {
        return { kind: "unavailable" as const };
      }
      await tx.insert(artifacts).values(input.artifact);
      await tx.insert(artifactMutationReceipts).values(input.receipt);
      await tx.insert(artifactAuditEvents).values(input.event);
      return { kind: "created" as const };
    });
  }

  async createUpload(
    input: Parameters<ArtifactRepository["createUpload"]>[0],
  ): Promise<ArtifactCommitResult> {
    return this.getDatabase().transaction(async (tx) => {
      const replay = await lockMutation(tx, input.receipt);
      if (replay) return replay;
      await tx.insert(artifactUploads).values(input.upload);
      await tx.insert(artifactMutationReceipts).values(input.receipt);
      await tx.insert(artifactAuditEvents).values(input.event);
      return { kind: "created" as const };
    });
  }

  async getUpload(
    input: Parameters<ArtifactRepository["getUpload"]>[0],
  ): Promise<ArtifactUploadRecord | null> {
    const rows = await this.getDatabase()
      .select()
      .from(artifactUploads)
      .where(
        and(
          eq(artifactUploads.workspaceId, input.workspaceId),
          eq(artifactUploads.principalId, input.principalId),
          eq(artifactUploads.id, input.uploadId),
        ),
      )
      .limit(1);
    return rows[0] ? mapUpload(rows[0]) : null;
  }

  async commitUpload(
    input: Parameters<ArtifactRepository["commitUpload"]>[0],
  ): Promise<ArtifactCommitResult> {
    return this.getDatabase().transaction(async (tx) => {
      const replay = await lockMutation(tx, input.receipt);
      if (replay) return replay;
      const uploadRows = await tx
        .select()
        .from(artifactUploads)
        .where(
          and(
            eq(artifactUploads.workspaceId, input.artifact.workspaceId),
            eq(artifactUploads.principalId, input.principalId),
            eq(artifactUploads.id, input.uploadId),
            eq(artifactUploads.status, "pending"),
          ),
        )
        .limit(1)
        .for("update");
      const upload = uploadRows[0];
      if (!upload || upload.expiresAt <= input.now) {
        return { kind: "unavailable" as const };
      }
      if (!(await insertOrVerifyContent(tx, input.content))) {
        return { kind: "unavailable" as const };
      }
      await tx.insert(artifacts).values(input.artifact);
      const updated = await tx
        .update(artifactUploads)
        .set({
          status: "completed",
          artifactId: input.artifact.id,
          completedAt: input.now,
        })
        .where(
          and(
            eq(artifactUploads.id, input.uploadId),
            eq(artifactUploads.status, "pending"),
          ),
        )
        .returning({ id: artifactUploads.id });
      if (!updated[0]) return { kind: "unavailable" as const };
      await tx.insert(artifactMutationReceipts).values(input.receipt);
      await tx.insert(artifactAuditEvents).values(input.event);
      return { kind: "created" as const };
    });
  }

  async getArtifact(
    input: Parameters<ArtifactRepository["getArtifact"]>[0],
  ) {
    const rows = await this.getDatabase()
      .select({ artifact: artifacts, content: artifactContents })
      .from(artifacts)
      .innerJoin(
        artifactContents,
        and(
          eq(artifactContents.workspaceId, artifacts.workspaceId),
          eq(artifactContents.digest, artifacts.contentDigest),
        ),
      )
      .where(
        and(
          eq(artifacts.workspaceId, input.workspaceId),
          eq(artifacts.id, input.artifactId),
          isNull(artifacts.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]
      ? {
          artifact: mapArtifact(rows[0].artifact),
          content: mapContent(rows[0].content),
        }
      : null;
  }

  async listArtifacts(
    input: Parameters<ArtifactRepository["listArtifacts"]>[0],
  ) {
    const conditions = [
      eq(artifacts.workspaceId, input.workspaceId),
      isNull(artifacts.deletedAt),
      input.filters.kind
        ? eq(artifacts.kind, input.filters.kind)
        : undefined,
      input.filters.mediaType
        ? eq(artifacts.mediaType, input.filters.mediaType)
        : undefined,
      input.filters.creatorPrincipalId
        ? eq(
            artifacts.creatorPrincipalId,
            input.filters.creatorPrincipalId,
          )
        : undefined,
      input.before
        ? or(
            lt(artifacts.createdAt, input.before.createdAt),
            and(
              eq(artifacts.createdAt, input.before.createdAt),
              lt(artifacts.id, input.before.id),
            ),
          )
        : undefined,
    ];
    const rows = await this.getDatabase()
      .select({ artifact: artifacts, content: artifactContents })
      .from(artifacts)
      .innerJoin(
        artifactContents,
        and(
          eq(artifactContents.workspaceId, artifacts.workspaceId),
          eq(artifactContents.digest, artifacts.contentDigest),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
      .limit(input.limit);
    return rows.map((row) => ({
      artifact: mapArtifact(row.artifact),
      content: mapContent(row.content),
    }));
  }

  async recordDownloadHandoff(
    event: ArtifactAuditEventRecord,
  ): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
      if (!event.artifactId) return false;
      const rows = await tx
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, event.workspaceId),
            eq(artifacts.id, event.artifactId),
            isNull(artifacts.deletedAt),
          ),
        )
        .limit(1)
        .for("share");
      if (!rows[0]) return false;
      await tx.insert(artifactAuditEvents).values(event);
      return true;
    });
  }

  async listUploadsForCleanup(
    input: Parameters<ArtifactRepository["listUploadsForCleanup"]>[0],
  ): Promise<ArtifactUploadRecord[]> {
    const rows = await this.getDatabase()
      .select()
      .from(artifactUploads)
      .where(
        and(
          isNull(artifactUploads.completedAt),
          or(
            eq(artifactUploads.status, "failed"),
            and(
              eq(artifactUploads.status, "pending"),
              lte(artifactUploads.expiresAt, input.now),
            ),
          ),
        ),
      )
      .orderBy(artifactUploads.expiresAt, artifactUploads.id)
      .limit(input.limit);
    return rows.map(mapUpload);
  }

  async markUploadFailed(
    input: Parameters<ArtifactRepository["markUploadFailed"]>[0],
  ): Promise<boolean> {
    const rows = await this.getDatabase()
      .update(artifactUploads)
      .set({ status: "failed", completedAt: null })
      .where(
        and(
          eq(artifactUploads.workspaceId, input.workspaceId),
          eq(artifactUploads.id, input.uploadId),
          or(
            eq(artifactUploads.status, "pending"),
            eq(artifactUploads.status, "failed"),
          ),
        ),
      )
      .returning({ id: artifactUploads.id });
    return Boolean(rows[0]);
  }

  async markUploadStagingCleaned(
    input: Parameters<
      ArtifactRepository["markUploadStagingCleaned"]
    >[0],
  ): Promise<boolean> {
    const rows = await this.getDatabase()
      .update(artifactUploads)
      .set({ completedAt: input.now })
      .where(
        and(
          eq(artifactUploads.workspaceId, input.workspaceId),
          eq(artifactUploads.id, input.uploadId),
          eq(artifactUploads.status, "failed"),
        ),
      )
      .returning({ id: artifactUploads.id });
    return Boolean(rows[0]);
  }
}
