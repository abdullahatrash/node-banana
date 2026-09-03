import type { ModelRoutingRepository } from "./repository";
import type { FallbackAuthorization, GenerationIntent } from "./types";
const clone = <T>(v: T): T => structuredClone(v);
export class MemoryModelRoutingRepository implements ModelRoutingRepository {
  private grants = new Map<string, FallbackAuthorization>(); private intents = new Map<string, GenerationIntent>(); private receipts = new Map<string, string>();
  private spend = new Map<string, { amountUsd: number; status: "held" | "released" }>();
  private key(w: string, id: string) { return `${w}:${id}`; }
  async createAuthorization(value: FallbackAuthorization, key: string, digest: string) { const r = this.receipts.get(this.key(value.workspaceId, key)); if (r) return r === digest ? "replayed" as const : "conflict" as const; this.grants.set(this.key(value.workspaceId, value.id), clone(value)); this.receipts.set(this.key(value.workspaceId, key), digest); return "created" as const; }
  async getAuthorization(w: string, id: string) { return clone(this.grants.get(this.key(w, id)) ?? null); }
  async listAuthorizations(w: string) { return [...this.grants.values()].filter((v) => v.workspaceId === w).map(clone); }
  async revokeAuthorization(input: { workspaceId: string; id: string; userId: string; at: Date }) { const key = this.key(input.workspaceId, input.id); const current = this.grants.get(key); if (!current) return "not_found" as const; if (current.revokedAt) return current.revokedByUserId === input.userId ? "replayed" as const : "conflict" as const; this.grants.set(key, { ...current, revision: current.revision + 1, revokedAt: input.at, revokedByUserId: input.userId }); return "revoked" as const; }
  async createIntent(value: GenerationIntent, key: string, digest: string) { const r = this.receipts.get(this.key(value.workspaceId, key)); if (r) return r === digest ? "replayed" as const : "conflict" as const; this.intents.set(this.key(value.workspaceId, value.id), clone(value)); this.receipts.set(this.key(value.workspaceId, key), digest); return "created" as const; }
  async getIntent(w: string, id: string) { return clone(this.intents.get(this.key(w, id)) ?? null); }
  async reserveFallbackSpend(input: { workspaceId: string; authorizationId: string; intentId: string; amountUsd: number; at: Date }) {
    const reservationKey = `${input.workspaceId}:${input.authorizationId}:${input.intentId}`;
    const existing = this.spend.get(reservationKey);
    if (existing?.status === "held") return existing.amountUsd === input.amountUsd ? "replayed" as const : "unavailable" as const;
    const grant = this.grants.get(this.key(input.workspaceId, input.authorizationId));
    if (!grant || grant.revokedAt || grant.expiresAt <= input.at) return "unavailable" as const;
    const committed = [...this.spend.entries()].filter(([key, value]) => key.startsWith(`${input.workspaceId}:${input.authorizationId}:`) && value.status === "held").reduce((sum, [, value]) => sum + value.amountUsd, 0);
    if (committed + input.amountUsd > grant.maxTotalCostUsd + Number.EPSILON) return "ceiling_exceeded" as const;
    this.spend.set(reservationKey, { amountUsd: input.amountUsd, status: "held" });
    return "reserved" as const;
  }
  async releaseFallbackSpend(input: { workspaceId: string; authorizationId: string; intentId: string; at: Date }) { const key = `${input.workspaceId}:${input.authorizationId}:${input.intentId}`; const current = this.spend.get(key); if (current) this.spend.set(key, { ...current, status: "released" }); }
}
