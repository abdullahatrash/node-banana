import { createHash } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { findCuratedModel } from "./catalog";
import { authorizeFallback } from "./compatibility";
import { DENYING_GENERATION_BUDGET_AUTHORITY, type GenerationBudgetAuthority } from "./budget-authority";
import type { ModelRoutingRepository } from "./repository";
import type {
  ArabicVariety, ContentLanguage, CostQuote, ExactModelRef,
  FallbackAuthorization, GenerationCapability, GenerationIntent,
  GenerationQuality, ExecutionMode, ModelDescriptor,
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
    private readonly resolveModel: (ref: ExactModelRef) => ModelDescriptor | null = findCuratedModel,
    private readonly budgets: GenerationBudgetAuthority = DENYING_GENERATION_BUDGET_AUTHORITY,
  ) {}

  async issueAuthorization(input: {
    workspaceId: string; source: ExactModelRef; targets: ExactModelRef[];
    capability: GenerationCapability; minimumQuality: GenerationQuality;
    contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
    verifiedRegion: string; executionMode: ExecutionMode; maxTotalCostUsd: number;
    expiresAt: Date; userId: string; idempotencyKey: string; id?: string;
  }) {
    const at = this.now();
    const source = this.resolveModel(input.source);
    const targets = input.targets.map(this.resolveModel);
    const targetCompatible = targets.every((target) => target &&
      target.capabilities.includes(input.capability) &&
      target.contentLanguages.includes(input.contentLanguage) &&
      (!input.arabicVariety || target.arabicVarieties.includes(input.arabicVariety)) &&
      target.verifiedRegions.includes(input.verifiedRegion) &&
      target.executionModes.includes(input.executionMode));
    if (!source || source.qualification.status !== "qualified" || !source.capabilities.includes(input.capability) ||
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
      sourceQuote: { currency: "USD", basis: source.qualification.executionPriceUsd.basis, maxUnitAmount: source.qualification.executionPriceUsd.amount },
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
    fallbackAuthorizationId: string | null; quantity: number;
    userId: string; idempotencyKey: string; id?: string;
  }) {
    const at = this.now();
    const id = input.id ?? stableId("intent", input.workspaceId, input.idempotencyKey);
    const requested = this.resolveModel(input.requestedModel);
    const selected = this.resolveModel(input.selectedModel);
    const localeCompatible = selected?.contentLanguages.includes(input.contentLanguage) &&
      (!input.arabicVariety || selected.arabicVarieties.includes(input.arabicVariety));
    const rightsHaveEvidence = input.rights.basis === "owned" ||
      input.rights.evidenceRefs.length > 0 || input.rights.sourceUrls.length > 0;
    if (!requested || !selected || !requested.capabilities.includes(input.capability) ||
      !selected.capabilities.includes(input.capability) || !localeCompatible ||
      !input.rawPrompt.trim() || input.brand.revision < 1 || input.brand.acceptedAt > at ||
      !/^sha256:[a-f0-9]{64}$/.test(input.brand.digest) || !Number.isFinite(input.quantity) || input.quantity <= 0 ||
      !rightsHaveEvidence ||
      (input.contentLanguage !== "en" && !input.arabicVariety)) {
      return { kind: "invalid" as const };
    }
    let fallbackReservation: { authorizationId: string } | null = null;
    if (!sameModel(input.requestedModel, input.selectedModel)) {
      if (!input.fallbackAuthorizationId) return { kind: "fallback_not_authorized" as const };
      const grant = await this.repository.getAuthorization(input.workspaceId, input.fallbackAuthorizationId);
      if (!grant || !sameModel(grant.source, input.requestedModel)) return { kind: "fallback_not_authorized" as const };
      if (selected.qualification.status !== "qualified" || input.quantity > selected.qualification.maxQuantity) return { kind: "invalid" as const };
      const quote: CostQuote = { currency: "USD", amount: selected.qualification.executionPriceUsd.amount, basis: selected.qualification.executionPriceUsd.basis, quantity: input.quantity, quotedAt: at, expiresAt: new Date(at.getTime() + 5 * 60_000) };
      const compatibility = authorizeFallback({ authorization: grant, target: input.selectedModel, quote, at, resolveModel: this.resolveModel });
      if (!compatibility.authorized) return { kind: "fallback_incompatible" as const, reasons: compatibility.reasons };
      const grantReservation = await this.repository.reserveFallbackSpend({ workspaceId: input.workspaceId, authorizationId: grant.id, intentId: id, amountUsd: quote.amount * quote.quantity, at });
      if (grantReservation === "ceiling_exceeded") return { kind: "fallback_incompatible" as const, reasons: ["cost_ceiling" as const] };
      if (grantReservation === "unavailable") return { kind: "unavailable" as const };
      fallbackReservation = { authorizationId: grant.id };
    } else if (input.fallbackAuthorizationId) return { kind: "invalid" as const };

    if (selected.qualification.status !== "qualified" || input.quantity > selected.qualification.maxQuantity) return { kind: "invalid" as const };
    const quote: CostQuote = { currency: "USD", amount: selected.qualification.executionPriceUsd.amount, basis: selected.qualification.executionPriceUsd.basis, quantity: input.quantity, quotedAt: at, expiresAt: new Date(at.getTime() + 5 * 60_000) };
    const reservation = await this.budgets.reserve({ workspaceId: input.workspaceId, principalId: input.userId, intentId: id, model: input.selectedModel, quote, at });
    if (reservation.kind !== "reserved") {
      if (fallbackReservation) await this.repository.releaseFallbackSpend({ workspaceId: input.workspaceId, authorizationId: fallbackReservation.authorizationId, intentId: id, at });
      return reservation.kind === "denied" ? { kind: "budget_denied" as const, code: reservation.code } : { kind: "budget_unavailable" as const, code: reservation.code };
    }
    const value: GenerationIntent = {
      schema: "generation-intent/v1", id, workspaceId: input.workspaceId,
      brand: input.brand, promptDigest: digest(input.rawPrompt), capability: input.capability,
      contentLanguage: input.contentLanguage,
      arabicVariety: input.contentLanguage === "en" ? null : input.arabicVariety,
      rights: { ...input.rights, evidenceRefs: [...input.rights.evidenceRefs], sourceUrls: [...input.rights.sourceUrls] },
      requestedModel: input.requestedModel, selectedModel: input.selectedModel,
      fallbackAuthorizationId: input.fallbackAuthorizationId, quote,
      reservationIds: reservation.reservationIds, createdByUserId: input.userId, createdAt: at,
    };
    const requestDigest = digest({ command: "intent", ...value, id: input.id ?? null, createdAt: undefined });
    const result = await this.repository.createIntent(value, input.idempotencyKey, requestDigest);
    if (result === "conflict" && fallbackReservation) await this.repository.releaseFallbackSpend({ workspaceId: input.workspaceId, authorizationId: fallbackReservation.authorizationId, intentId: id, at });
    const stored = result === "replayed"
      ? await this.repository.getIntent(input.workspaceId, id)
      : result === "created" ? value : null;
    return { kind: result, intent: stored };
  }
}
