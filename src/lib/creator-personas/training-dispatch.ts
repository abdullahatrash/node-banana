import { createPresignedDownload } from "@/lib/storage";
import type { CreatorPersonaRepository } from "./repository";
import type { PersonaTrainingProviderPort, PersonaTrainingProviderState } from "./training-provider";

export interface PersonaTrainingOperationProjection {
  synchronize(input: { workspaceId: string; trainingJobId: string; state: "waiting_provider" | "outcome_unknown" | "succeeded" | "failed_known" | "cancelled"; failureCode: string | null; nextAction: string }): Promise<void>;
}

export interface PersonaTrainingExecutionAdmission {
  revalidate(claim: NonNullable<Awaited<ReturnType<CreatorPersonaRepository["claimTrainingDispatch"]>>>): Promise<{ kind: "admitted" } | { kind: "denied"; code: string }>;
  releasePreStart(input: { workspaceId: string; id: string }): Promise<void>;
  settleSubmitted(input: { workspaceId: string; id: string; quoteAmountUsd: string | null }, outcome: "succeeded" | "cost_unknown"): Promise<void>;
}

export class PersonaTrainingDispatcher {
  constructor(
    private readonly repository: CreatorPersonaRepository,
    private readonly provider: PersonaTrainingProviderPort,
    private readonly projection: PersonaTrainingOperationProjection,
    private readonly admission: PersonaTrainingExecutionAdmission,
    private readonly signSource = (storageKey: string) => createPresignedDownload({ key: storageKey, expiresInSeconds: 3_600 }),
    private readonly now = () => new Date(),
  ) {}

  async dispatchOne() {
    const at = this.now();
    await this.repository.materializeExpiredConsents({ at, limit: 100 });
    const claim = await this.repository.claimTrainingDispatch({ at, staleBefore: new Date(at.getTime() - 5 * 60_000) });
    if (!claim) return { kind: "idle" as const };
    if (claim.invalidFailureCode) {
      await this.admission.releasePreStart(claim);
      return this.finish(claim, { state: "failed_known", providerJobRef: claim.providerJobRef, failureCode: claim.invalidFailureCode });
    }
    if (claim.previousState === "queued") {
      const admission = await this.admission.revalidate(claim);
      if (admission.kind === "denied") {
        await this.admission.releasePreStart(claim);
        return this.finish(claim, { state: "failed_known", providerJobRef: null, failureCode: admission.code });
      }
    }
    try {
      let outcome: PersonaTrainingProviderState;
      if (claim.previousState === "queued") {
        let sources: Array<{ assetId: string; checksum: string; url: string }>;
        try { sources = await Promise.all(claim.sources.map(async (source) => ({ assetId: source.assetId, checksum: source.expectedChecksum, url: (await this.signSource(source.storageKey)).downloadUrl }))); }
        catch {
          await this.admission.releasePreStart(claim);
          return this.finish(claim, { state: "failed_known", providerJobRef: null, failureCode: "TRAINING_SOURCE_DELIVERY_UNAVAILABLE" });
        }
        outcome = await this.provider.submit({ idempotencyKey: claim.id, model: claim.model, modelVersion: claim.modelVersion, qualificationDigest: claim.qualificationDigest, sources });
      } else outcome = await this.provider.recover({ idempotencyKey: claim.id, providerJobRef: claim.providerJobRef });
      return this.finish(claim, outcome);
    } catch (error) {
      await this.repository.markTrainingOutcomeUnknown({ workspaceId: claim.workspaceId, trainingJobId: claim.id, failureCode: error instanceof Error ? error.message.slice(0, 100) : "PROVIDER_DISPATCH_UNKNOWN", at: this.now() });
      await this.projection.synchronize({ workspaceId: claim.workspaceId, trainingJobId: claim.id, state: "outcome_unknown", failureCode: "PROVIDER_DISPATCH_UNKNOWN", nextAction: "recover_provider_training" });
      return { kind: "outcome_unknown" as const, trainingJobId: claim.id };
    }
  }

  private async finish(claim: NonNullable<Awaited<ReturnType<CreatorPersonaRepository["claimTrainingDispatch"]>>>, outcome: PersonaTrainingProviderState) {
    if (outcome.state === "queued" || outcome.state === "running") {
      await this.repository.recordProviderTraining({ workspaceId: claim.workspaceId, trainingJobId: claim.id, providerJobRef: outcome.providerJobRef, at: this.now() });
      await this.projection.synchronize({ workspaceId: claim.workspaceId, trainingJobId: claim.id, state: "waiting_provider", failureCode: null, nextAction: "recover_provider_training" });
      return { kind: "waiting_provider" as const, trainingJobId: claim.id };
    }
    if (outcome.providerJobRef) await this.repository.recordProviderTraining({ workspaceId: claim.workspaceId, trainingJobId: claim.id, providerJobRef: outcome.providerJobRef, at: this.now() });
    if (outcome.state === "outcome_unknown") {
      await this.admission.settleSubmitted(claim, "cost_unknown");
      await this.repository.markTrainingOutcomeUnknown({ workspaceId: claim.workspaceId, trainingJobId: claim.id, failureCode: outcome.failureCode, at: this.now() });
      await this.projection.synchronize({ workspaceId: claim.workspaceId, trainingJobId: claim.id, state: outcome.state, failureCode: outcome.failureCode, nextAction: "recover_provider_training" });
      return { kind: outcome.state, trainingJobId: claim.id };
    }
    const failureCode = "failureCode" in outcome ? outcome.failureCode : null;
    await this.admission.settleSubmitted(claim, outcome.state === "succeeded" ? "succeeded" : "cost_unknown");
    const result = await this.repository.resolveTraining({ workspaceId: claim.workspaceId, userId: claim.requestedByUserId, personaId: claim.personaId, expectedRevision: claim.personaRevision, trainingJobId: claim.id, outcome: outcome.state, resultModelRef: outcome.state === "succeeded" ? outcome.model : null, failureCode, idempotencyKey: `provider-training:${claim.id}:${outcome.state}` });
    await this.projection.synchronize({ workspaceId: claim.workspaceId, trainingJobId: claim.id, state: outcome.state, failureCode, nextAction: outcome.state === "succeeded" ? "review_persona" : outcome.state === "cancelled" ? "request_training" : "inspect_persona_training" });
    return { kind: outcome.state, trainingJobId: claim.id, result };
  }
}
