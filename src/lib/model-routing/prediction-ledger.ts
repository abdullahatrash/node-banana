import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { replicatePredictionIdentities } from "./db-schema";
import type { PredictionLedgerPort } from "./replicate-contract";
type Db = ReturnType<typeof getDb>;
export class PostgresPredictionLedger implements PredictionLedgerPort {
  constructor(private readonly database: () => Db) {}
  async persist(input: Parameters<PredictionLedgerPort["persist"]>[0]) { return this.database().transaction(async (tx) => { const [current] = await tx.select().from(replicatePredictionIdentities).where(and(eq(replicatePredictionIdentities.workspaceId, input.workspaceId), eq(replicatePredictionIdentities.intentId, input.intentId))).for("update"); if (current) return current.predictionId === input.predictionId ? "replayed" as const : "conflict" as const; await tx.insert(replicatePredictionIdentities).values({ workspaceId: input.workspaceId, intentId: input.intentId, predictionId: input.predictionId, model: input.model, createdAt: input.createdAt }); return "created" as const; }); }
}
