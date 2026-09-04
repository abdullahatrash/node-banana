import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { calendarRescheduleCommands } from "@/lib/db/schema";
import { CalendarRescheduleError, type CalendarRescheduleCommand, type CalendarRescheduleResult } from "./calendar-reschedule";

export class CalendarRescheduleCommandRepository {
  constructor(private readonly serviceActor: { principalId: string; keyId: string }) {}

  async begin(input: CalendarRescheduleCommand): Promise<{ kind: "started" } | { kind: "replayed"; result: CalendarRescheduleResult }> {
    const inserted = await getDb().insert(calendarRescheduleCommands).values({
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      state: "pending",
      initiatingUserId: input.initiator.userId,
      initiatingPrincipalId: input.initiator.principalId,
      initiatingKeyId: input.initiator.keyId,
      authorizationEvidenceRef: input.initiator.authorizationEvidenceRef,
      servicePrincipalId: this.serviceActor.principalId,
      serviceKeyId: this.serviceActor.keyId,
      sourceRevisionId: input.sourceRevisionId,
      sourceRevision: input.sourceRevision,
      targetId: input.targetId,
    }).onConflictDoNothing().returning({ state: calendarRescheduleCommands.state });
    if (inserted.length) return { kind: "started" };
    const [existing] = await getDb().select().from(calendarRescheduleCommands).where(and(
      eq(calendarRescheduleCommands.workspaceId, input.workspaceId),
      eq(calendarRescheduleCommands.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (!existing || existing.requestDigest !== input.requestDigest || existing.initiatingUserId !== input.initiator.userId || existing.initiatingPrincipalId !== input.initiator.principalId || existing.initiatingKeyId !== input.initiator.keyId || existing.authorizationEvidenceRef !== input.initiator.authorizationEvidenceRef) {
      throw new CalendarRescheduleError("IDEMPOTENCY_CONFLICT");
    }
    return existing.state === "completed" && existing.result
      ? { kind: "replayed", result: existing.result as unknown as CalendarRescheduleResult }
      : { kind: "started" };
  }

  async complete(input: { workspaceId: string; idempotencyKey: string; requestDigest: string; result: CalendarRescheduleResult }): Promise<void> {
    const rows = await getDb().update(calendarRescheduleCommands).set({
      state: "completed",
      result: input.result as unknown as Record<string, unknown>,
      completedAt: new Date(),
    }).where(and(
      eq(calendarRescheduleCommands.workspaceId, input.workspaceId),
      eq(calendarRescheduleCommands.idempotencyKey, input.idempotencyKey),
      eq(calendarRescheduleCommands.requestDigest, input.requestDigest),
      eq(calendarRescheduleCommands.state, "pending"),
    )).returning({ idempotencyKey: calendarRescheduleCommands.idempotencyKey });
    if (!rows.length) throw new CalendarRescheduleError("IDEMPOTENCY_CONFLICT");
  }
}
