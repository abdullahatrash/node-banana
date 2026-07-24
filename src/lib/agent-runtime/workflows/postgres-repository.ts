import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  contentWorkflowRevisions,
  contentWorkflows,
  workflowRevisionMutationReceipts,
} from "@/lib/db/schema";
import type {
  ContentWorkflowRecord,
  ContentWorkflowRevisionRecord,
  ResolvedWorkflowDefinition,
  WorkflowRevisionMutationReceiptRecord,
  WorkflowRevisionRepository,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class WorkflowPersistenceUnavailable extends Error {}

function mutationLock(input: {
  workspaceId: string;
  principalId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return JSON.stringify([
    input.workspaceId,
    input.principalId,
    input.capability,
    input.idempotencyKey,
  ]);
}

function mapWorkflow(
  row: typeof contentWorkflows.$inferSelect,
): ContentWorkflowRecord {
  return row;
}

function mapRevision(
  row: typeof contentWorkflowRevisions.$inferSelect,
): ContentWorkflowRevisionRecord {
  return {
    ...row,
    definition: row.definition as ResolvedWorkflowDefinition,
  };
}

async function lockReceipt(
  tx: Tx,
  input: {
    workspaceId: string;
    principalId: string;
    capability: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; resourceId: string }
> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${mutationLock(input)}, 0))`,
  );
  const rows = await tx
    .select()
    .from(workflowRevisionMutationReceipts)
    .where(
      and(
        eq(
          workflowRevisionMutationReceipts.workspaceId,
          input.workspaceId,
        ),
        eq(
          workflowRevisionMutationReceipts.principalId,
          input.principalId,
        ),
        eq(
          workflowRevisionMutationReceipts.capability,
          input.capability,
        ),
        eq(
          workflowRevisionMutationReceipts.idempotencyKey,
          input.idempotencyKey,
        ),
      ),
    )
    .limit(1)
    .for("update");
  const found = rows[0];
  if (!found) return { kind: "absent" };
  return found.requestFingerprint === input.requestFingerprint
    ? { kind: "replayed", resourceId: found.resourceId }
    : { kind: "conflict" };
}

async function findWorkflow(
  database: Db | Tx,
  input: { workspaceId: string; workflowId: string },
): Promise<ContentWorkflowRecord | null> {
  const rows = await database
    .select()
    .from(contentWorkflows)
    .where(
      and(
        eq(contentWorkflows.workspaceId, input.workspaceId),
        eq(contentWorkflows.id, input.workflowId),
      ),
    )
    .limit(1);
  return rows[0] ? mapWorkflow(rows[0]) : null;
}

async function findRevision(
  database: Db | Tx,
  input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
  },
): Promise<ContentWorkflowRevisionRecord | null> {
  const rows = await database
    .select()
    .from(contentWorkflowRevisions)
    .where(
      and(
        eq(contentWorkflowRevisions.workspaceId, input.workspaceId),
        eq(contentWorkflowRevisions.workflowId, input.workflowId),
        eq(contentWorkflowRevisions.id, input.revisionId),
      ),
    )
    .limit(1);
  return rows[0] ? mapRevision(rows[0]) : null;
}

export class DrizzleWorkflowRevisionRepository
  implements WorkflowRevisionRepository
{
  constructor(private readonly getDatabase: () => Db) {}

  async readReceipt(
    input: Parameters<WorkflowRevisionRepository["readReceipt"]>[0],
  ) {
    const rows = await this.getDatabase()
      .select()
      .from(workflowRevisionMutationReceipts)
      .where(
        and(
          eq(
            workflowRevisionMutationReceipts.workspaceId,
            input.workspaceId,
          ),
          eq(
            workflowRevisionMutationReceipts.principalId,
            input.principalId,
          ),
          eq(
            workflowRevisionMutationReceipts.capability,
            input.capability,
          ),
          eq(
            workflowRevisionMutationReceipts.idempotencyKey,
            input.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) return { kind: "absent" as const };
    return found.requestFingerprint === input.requestFingerprint
      ? {
          kind: "replayed" as const,
          resourceId: found.resourceId,
        }
      : { kind: "conflict" as const };
  }

  async createWorkflow(
    input: Parameters<WorkflowRevisionRepository["createWorkflow"]>[0],
  ) {
    if (
      input.receipt.workspaceId !== input.workflow.workspaceId ||
      input.receipt.principalId !==
        input.workflow.createdByPrincipalId ||
      input.receipt.capability !== "workflows.create@1" ||
      input.receipt.resourceId !== input.workflow.id
    ) {
      return { kind: "unavailable" as const };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const receipt = await lockReceipt(tx, input.receipt);
        if (receipt.kind === "conflict") {
          return { kind: "conflict" as const };
        }
        if (receipt.kind === "replayed") {
          const workflow = await findWorkflow(tx, {
            workspaceId: input.receipt.workspaceId,
            workflowId: receipt.resourceId,
          });
          return workflow
            ? { kind: "replayed" as const, workflow }
            : { kind: "unavailable" as const };
        }
        await tx.insert(contentWorkflows).values(input.workflow);
        await tx
          .insert(workflowRevisionMutationReceipts)
          .values(input.receipt);
        return {
          kind: "created" as const,
          workflow: input.workflow,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async publish(
    input: Parameters<WorkflowRevisionRepository["publish"]>[0],
  ) {
    if (
      input.receipt.workspaceId !== input.revision.workspaceId ||
      input.receipt.principalId !== input.revision.authorPrincipalId ||
      input.receipt.capability !== "workflow_versions.create@1" ||
      input.revision.definition.workflowId !== input.revision.workflowId
    ) {
      return { kind: "unavailable" as const };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const receipt = await lockReceipt(tx, input.receipt);
        if (receipt.kind === "conflict") {
          return { kind: "conflict" as const };
        }
        if (receipt.kind === "replayed") {
          const revision = await findRevision(tx, {
            workspaceId: input.revision.workspaceId,
            workflowId: input.revision.workflowId,
            revisionId: receipt.resourceId,
          });
          return revision
            ? { kind: "replayed" as const, revision }
            : { kind: "persistence_unavailable" as const };
        }

        const workflows = await tx
          .select()
          .from(contentWorkflows)
          .where(
            and(
              eq(
                contentWorkflows.workspaceId,
                input.revision.workspaceId,
              ),
              eq(contentWorkflows.id, input.revision.workflowId),
            ),
          )
          .limit(1)
          .for("update");
        const workflow = workflows[0];
        if (!workflow) return { kind: "unavailable" as const };

        const revision: ContentWorkflowRevisionRecord = {
          ...input.revision,
          revision: workflow.currentRevision + 1,
        };
        const storedReceipt: WorkflowRevisionMutationReceiptRecord = {
          ...input.receipt,
          resourceId: revision.id,
        };
        await tx.insert(contentWorkflowRevisions).values(revision);
        const updated = await tx
          .update(contentWorkflows)
          .set({
            currentRevision: revision.revision,
            updatedAt: revision.createdAt,
          })
          .where(
            and(
              eq(
                contentWorkflows.workspaceId,
                revision.workspaceId,
              ),
              eq(contentWorkflows.id, revision.workflowId),
              eq(
                contentWorkflows.currentRevision,
                workflow.currentRevision,
              ),
            ),
          )
          .returning({ id: contentWorkflows.id });
        if (!updated[0]) throw new WorkflowPersistenceUnavailable();
        await tx
          .insert(workflowRevisionMutationReceipts)
          .values(storedReceipt);
        return { kind: "created" as const, revision };
      });
    } catch {
      return { kind: "persistence_unavailable" as const };
    }
  }

  getRevision(
    input: Parameters<WorkflowRevisionRepository["getRevision"]>[0],
  ) {
    return findRevision(this.getDatabase(), input);
  }
}
