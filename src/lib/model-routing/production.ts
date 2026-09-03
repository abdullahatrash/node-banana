import { getDb } from "@/lib/db";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { ModelRoutingService } from "./service";
export const PRODUCTION_MODEL_ROUTING = new ModelRoutingService(new PostgresModelRoutingRepository(getDb));
