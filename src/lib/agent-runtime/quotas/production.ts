import { getDb } from "@/lib/db";
import { DrizzleQuotaRepository } from "./postgres-repository";
import { QuotaService } from "./service";

const repository = new DrizzleQuotaRepository(getDb);
const service = new QuotaService(repository);

export function getQuotaService(): QuotaService { return service; }
export function getQuotaCommitWriter(): DrizzleQuotaRepository { return repository; }
