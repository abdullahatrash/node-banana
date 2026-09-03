import { createHash } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { findCuratedModel } from "./catalog";
import { authorizeFallback } from "./compatibility";
import type { ModelRoutingRepository } from "./repository";
import type {
  ArabicVariety, ContentLanguage, CostQuote, ExactModelRef,
  FallbackAuthorization, GenerationCapability, GenerationIntent,
  GenerationQuality, ExecutionMode,
} from "./types";

const digest = (value: unknown) => canonicalDigest(value) as `sha256:${string}`;
const sameModel = (a: ExactModelRef, b: ExactModelRef) =>
  a.provider === b.provider && a.model === b.model && a.version === b.version &&
  a.inputSchemaDigest === b.inputSchemaDigest;
function stableId(scope: string, workspaceId: string, key: string): string {
  const hex = createHash("sha256").update(`${scope}:${workspaceId}:${key}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export class ModelRoutingService {
  constructor(
    private readonly repository: ModelRoutingRepository,
    private readonly now = () => new Date(),
  ) {}

  async issueAuthorization(input: {
    workspaceId: string; source: ExactModelRef; targets: ExactModelRef[];
    capability: GenerationCapability; minimumQuality: GenerationQuality;
    contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
    verifiedRegion: string; executionMode: ExecutionMode; maxTotalCostUsd: number;
    expiresAt: Date; userId: string; idempotencyKey: string; id?: string;
  }) {
    const at = this.now();
    const source = findCuratedModel(input.source);
    const targets = input.targets.map(findCuratedModel);
    const targetCompatible = targets.every((target) => target &&
      target.capabilities.includes(input.capability) &&
      target.contentLanguages.includes(input.contentLanguage) &&
      (!input.arabicVariety || target.arabicVarieties.includes(input.arabicVariety)) &&
      target.verifiedRegions.includes(input.verifiedRegion) &&
      target.executionModes.includes(input.executionMode));
    if (!source || !source.capabilities.includes(input.capability) ||
      targets.some((target) => !target) || !targetCompatible ||
      input.targets.some((target) => sameModel(target, input.source)) ||
      new Set(input.targets.map((target) => `${target.provider}:${target.model}:${target.version}:${target.inputSchemaDigest}`)).size !== input.targets.length ||
      input.expiresAt <= at || input.expiresAt.getTime() - at.getTime() > 30 * 24 * 60 * 60 * 1_000 ||
      input.maxTotalCostUsd <= 0 || input.maxTotalCostUsd > 100 || !input.targets.length ||
      ((input.contentLanguage === "ar" || input.contentLanguage === "mixed") && !input.arabicVariety)) {
      return { kind: "invalid" as const };
    }
    const id = input.id ?? stableId("fallback", input.workspaceId, input.idempotencyKey);
    const value: FallbackAuthorization = {
      schema: "model-fallback-authorization/v1", id, workspaceId: input.workspaceId,
      revision: 1, source: input.source, targets: input.targets, capability: input.capability,
      minimumQuality: input.minimumQuality, contentLanguage: input.contentLanguage,
      arabicVariety: input.contentLanguage === "en" ? null : input.arabicVariety,
      verifiedRegion: input.verifiedRegion, executionMode: input.executionMode,
      maxTotalCostUsd: input.maxTotalCostUsd, issuedByUserId: input.userId,
      issuedAt: at, expiresAt: input.expiresAt, revokedAt: null, revokedByUserId: null,
    };
    const requestDigest = digest({ command: "issue", ...input, idempotencyKey: undefined, id: input.id ?? null });
    const result = await this.repository.createAuthorization(value, input.idempotencyKey, requestDigest);
    const authorization = result === "replayed"
      ? await this.repository.getAuthorization(input.workspaceId, id)
      : result === "created" ? value : null;
    return { kind: result, authorization };
  }

  revokeAuthorization(workspaceId: string, id: string, userId: string) {
    return this.repository.revokeAuthorization({ workspaceId, id, userId, at: this.now() });
  }
  listAuthorizations(workspaceId: string) { return this.repository.listAuthorizations(workspaceId); }

  async createIntent(input: {
    workspaceId: string; brand: GenerationIntent["brand"]; rawPrompt: string;
    capability: GenerationCapability; contentLanguage: ContentLanguage;
    arabicVariety: ArabicVariety | null; rights: GenerationIntent["rights"];
    requestedModel: ExactModelRef; selectedModel: ExactModelRef;
    fallbackAuthorizationId: string | null; quote: CostQuote; reservationId: string;
    userId: string; idempotencyKey: string; id?: string;
  }) {
    const at = this.now();
    const requested = findCuratedModel(input.requestedModel);
    const selected = findCuratedModel(input.selectedModel);
    const localeCompatible = selected?.contentLanguages.includes(input.contentLanguage) &&
      (!input.arabicVariety || selected.arabicVarieties.includes(input.arabicVariety));
    const rightsHaveEvidence = input.rights.basis === "owned" ||
      input.rights.evidenceRefs.length > 0 || input.rights.sourceUrls.length > 0;
    if (!requested || !selected || !requested.capabilities.includes(input.capability) ||
      !selected.capabilities.includes(input.capability) || !localeCompatible ||
      !input.rawPrompt.trim() || input.brand.revision < 1 || input.brand.acceptedAt > at ||
      !/^sha256:[a-f0-9]{64}$/.test(input.brand.digest) || input.quote.expiresAt <= at ||
      input.quote.quotedAt > at || input.quote.amount < 0 || input.quote.quantity <= 0 ||
      input.quote.basis !== selected.priceUsd.basis || !input.reservationId || !rightsHaveEvidence ||
      (input.contentLanguage !== "en" && !input.arabicVariety)) {
      return { kind: "invalid" as const };
    }
    if (!sameModel(input.requestedModel, input.selectedModel)) {
      if (!input.fallbackAuthorizationId) return { kind: "fallback_not_authorized" as const };
      const grant = await this.repository.getAuthorization(input.workspaceId, input.fallbackAuthorizationId);
      if (!grant || !sameModel(grant.source, input.requestedModel)) return { kind: "fallback_not_authorized" as const };
      const compatibility = authorizeFallback({ authorization: grant, target: input.selectedModel, quote: input.quote, at });
      if (!compatibility.authorized) return { kind: "fallback_incompatible" as const, reasons: compatibility.reasons };
    } else if (input.fallbackAuthorizationId) return { kind: "invalid" as const };

    const id = input.id ?? stableId("intent", input.workspaceId, input.idempotencyKey);
    const value: GenerationIntent = {
      schema: "generation-intent/v1", id, workspaceId: input.workspaceId,
      brand: input.brand, promptDigest: digest(input.rawPrompt), capability: input.capability,
      contentLanguage: input.contentLanguage,
      arabicVariety: input.contentLanguage === "en" ? null : input.arabicVariety,
      rights: { ...input.rights, evidenceRefs: [...input.rights.evidenceRefs], sourceUrls: [...input.rights.sourceUrls] },
      requestedModel: input.requestedModel, selectedModel: input.selectedModel,
      fallbackAuthorizationId: input.fallbackAuthorizationId, quote: input.quote,
      reservationId: input.reservationId, createdByUserId: input.userId, createdAt: at,
    };
    const requestDigest = digest({ command: "intent", ...value, id: input.id ?? null, createdAt: undefined });
    const result = await this.repository.createIntent(value, input.idempotencyKey, requestDigest);
    const stored = result === "replayed"
      ? await this.repository.getIntent(input.workspaceId, id)
      : result === "created" ? value : null;
    return { kind: result, intent: stored };
  }
}
