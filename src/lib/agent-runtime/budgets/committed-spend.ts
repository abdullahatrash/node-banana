import { sql } from "drizzle-orm";
import { runtimeBudgetReservations } from "@/lib/db/schema";

/**
 * Canonical committed Workspace spend for a runtime budget period.
 *
 * Settled spend is always committed. Active and ambiguous reservations also
 * retain their held exposure until an authoritative settlement releases it.
 */
export function runtimeCommittedAmountSql() {
  return sql<string>`coalesce(sum(case when ${runtimeBudgetReservations.state} in ('held', 'outcome_unknown', 'held_unknown_cost') then ${runtimeBudgetReservations.settledAmount}::numeric + ${runtimeBudgetReservations.heldAmount}::numeric else ${runtimeBudgetReservations.settledAmount}::numeric end), 0)::text`;
}
