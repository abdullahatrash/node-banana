import { createHash, randomUUID } from "node:crypto";
import { authorizeFallback } from "./compatibility";
import type { ModelRoutingRepository } from "./repository";
import type { ArabicVariety, ContentLanguage, CostQuote, ExactModelRef, FallbackAuthorization, GenerationCapability, GenerationIntent, GenerationQuality, ExecutionMode } from "./types";

const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}` as const;
const sameModel = (a: ExactModelRef, b: ExactModelRef) => a.provider === b.provider && a.model === b.model && a.version === b.version && a.inputSchemaDigest === b.inputSchemaDigest;

export class ModelRoutingService {
  constructor(private readonly repository: ModelRoutingRepository, private readonly now = () => new Date()) {}
  async issueAuthorization(input: { workspaceId: string; source: ExactModelRef; targets: ExactModelRef[]; capability: GenerationCapability; minimumQuality: GenerationQuality; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null; verifiedRegion: string; executionMode: ExecutionMode; maxTotalCostUsd: number; expiresAt: Date; userId: string; idempotencyKey: string; id?: string }) {
    const at = this.now();
    if (input.expiresAt <= at || input.expiresAt.getTime() - at.getTime() > 30 * 24 * 60 * 60 * 1000 || input.maxTotalCostUsd <= 0 || input.maxTotalCostUsd > 100 || !input.targets.length) return { kind: "invalid" as const };
    const value: FallbackAuthorization = { schema: "model-fallback-authorization/v1", id: input.id ?? randomUUID(), workspaceId: input.workspaceId, revision: 1, source: input.source, targets: input.targets, capability: input.capability, minimumQuality: input.minimumQuality, contentLanguage: input.contentLanguage, arabicVariety: input.contentLanguage === "ar" || input.contentLanguage === "mixed" ? input.arabicVariety : null, verifiedRegion: input.verifiedRegion, executionMode: input.executionMode, maxTotalCostUsd: input.maxTotalCostUsd, issuedByUserId: input.userId, issuedAt: at, expiresAt: input.expiresAt, revokedAt: null, revokedByUserId: null };
    const result = await this.repository.createAuthorization(value, input.idempotencyKey, hash({ command: "issue", ...input, idempotencyKey: undefined, id: input.id ?? null }));
    return { kind: result, authorization: result === "created" || result === "replayed" ? value : null };
  }
  revokeAuthorization(workspaceId: string, id: string, userId: string) { return this.repository.revokeAuthorization({ workspaceId, id, userId, at: this.now() }); }
  listAuthorizations(workspaceId: string) { return this.repository.listAuthorizations(workspaceId); }

  async createIntent(input: { workspaceId: string; brand: GenerationIntent["brand"]; rawPrompt: string; capability: GenerationCapability; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null; rights: GenerationIntent["rights"]; requestedModel: ExactModelRef; selectedModel: ExactModelRef; fallbackAuthorizationId: string | null; quote: CostQuote; reservationId: string; userId: string; idempotencyKey: string; id?: string }) {
    const at = this.now();
    if (!input.rawPrompt.trim() || input.brand.revision < 1 || input.brand.acceptedAt > at || !/^sha256:[a-f0-9]{64}$/.test(input.brand.digest) || input.quote.expiresAt <= at || input.quote.quotedAt > at || input.quote.amount < 0 || input.quote.quantity <= 0 || !input.reservationId || (input.contentLanguage !== "en" && !input.arabicVariety)) return { kind: "invalid" as const };
    if (!sameModel(input.requestedModel, input.selectedModel)) {
      if (!input.fallbackAuthorizationId) return { kind: "fallback_not_authorized" as const };
      const grant = await this.repository.getAuthorization(input.workspaceId, input.fallbackAuthorizationId);
      if (!grant || !sameModel(grant.source, input.requestedModel)) return { kind: "fallback_not_authorized" as const };
      const compatibility = authorizeFallback({ authorization: grant, target: input.selectedModel, quote: input.quote, at });
      if (!compatibility.authorized) return { kind: "fallback_incompatible" as const, reasons: compatibility.reasons };
    } else if (input.fallbackAuthorizationId) return { kind: "invalid" as const };
    const value: GenerationIntent = { schema: "generation-intent/v1", id: input.id ?? randomUUID(), workspaceId: input.workspaceId, brand: input.brand, promptDigest: hash(input.rawPrompt), capability: input.capability, contentLanguage: input.contentLanguage, arabicVariety: input.contentLanguage === "en" ? null : input.arabicVariety, rights: { ...input.rights, evidenceRefs: [...input.rights.evidenceRefs], sourceUrls: [...input.rights.sourceUrls] }, requestedModel: input.requestedModel, selectedModel: input.selectedModel, fallbackAuthorizationId: input.fallbackAuthorizationId, quote: input.quote, reservationId: input.reservationId, createdByUserId: input.userId, createdAt: at };
    const result = await this.repository.createIntent(value, input.idempotencyKey, hash({ command: "intent", ...value, id: input.id ?? null }));
    return { kind: result, intent: result === "created" || result === "replayed" ? value : null };
  }
}
