import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DrizzleWorkflowRevisionRepository } from "../postgres-repository";

function repositorySource(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "src/lib/agent-runtime/workflows/postgres-repository.ts",
    ),
    "utf8",
  );
}

describe("Postgres Workflow revision repository contract", () => {
  it("rejects cross-workspace or cross-resource mutations before opening a transaction", async () => {
    let databaseAccesses = 0;
    const repository = new DrizzleWorkflowRevisionRepository(() => {
      databaseAccesses += 1;
      throw new Error("database must not be reached");
    });
    const createdAt = new Date("2026-07-25T00:00:00.000Z");
    const workflow = {
      id: "wf_1",
      workspaceId: "workspace-a",
      currentRevision: 0,
      createdByPrincipalId: "principal-1",
      createdByKeyId: "key-1",
      authorizationEvidenceRef: "decision-1",
      createdAt,
      updatedAt: createdAt,
    };

    await expect(
      repository.createWorkflow({
        workflow,
        receipt: {
          workspaceId: "workspace-b",
          principalId: "principal-1",
          capability: "workflows.create@1",
          idempotencyKey: "request-1",
          requestFingerprint: `sha256:${"a".repeat(64)}`,
          resourceId: workflow.id,
          createdAt,
        },
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      repository.createWorkflow({
        workflow,
        receipt: {
          workspaceId: workflow.workspaceId,
          principalId: workflow.createdByPrincipalId,
          capability: "workflows.create@1",
          idempotencyKey: "request-2",
          requestFingerprint: `sha256:${"b".repeat(64)}`,
          resourceId: "wf_other",
          createdAt,
        },
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(databaseAccesses).toBe(0);
  });

  it("atomically creates the first workspace-scoped Workflow identity and receipt", () => {
    const source = repositorySource();
    const create = source.slice(
      source.indexOf("async createWorkflow("),
      source.indexOf("async publish("),
    );

    expect(create).toContain(".transaction(async (tx)");
    expect(create).toContain(
      "input.receipt.workspaceId !== input.workflow.workspaceId",
    );
    expect(create).toContain(
      "input.receipt.resourceId !== input.workflow.id",
    );
    expect(create).toContain("lockReceipt(tx, input.receipt)");
    expect(create).toContain("tx.insert(contentWorkflows)");
    expect(create).toContain(
      ".insert(workflowRevisionMutationReceipts)",
    );
    expect(create.indexOf("tx.insert(contentWorkflows)")).toBeLessThan(
      create.indexOf(".insert(workflowRevisionMutationReceipts)"),
    );
    expect(create).toContain('{ kind: "unavailable" as const }');
  });

  it("serializes allocation on the workspace Workflow row and advances monotonically", () => {
    const source = repositorySource();
    const publish = source.slice(
      source.indexOf("async publish("),
      source.indexOf("\n  getRevision("),
    );

    expect(publish).toContain(".transaction(async (tx)");
    expect(publish).toContain(
      "input.receipt.workspaceId !== input.revision.workspaceId",
    );
    expect(publish).toContain(
      "input.revision.definition.workflowId !== input.revision.workflowId",
    );
    expect(publish).toContain(".from(contentWorkflows)");
    expect(publish).toMatch(
      /eq\(\s*contentWorkflows\.workspaceId,\s*input\.revision\.workspaceId,\s*\)/,
    );
    expect(publish).toContain("eq(contentWorkflows.id,");
    expect(publish).toContain('.for("update")');
    expect(publish).toContain(
      "revision: workflow.currentRevision + 1",
    );
    expect(publish).toContain(
      "eq(\n                contentWorkflows.currentRevision,\n                workflow.currentRevision,",
    );
    expect(publish).toContain(
      "throw new WorkflowPersistenceUnavailable()",
    );
    expect(publish.indexOf("tx.insert(contentWorkflowRevisions)")).toBeLessThan(
      publish.indexOf(".insert(workflowRevisionMutationReceipts)"),
    );
    expect(publish).toContain(
      '{ kind: "persistence_unavailable" as const }',
    );
  });

  it("locks scoped receipts and distinguishes safe replay from conflicts", () => {
    const source = repositorySource();
    const lock = source.slice(
      source.indexOf("async function lockReceipt("),
      source.indexOf("async function findWorkflow("),
    );

    expect(lock).toContain("pg_advisory_xact_lock");
    for (const field of [
      "workspaceId",
      "principalId",
      "capability",
      "idempotencyKey",
    ]) {
      expect(lock).toContain(
        `workflowRevisionMutationReceipts.${field}`,
      );
    }
    expect(lock).toContain('.for("update")');
    expect(lock).toContain(
      "found.requestFingerprint === input.requestFingerprint",
    );
  });

  it("requires workspace, Workflow, and revision identity for exact reads", () => {
    const source = repositorySource();
    const find = source.slice(
      source.indexOf("async function findRevision("),
      source.indexOf(
        "export class DrizzleWorkflowRevisionRepository",
      ),
    );

    expect(find).toContain(
      "eq(contentWorkflowRevisions.workspaceId, input.workspaceId)",
    );
    expect(find).toContain(
      "eq(contentWorkflowRevisions.workflowId, input.workflowId)",
    );
    expect(find).toContain(
      "eq(contentWorkflowRevisions.id, input.revisionId)",
    );
  });
});
