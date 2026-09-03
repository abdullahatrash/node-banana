import type { FallbackAuthorization, GenerationIntent } from "./types";
export interface ModelRoutingRepository {
  createAuthorization(value: FallbackAuthorization, idempotencyKey: string, digest: string): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  getAuthorization(workspaceId: string, id: string): Promise<FallbackAuthorization | null>;
  listAuthorizations(workspaceId: string): Promise<FallbackAuthorization[]>;
  revokeAuthorization(input: { workspaceId: string; id: string; userId: string; at: Date }): Promise<"revoked" | "replayed" | "not_found" | "conflict">;
  createIntent(value: GenerationIntent, idempotencyKey: string, digest: string): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  getIntent(workspaceId: string, id: string): Promise<GenerationIntent | null>;
  reserveFallbackSpend(input: { workspaceId: string; authorizationId: string; intentId: string; amountUsd: number; at: Date }): Promise<"reserved" | "replayed" | "ceiling_exceeded" | "unavailable">;
  releaseFallbackSpend(input: { workspaceId: string; authorizationId: string; intentId: string; at: Date }): Promise<void>;
}
