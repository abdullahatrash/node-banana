import { getDb } from "@/lib/db";
import { OperationStatusService } from "./service";
import { PostgresOperationStatusRepository } from "./postgres-repository";
import { OperationControlRegistry } from "./controls";
import { GenerationOperationControlAdapter } from "@/lib/model-routing/operation-control";
import { PersonaTrainingOperationControl } from "@/lib/creator-personas/operation-control";
import { PRODUCTION_GENERATION_BUDGET } from "@/lib/model-routing/production";
import { CampaignOccurrenceOperationControl } from "@/lib/product-surfaces/campaign-operation-control";

const controls = new OperationControlRegistry()
  .register("generation", new GenerationOperationControlAdapter(getDb))
  .register("campaign_automation", new CampaignOccurrenceOperationControl(getDb()))
  .register("persona_training", new PersonaTrainingOperationControl(getDb(), PRODUCTION_GENERATION_BUDGET));
export const PRODUCTION_OPERATION_STATUS = new OperationStatusService(new PostgresOperationStatusRepository(getDb), undefined, controls);
