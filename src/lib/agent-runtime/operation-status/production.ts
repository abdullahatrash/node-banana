import { getDb } from "@/lib/db";
import { OperationStatusService } from "./service";
import { PostgresOperationStatusRepository } from "./postgres-repository";

export const PRODUCTION_OPERATION_STATUS = new OperationStatusService(new PostgresOperationStatusRepository(getDb));
