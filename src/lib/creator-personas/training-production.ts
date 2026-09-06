import "server-only";
import { synchronizeOperationProjections } from "@/lib/agent-runtime/operation-status/projection-sync";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { CREATOR_PERSONAS } from "./production";
import { PersonaTrainingDispatcher } from "./training-dispatch";
import { ReplicatePersonaTrainingGateway } from "./training-provider";
import { PRODUCTION_PERSONA_TRAINING_ADMISSION } from "./training-admission-production";
import { getDb } from "@/lib/db";
import { settleGenerationSpend } from "@/lib/model-routing/generation-spend";

export function createProductionPersonaTrainingDispatcher() {
  return new PersonaTrainingDispatcher(CREATOR_PERSONAS, new ReplicatePersonaTrainingGateway(), {
    async synchronize(input) {
      await synchronizeOperationProjections(PRODUCTION_OPERATION_STATUS, [{ adapterId: "creator-persona-training/v1", kind: "persona_training", workspaceId: input.workspaceId, resourceId: input.trainingJobId, state: input.state, stage: null, updatedAt: new Date(), metadata: { reasonCode: input.failureCode, nextAction: input.nextAction } }]);
    },
  }, {
    revalidate: (claim) => PRODUCTION_PERSONA_TRAINING_ADMISSION.revalidate(claim),
    releasePreStart: (claim) => PRODUCTION_PERSONA_TRAINING_ADMISSION.releasePreStart(claim),
    async settleSubmitted(claim, outcome) {
      const quote = Number(claim.quoteAmountUsd);
      if (!Number.isFinite(quote) || quote <= 0) throw new Error("PERSONA_TRAINING_QUOTE_MISSING");
      await settleGenerationSpend({ database: getDb(), workspaceId: claim.workspaceId, intentId: `persona-training:${claim.id}`, outcome: outcome === "succeeded" ? { kind: "succeeded", actualAmountUsd: quote } : { kind: "cost_unknown" }, quotedAmountUsd: quote, at: new Date() });
    },
  });
}
