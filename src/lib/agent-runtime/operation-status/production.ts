import { getDb } from "@/lib/db";
import { OperationStatusService } from "./service";
import { PostgresOperationStatusRepository } from "./postgres-repository";
import { OperationControlRegistry } from "./controls";
import { GenerationOperationControlAdapter } from "@/lib/model-routing/operation-control";

const controls = new OperationControlRegistry().register("generation", new GenerationOperationControlAdapter(getDb));
export const PRODUCTION_OPERATION_STATUS = new OperationStatusService(new PostgresOperationStatusRepository(getDb), undefined, controls);
