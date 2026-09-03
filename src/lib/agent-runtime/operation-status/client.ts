"use client";

import { getActiveWorkspaceId } from "@/lib/studio/client";
import type { OperationEvent, OperationRecord, OperationState } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new Error("WORKSPACE_REQUIRED");
  const response = await fetch(path, { cache: "no-store", ...init, headers: { ...init?.headers, "x-workspace-id": workspaceId } });
  const value = await response.json() as { success?: boolean; code?: string } & T;
  if (!response.ok || !value.success) throw new Error(value.code ?? "UNAVAILABLE");
  return value;
}
export async function listOperations(state?: OperationState) { return (await call<{ items: OperationRecord[] }>(`/api/studio/operations${state ? `?state=${state}` : ""}`)).items; }
export async function inspectOperation(id: string) { return call<{ operation: OperationRecord; events: OperationEvent[] }>(`/api/studio/operations/${encodeURIComponent(id)}`); }
export async function mutateOperation(id: string, body: { action: "cancel"; expectedRevision: number } | { action: "retry" }) { return call(`/api/studio/operations/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) }); }
