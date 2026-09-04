import "server-only";
import { synchronizeOperationProjections } from "@/lib/agent-runtime/operation-status/projection-sync";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { CREATOR_PERSONAS } from "./production";
import { PersonaTrainingDispatcher } from "./training-dispatch";
import { ReplicatePersonaTrainingGateway } from "./training-provider";

export function createProductionPersonaTrainingDispatcher() {
  return new PersonaTrainingDispatcher(CREATOR_PERSONAS, new ReplicatePersonaTrainingGateway(), {
    async synchronize(input) {
      await synchronizeOperationProjections(PRODUCTION_OPERATION_STATUS, [{ adapterId: "creator-persona-training/v1", kind: "persona_training", workspaceId: input.workspaceId, resourceId: input.trainingJobId, state: input.state, stage: null, updatedAt: new Date(), metadata: { reasonCode: input.failureCode, nextAction: input.nextAction } }]);
    },
  });
}
