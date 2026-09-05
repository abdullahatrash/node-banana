"use client";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import type { GenerationReadiness } from "./readiness";
import type { FallbackAuthorization, ModelDescriptor } from "./types";
async function request<T>(path: string, init?: RequestInit): Promise<T> { const workspaceId = getActiveWorkspaceId(); if (!workspaceId) throw new Error("WORKSPACE_REQUIRED"); const response = await fetch(path, { cache: "no-store", ...init, headers: { ...init?.headers, "x-workspace-id": workspaceId } }); const body = await response.json() as { success?: boolean; code?: string } & T; if (!response.ok || !body.success) throw new Error(body.code ?? "UNAVAILABLE"); return body; }
export async function getRoutingData() { const [catalog, grants] = await Promise.all([request<{ snapshot: string; items: ModelDescriptor[]; generationReadiness: GenerationReadiness }>("/api/studio/model-routing/catalog"), request<{ items: FallbackAuthorization[] }>("/api/studio/model-routing/authorizations")]); return { catalog, grants: grants.items }; }
export async function createFallbackAuthorization(body: Record<string, unknown>) { return request("/api/studio/model-routing/authorizations", { method: "POST", headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) }); }
export async function revokeFallbackAuthorization(id: string) { return request(`/api/studio/model-routing/authorizations/${encodeURIComponent(id)}`, { method: "DELETE" }); }
