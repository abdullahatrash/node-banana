import "server-only";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { PRODUCTION_GENERATION_BUDGET, PRODUCTION_GENERATION_REGIONS } from "@/lib/model-routing/production";
import { CREATOR_PERSONAS } from "./production";
import { PersonaTrainingAdmissionService } from "./training-admission";

export const PRODUCTION_PERSONA_TRAINING_ADMISSION = new PersonaTrainingAdmissionService(
  CREATOR_PERSONAS,
  PRODUCTION_GENERATION_BUDGET,
  PRODUCTION_GENERATION_REGIONS,
  PRODUCTION_OPERATION_STATUS,
);
