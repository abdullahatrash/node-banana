import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectWorkflowRuns as workflowRuns } from "@/lib/db/schema";
import { ensureWorkspaceUser } from "@/lib/studio/repository";

import type { RunOutput, RunProgress } from "./types";

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;

interface CreateWorkflowRunInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  inputOverrides?: Record<string, unknown> | null;
  progress?: RunProgress | null;
}

/** Insert a fresh run in the `queued` state and return the row. */
export async function createWorkflowRun(
  input: CreateWorkflowRunInput,
): Promise<WorkflowRunRow> {
  const db = getDb();
  const now = new Date();
  // Auto-provision the (possibly pseudo `apitoken:ws`) user so the
  // created_by_user_id FK is satisfied — same pattern recordAsset uses.
  await ensureWorkspaceUser(input.workspaceId, input.userId);
  const [row] = await db
    .insert(workflowRuns)
    .values({
      id: `run_${randomUUID()}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      status: "queued",
      progress: (input.progress ?? null) as Record<string, unknown> | null,
      outputs: null,
      inputOverrides: input.inputOverrides ?? null,
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** Fetch a run scoped to its workspace (tenant isolation). */
export async function getWorkflowRun(
  workspaceId: string,
  runId: string,
): Promise<WorkflowRunRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.workspaceId, workspaceId), eq(workflowRuns.id, runId)),
    )
    .limit(1);
  return row ?? null;
}

/** Transition a run to `running` and stamp `startedAt`. */
export async function markWorkflowRunRunning(
  runId: string,
  progress: RunProgress,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(workflowRuns)
    .set({ status: "running", progress: progress as unknown as Record<string, unknown>, startedAt: now, updatedAt: now })
    .where(eq(workflowRuns.id, runId));
}

/** Persist an in-flight per-node progress snapshot. */
export async function updateWorkflowRunProgress(
  runId: string,
  progress: RunProgress,
): Promise<void> {
  const db = getDb();
  await db
    .update(workflowRuns)
    .set({ progress: progress as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

interface CompleteWorkflowRunInput {
  status: "succeeded" | "failed";
  progress: RunProgress;
  outputs: RunOutput[];
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Terminal transition: write final status, outputs, error, and `finishedAt`. */
export async function completeWorkflowRun(
  runId: string,
  input: CompleteWorkflowRunInput,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(workflowRuns)
    .set({
      status: input.status,
      progress: input.progress as unknown as Record<string, unknown>,
      outputs: input.outputs as unknown as Record<string, unknown>[],
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowRuns.id, runId));
}
