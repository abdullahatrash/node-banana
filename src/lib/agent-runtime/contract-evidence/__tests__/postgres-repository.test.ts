import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it, vi } from "vitest";
import {
  appendContractEvidenceVersion,
  getLatestContractEvidenceVersion,
} from "../postgres-repository";

function fakeTransaction() {
  const rows: Array<Record<string, unknown>> = [];
  const tx = {
    execute: vi.fn(async () => []),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows.length
              ? [{ version: rows.at(-1)!.version }]
              : [],
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          rows.push(structuredClone(value));
          return [value];
        },
      }),
    }),
  };
  return { tx, rows };
}

function runProjection(state: string, updatedAt = "2026-08-01T00:00:00.000Z") {
  return {
    schema: "support-run-summary/v1",
    id: "run_1",
    workflowId: "workflow_1",
    workflowRevisionId: "workflow_revision_1",
    state,
    startSnapshotDigest: `sha256:${"a".repeat(64)}`,
    finalSnapshotDigest: null,
    sourceRunId: null,
    rootRunId: "run_1",
    derivationDepth: 0,
    resumeAt: null,
    failureCode: null,
    acceptedAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    updatedAt,
  };
}

function runSource(state: string, updatedAt = "2026-08-01T00:00:00.000Z") {
  return {
    id: "run_1",
    workspaceId: "workspace_1",
    workflowId: "workflow_1",
    workflowRevisionId: "workflow_revision_1",
    state,
    startSnapshotDigest: `sha256:${"a".repeat(64)}`,
    finalSnapshotDigest: null,
    sourceRunId: null,
    rootRunId: "run_1",
    derivationDepth: 0,
    derivation: null,
    resumeAt: null,
    failureCode: null,
    acceptedAt: new Date("2026-08-01T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date(updatedAt),
  };
}

describe("appendContractEvidenceVersion", () => {
  it("freezes stable v1/v2 evidence for the same mutable resource", async () => {
    const { tx, rows } = fakeTransaction();
    const first = await appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "run_summary",
      projection: runProjection("accepted"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const frozenFirst = structuredClone(rows[0]);
    const second = await appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("running", "2026-08-01T00:00:01.000Z"),
      projectionKind: "run_summary",
      projection: runProjection("running", "2026-08-01T00:00:01.000Z"),
      createdAt: new Date("2026-08-01T00:00:01.000Z"),
    });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(second.canonicalDigest).not.toBe(first.canonicalDigest);
    expect(rows[0]).toEqual(frozenFirst);
    expect(first.projectionDigest).toBe(canonicalDigest(first.projection));
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched kinds and sensitive projection keys before persistence", async () => {
    const { tx, rows } = fakeTransaction();
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "budget_summary",
      projection: { schema: "support-budget-summary/v1" },
      createdAt: new Date(),
    })).rejects.toThrow("does not match");
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "run_summary",
      projection: { ...runProjection("accepted"), providerBody: "canary" },
      createdAt: new Date(),
    })).rejects.toThrow("closed projection");
    expect(rows).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-resource and cross-Workspace evidence before persistence", async () => {
    const { tx, rows } = fakeTransaction();
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: { ...runSource("accepted"), workspaceId: "workspace_2" },
      projectionKind: "run_summary",
      projection: runProjection("accepted"),
      createdAt: new Date(),
    })).rejects.toThrow("canonical identity");
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "run_summary",
      projection: { ...runProjection("accepted"), id: "run_2" },
      createdAt: new Date(),
    })).rejects.toThrow("projection identity");
    expect(rows).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("fails closed when a stored projection no longer matches its digest", async () => {
    const projection: Record<string, unknown> = runProjection("completed");
    const row = {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      version: 2,
      canonicalDigest: `sha256:${"a".repeat(64)}`,
      projectionKind: "run_summary",
      projection,
      projectionDigest: canonicalDigest(projection),
      createdAt: new Date(),
    };
    const db = {
      select: () => ({ from: () => ({ where: () => ({
        orderBy: () => ({ limit: async () => [row] }),
      }) }) }),
    };
    await expect(getLatestContractEvidenceVersion(db as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      projectionKind: "run_summary",
    })).resolves.toMatchObject({ version: 2, projection });

    row.projection = { ...projection, note: "SECRET_UNDER_SAFE_NAME" };
    row.projectionDigest = canonicalDigest(row.projection);
    await expect(getLatestContractEvidenceVersion(db as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      projectionKind: "run_summary",
    })).resolves.toBeNull();

    row.projection = projection;
    row.projectionDigest = `sha256:${"b".repeat(64)}`;
    await expect(getLatestContractEvidenceVersion(db as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      projectionKind: "run_summary",
    })).resolves.toBeNull();
  });

  it("rejects arbitrary values hidden under extra projection keys", async () => {
    const { tx, rows } = fakeTransaction();
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "run_summary",
      projection: { ...runProjection("accepted"), note: "SECRET_UNDER_SAFE_NAME" },
      createdAt: new Date(),
    })).rejects.toThrow("closed projection");
    expect(rows).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("rejects a closed projection that disagrees with its canonical source", async () => {
    const { tx, rows } = fakeTransaction();
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("completed"),
      projectionKind: "run_summary",
      projection: runProjection("accepted"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    })).rejects.toThrow("does not match its canonical source");
    expect(rows).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("rejects an evidence timestamp detached from the canonical mutation", async () => {
    const { tx, rows } = fakeTransaction();
    await expect(appendContractEvidenceVersion(tx as never, {
      workspaceId: "workspace_1",
      resourceKind: "run",
      resourceId: "run_1",
      canonicalSource: runSource("accepted"),
      projectionKind: "run_summary",
      projection: runProjection("accepted"),
      createdAt: new Date("2026-08-01T00:00:01.000Z"),
    })).rejects.toThrow("timestamp does not match");
    expect(rows).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});
