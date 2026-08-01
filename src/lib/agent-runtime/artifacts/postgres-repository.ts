import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import {
  artifactAuditEvents,
  artifactContents,
  artifactGeneratedOrigins,
  artifactLineageInputs,
  artifactMutationReceipts,
  artifacts,
  artifactUploads,
  contentWorkflowRevisions,
  workflowRuns,
  workflowStepAttempts,
} from "@/lib/db/schema";
import type {
  ArtifactAuditEventRecord,
  ArtifactCommitResult,
  ArtifactContentRecord,
  ArtifactGeneratedOriginRecord,
  ArtifactLineageInputRecord,
  ArtifactMutationReceiptRecord,
  ArtifactRecord,
  ArtifactRepositoryResult,
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

function mapGeneratedOrigin(
  row: typeof artifactGeneratedOrigins.$inferSelect,
): ArtifactGeneratedOriginRecord {
  return { ...row };
}

function mapLineageInput(
  row: typeof artifactLineageInputs.$inferSelect,
): ArtifactLineageInputRecord {
  const source =
    row.sourceKind === "workflow_input" && row.sourceInputName
      ? {
          kind: "workflow_input" as const,
          inputName: row.sourceInputName,
        }
      : row.sourceKind === "step_output" &&
          row.sourceStepAttemptId &&
          row.sourceOutputName
        ? {
            kind: "step_output" as const,
            stepAttemptId: row.sourceStepAttemptId,
            outputName: row.sourceOutputName,
          }
        : null;
  if (!source) {
    throw new Error("Invalid Artifact lineage source.");
  }
  return {
    workspaceId: row.workspaceId,
    artifactId: row.artifactId,
    position: row.position,
    port: row.port,
    kind: row.kind as ArtifactLineageInputRecord["kind"],
    source,
    contentDigest: row.contentDigest,
    sourceArtifactId: row.sourceArtifactId,
  };
}

function lineageInsertValue(
  input: ArtifactLineageInputRecord,
  runId: string,
) {
  return {
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    position: input.position,
    port: input.port,
    kind: input.kind,
    sourceKind: input.source.kind,
    sourceInputName:
      input.source.kind === "workflow_input"
        ? input.source.inputName
        : null,
    sourceRunId:
      input.source.kind === "step_output" ? runId : null,
    sourceStepAttemptId:
      input.source.kind === "step_output"
        ? input.source.stepAttemptId
        : null,
    sourceOutputName:
      input.source.kind === "step_output"
        ? input.source.outputName
        : null,
    contentDigest: input.contentDigest,
    sourceArtifactId: input.sourceArtifactId,
  };
}

function generatedBindingDigest(input: {
  artifact: ArtifactRecord;
  content: ArtifactContentRecord;
  origin: ArtifactGeneratedOriginRecord;
  lineageInputs: ArtifactLineageInputRecord[];
}): string {
  return canonicalDigest({
    schema: "generated-artifact-binding/v1",
    artifact: {
      id: input.artifact.id,
      workspaceId: input.artifact.workspaceId,
      contentDigest: input.artifact.contentDigest,
      kind: input.artifact.kind,
      mediaType: input.artifact.mediaType,
      sizeBytes: input.artifact.sizeBytes,
      creatorPrincipalId: input.artifact.creatorPrincipalId,
      origin: input.artifact.origin,
      importedAt: input.artifact.importedAt,
      retentionMode: input.artifact.retentionMode,
      deletedAt: input.artifact.deletedAt,
    },
    content: {
      workspaceId: input.content.workspaceId,
      digest: input.content.digest,
      kind: input.content.kind,
      mediaType: input.content.mediaType,
      sizeBytes: input.content.sizeBytes,
      inlineText: input.content.inlineText,
      width: input.content.width,
      height: input.content.height,
    },
    origin: {
      workspaceId: input.origin.workspaceId,
      artifactId: input.origin.artifactId,
      workflowId: input.origin.workflowId,
      workflowRevisionId: input.origin.workflowRevisionId,
      workflowRevision: input.origin.workflowRevision,
      definitionDigest: input.origin.definitionDigest,
      runId: input.origin.runId,
      runStartSnapshotDigest:
        input.origin.runStartSnapshotDigest,
      stepAttemptId: input.origin.stepAttemptId,
      stepId: input.origin.stepId,
      attempt: input.origin.attempt,
      provider: input.origin.provider,
      operationIdentity: input.origin.operationIdentity,
      providerOperation: input.origin.providerOperation,
      providerOperationRef: input.origin.providerOperationRef,
      model: input.origin.model,
      intentDigest: input.origin.intentDigest,
      providerMetadata: input.origin.providerMetadata,
      effectKey: input.origin.effectKey,
      outputName: input.origin.outputName,
    },
    lineageInputs: [...input.lineageInputs]
      .sort((left, right) => left.position - right.position)
      .map((lineage) => ({
        workspaceId: lineage.workspaceId,
        artifactId: lineage.artifactId,
        position: lineage.position,
        port: lineage.port,
        kind: lineage.kind,
        source: lineage.source,
        contentDigest: lineage.contentDigest,
        sourceArtifactId: lineage.sourceArtifactId,
      })),
  });
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

  async commitGenerated(
    input: Parameters<ArtifactRepository["commitGenerated"]>[0],
  ) {
    return this.getDatabase().transaction(async (tx) => {
      const outputLock = JSON.stringify([
        input.origin.workspaceId,
        input.origin.effectKey,
        input.origin.outputName,
      ]);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${outputLock}, 0))`,
      );
      const existingOrigins = await tx
        .select()
        .from(artifactGeneratedOrigins)
        .where(
          and(
            eq(
              artifactGeneratedOrigins.workspaceId,
              input.origin.workspaceId,
            ),
            eq(
              artifactGeneratedOrigins.effectKey,
              input.origin.effectKey,
            ),
            eq(
              artifactGeneratedOrigins.outputName,
              input.origin.outputName,
            ),
          ),
        )
        .limit(1);
      const existingOrigin = existingOrigins[0];
      if (existingOrigin) {
        const existingRows = await tx
          .select({ artifact: artifacts, content: artifactContents })
          .from(artifacts)
          .innerJoin(
            artifactContents,
            and(
              eq(
                artifactContents.workspaceId,
                artifacts.workspaceId,
              ),
              eq(
                artifactContents.digest,
                artifacts.contentDigest,
              ),
            ),
          )
          .where(
            and(
              eq(artifacts.workspaceId, existingOrigin.workspaceId),
              eq(artifacts.id, existingOrigin.artifactId),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (!existing || existing.artifact.deletedAt) {
          return { kind: "unavailable" as const };
        }
        const lineageRows = await tx
          .select()
          .from(artifactLineageInputs)
          .where(
            and(
              eq(
                artifactLineageInputs.workspaceId,
                existingOrigin.workspaceId,
              ),
              eq(
                artifactLineageInputs.artifactId,
                existingOrigin.artifactId,
              ),
            ),
          )
          .orderBy(asc(artifactLineageInputs.position));
        let mappedLineage: ArtifactLineageInputRecord[];
        try {
          mappedLineage = lineageRows.map(mapLineageInput);
        } catch {
          return { kind: "unavailable" as const };
        }
        const existingDigest = generatedBindingDigest({
          artifact: mapArtifact(existing.artifact),
          content: mapContent(existing.content),
          origin: mapGeneratedOrigin(existingOrigin),
          lineageInputs: mappedLineage,
        });
        return existingDigest === generatedBindingDigest(input)
          ? { kind: "replayed" as const }
          : { kind: "conflict" as const };
      }

      if (
        input.artifact.workspaceId !== input.content.workspaceId ||
        input.artifact.workspaceId !== input.origin.workspaceId ||
        input.artifact.id !== input.origin.artifactId ||
        input.artifact.origin !== "generated" ||
        input.artifact.importedAt !== null ||
        input.lineageInputs.some(
          (lineage, position) =>
            lineage.workspaceId !== input.artifact.workspaceId ||
            lineage.artifactId !== input.artifact.id ||
            lineage.position !== position,
        )
      ) {
        return { kind: "conflict" as const };
      }

      const revisionRows = await tx
        .select({
          revision: contentWorkflowRevisions.revision,
          definitionDigest:
            contentWorkflowRevisions.definitionDigest,
        })
        .from(contentWorkflowRevisions)
        .where(
          and(
            eq(
              contentWorkflowRevisions.workspaceId,
              input.origin.workspaceId,
            ),
            eq(
              contentWorkflowRevisions.workflowId,
              input.origin.workflowId,
            ),
            eq(
              contentWorkflowRevisions.id,
              input.origin.workflowRevisionId,
            ),
          ),
        )
        .limit(1)
        .for("share");
      const revision = revisionRows[0];
      if (
        !revision ||
        revision.revision !== input.origin.workflowRevision ||
        revision.definitionDigest !== input.origin.definitionDigest
      ) {
        return { kind: "unavailable" as const };
      }

      const runRows = await tx
        .select({
          workflowRevisionId: workflowRuns.workflowRevisionId,
          startSnapshotDigest: workflowRuns.startSnapshotDigest,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, input.origin.workspaceId),
            eq(workflowRuns.workflowId, input.origin.workflowId),
            eq(workflowRuns.id, input.origin.runId),
          ),
        )
        .limit(1)
        .for("share");
      const run = runRows[0];
      if (
        !run ||
        run.workflowRevisionId !== input.origin.workflowRevisionId ||
        run.startSnapshotDigest !==
          input.origin.runStartSnapshotDigest
      ) {
        return { kind: "unavailable" as const };
      }

      const attemptRows = await tx
        .select()
        .from(workflowStepAttempts)
        .where(
          and(
            eq(
              workflowStepAttempts.workspaceId,
              input.origin.workspaceId,
            ),
            eq(workflowStepAttempts.runId, input.origin.runId),
            eq(
              workflowStepAttempts.id,
              input.origin.stepAttemptId,
            ),
          ),
        )
        .limit(1)
        .for("share");
      const attempt = attemptRows[0];
      if (
        !attempt ||
        attempt.stepId !== input.origin.stepId ||
        attempt.attempt !== input.origin.attempt ||
        attempt.provider !== input.origin.provider ||
        attempt.operationIdentity !==
          input.origin.operationIdentity ||
        attempt.providerOperation !==
          input.origin.providerOperation ||
        attempt.model !== input.origin.model ||
        attempt.intentDigest !== input.origin.intentDigest ||
        attempt.effectKey !== input.origin.effectKey
      ) {
        return { kind: "unavailable" as const };
      }

      for (const lineage of input.lineageInputs) {
        if (lineage.sourceArtifactId === null) {
          if (lineage.source.kind === "step_output") {
            return { kind: "unavailable" as const };
          }
          continue;
        }
        const sourceRows = await tx
          .select({
            artifact: artifacts,
            generatedOrigin: artifactGeneratedOrigins,
          })
          .from(artifacts)
          .leftJoin(
            artifactGeneratedOrigins,
            and(
              eq(
                artifactGeneratedOrigins.workspaceId,
                artifacts.workspaceId,
              ),
              eq(
                artifactGeneratedOrigins.artifactId,
                artifacts.id,
              ),
            ),
          )
          .where(
            and(
              eq(artifacts.workspaceId, input.origin.workspaceId),
              eq(artifacts.id, lineage.sourceArtifactId),
              isNull(artifacts.deletedAt),
            ),
          )
          .limit(1)
          .for("share", { of: artifacts });
        const source = sourceRows[0];
        if (
          !source ||
          source.artifact.kind !== lineage.kind ||
          source.artifact.contentDigest !== lineage.contentDigest ||
          (lineage.source.kind === "step_output" &&
            (!source.generatedOrigin ||
              source.generatedOrigin.runId !== input.origin.runId ||
              source.generatedOrigin.stepAttemptId !==
                lineage.source.stepAttemptId ||
              source.generatedOrigin.outputName !==
                lineage.source.outputName))
        ) {
          return { kind: "unavailable" as const };
        }
      }

      if (!(await insertOrVerifyContent(tx, input.content))) {
        return { kind: "unavailable" as const };
      }
      await tx.insert(artifacts).values(input.artifact);
      await tx.insert(artifactGeneratedOrigins).values(input.origin);
      if (input.lineageInputs.length > 0) {
        await tx
          .insert(artifactLineageInputs)
          .values(
            input.lineageInputs.map((lineage) =>
              lineageInsertValue(lineage, input.origin.runId),
            ),
          );
      }
      return { kind: "created" as const };
    });
  }

  async getArtifact(
    input: Parameters<ArtifactRepository["getArtifact"]>[0],
  ): Promise<ArtifactRepositoryResult | null> {
    const db = this.getDatabase();
    const rows = await db
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
    const row = rows[0];
    if (!row) return null;
    const originRows = await db
      .select()
      .from(artifactGeneratedOrigins)
      .where(
        and(
          eq(
            artifactGeneratedOrigins.workspaceId,
            input.workspaceId,
          ),
          eq(
            artifactGeneratedOrigins.artifactId,
            input.artifactId,
          ),
        ),
      )
      .limit(1);
    const lineageRows = await db
      .select()
      .from(artifactLineageInputs)
      .where(
        and(
          eq(artifactLineageInputs.workspaceId, input.workspaceId),
          eq(artifactLineageInputs.artifactId, input.artifactId),
        ),
      )
      .orderBy(asc(artifactLineageInputs.position));
    return {
      artifact: mapArtifact(row.artifact),
      content: mapContent(row.content),
      generatedOrigin: originRows[0]
        ? mapGeneratedOrigin(originRows[0])
        : null,
      lineageInputs: lineageRows.map(mapLineageInput),
    };
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
    const db = this.getDatabase();
    const rows = await db
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
    const artifactIds = rows.map((row) => row.artifact.id);
    if (artifactIds.length === 0) return [];
    const originRows = await db
      .select()
      .from(artifactGeneratedOrigins)
      .where(
        and(
          eq(
            artifactGeneratedOrigins.workspaceId,
            input.workspaceId,
          ),
          inArray(
            artifactGeneratedOrigins.artifactId,
            artifactIds,
          ),
        ),
      );
    const lineageRows = await db
      .select()
      .from(artifactLineageInputs)
      .where(
        and(
          eq(artifactLineageInputs.workspaceId, input.workspaceId),
          inArray(artifactLineageInputs.artifactId, artifactIds),
        ),
      )
      .orderBy(
        asc(artifactLineageInputs.artifactId),
        asc(artifactLineageInputs.position),
      );
    const originsByArtifact = new Map(
      originRows.map((origin) => [
        origin.artifactId,
        mapGeneratedOrigin(origin),
      ]),
    );
    const lineageByArtifact = new Map<
      string,
      ArtifactLineageInputRecord[]
    >();
    for (const lineageRow of lineageRows) {
      const lineage = mapLineageInput(lineageRow);
      const existing = lineageByArtifact.get(lineage.artifactId);
      if (existing) {
        existing.push(lineage);
      } else {
        lineageByArtifact.set(lineage.artifactId, [lineage]);
      }
    }
    return rows.map((row) => ({
      artifact: mapArtifact(row.artifact),
      content: mapContent(row.content),
      generatedOrigin:
        originsByArtifact.get(row.artifact.id) ?? null,
      lineageInputs:
        lineageByArtifact.get(row.artifact.id) ?? [],
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
