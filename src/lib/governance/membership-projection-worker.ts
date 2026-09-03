import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { member, workspaceSettings } from "@/lib/db/schema";
import type {
  GovernanceAuditEvent,
  GovernanceRepository,
  GovernanceResource,
} from "./types";

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
const PROJECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

type ProjectionOperation =
  | { operation: "upsert" | "update_role"; userId: string; role: "admin" | "member" }
  | { operation: "remove"; userId: string }
  | { operation: "transfer_ownership"; currentOwnerUserId: string; newOwnerUserId: string }
  | { operation: "close_workspace" };

interface ProjectionBody {
  operation: ProjectionOperation["operation"];
  requestedAt: string;
  attempts: number;
  lease?: { id: string; claimedAt: string; expiresAt: string } | null;
  nextAttemptAt?: string | null;
  lastErrorCode?: string | null;
  completedAt?: string | null;
  userId?: string;
  role?: "admin" | "member";
  currentOwnerUserId?: string;
  newOwnerUserId?: string;
  [key: string]: unknown;
}

function validProjectionId(value: unknown): value is string {
  return typeof value === "string" && PROJECTION_ID.test(value);
}

export class GovernanceMembershipProjectionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "GovernanceMembershipProjectionError";
  }
}

export interface GovernanceMembershipProjectionPort {
  apply(input: { workspaceId: string; operation: ProjectionOperation }): Promise<void>;
}

function safeOperation(body: ProjectionBody): ProjectionOperation {
  if (body.operation === "upsert" || body.operation === "update_role") {
    if (!validProjectionId(body.userId) || (body.role !== "admin" && body.role !== "member")) {
      throw new GovernanceMembershipProjectionError("INVALID_PROJECTION_PAYLOAD", false);
    }
    return { operation: body.operation, userId: body.userId, role: body.role };
  }
  if (body.operation === "remove") {
    if (!validProjectionId(body.userId)) throw new GovernanceMembershipProjectionError("INVALID_PROJECTION_PAYLOAD", false);
    return { operation: "remove", userId: body.userId };
  }
  if (body.operation === "transfer_ownership") {
    if (!validProjectionId(body.currentOwnerUserId) || !validProjectionId(body.newOwnerUserId)) {
      throw new GovernanceMembershipProjectionError("INVALID_PROJECTION_PAYLOAD", false);
    }
    return { operation: "transfer_ownership", currentOwnerUserId: body.currentOwnerUserId, newOwnerUserId: body.newOwnerUserId };
  }
  if (body.operation === "close_workspace") return { operation: "close_workspace" };
  throw new GovernanceMembershipProjectionError("INVALID_PROJECTION_PAYLOAD", false);
}

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return {
    schema: "workspace-audit-event/v1",
    id: `audit_${randomUUID().replaceAll("-", "")}`,
    workspaceId: job.workspaceId,
    actor: { kind: "system", id: null },
    capability: "members.projection.process@1",
    action,
    resource: { kind: "membership_projection", id: job.id },
    outcome,
    redactedDetails: {},
    occurredAt: now,
  };
}

export class GovernanceMembershipProjectionWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly projection: GovernanceMembershipProjectionPort,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async sweep(input: { limit: number }): Promise<{ scanned: number; succeeded: number; retryPending: number; deadLetter: number }> {
    const jobs = await this.repository.listClaimableMembershipProjections({
      evaluatedAt: this.clock.now(),
      limit: input.limit,
    });
    const summary = { scanned: jobs.length, succeeded: 0, retryPending: 0, deadLetter: 0 };
    for (const job of jobs) {
      const result = await this.process(job);
      if (result === "succeeded") summary.succeeded += 1;
      else if (result === "retry_pending") summary.retryPending += 1;
      else if (result === "dead_letter") summary.deadLetter += 1;
    }
    return summary;
  }

  private async process(job: GovernanceResource): Promise<"succeeded" | "retry_pending" | "dead_letter" | "not_claimed"> {
    const claimed = await this.claim(job);
    if (!claimed) return "not_claimed";
    const body = claimed.body as ProjectionBody;
    try {
      const operation = safeOperation(body);
      await this.projection.apply({ workspaceId: claimed.workspaceId, operation });
      await this.transition(claimed, "succeeded", {
        ...body,
        lease: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        completedAt: this.clock.now().toISOString(),
      }, "complete_membership_projection", "completed");
      return "succeeded";
    } catch (error) {
      const known = error instanceof GovernanceMembershipProjectionError
        ? error
        : new GovernanceMembershipProjectionError("BETTER_AUTH_PROJECTION_UNAVAILABLE", true);
      const exhausted = !known.retryable || body.attempts >= MAX_ATTEMPTS;
      const status = exhausted ? "dead_letter" : "retry_pending";
      const delayMs = Math.min(60 * 60_000, 60_000 * (2 ** Math.max(0, body.attempts - 1)));
      await this.transition(claimed, status, {
        ...body,
        lease: null,
        nextAttemptAt: exhausted ? null : new Date(this.clock.now().getTime() + delayMs).toISOString(),
        lastErrorCode: known.code,
        completedAt: exhausted ? this.clock.now().toISOString() : null,
      }, exhausted ? "dead_letter_membership_projection" : "retry_membership_projection", "failed");
      return status;
    }
  }

  private async claim(job: GovernanceResource): Promise<GovernanceResource | null> {
    const now = this.clock.now();
    const body = job.body as ProjectionBody;
    if (job.status === "retry_pending" && (!body.nextAttemptAt || new Date(body.nextAttemptAt) > now)) return null;
    if (job.status === "processing" && (!body.lease?.expiresAt || new Date(body.lease.expiresAt) > now)) return null;
    if (!["queued", "retry_pending", "processing"].includes(job.status)) return null;
    const lease = {
      id: `lease_${randomUUID().replaceAll("-", "")}`,
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
    };
    const next: GovernanceResource = {
      ...job,
      version: job.version + 1,
      status: "processing",
      body: { ...body, attempts: (body.attempts ?? 0) + 1, lease, nextAttemptAt: null },
      updatedAt: now,
    };
    const result = await this.repository.commit({
      receipt: {
        workspaceId: job.workspaceId,
        capability: "members.projection.claim@1",
        idempotencyKey: `membership-projection-claim-${job.id}-${job.version}-${lease.id}`,
        requestDigest: canonicalDigest({ id: job.id, version: job.version, lease }),
        result: { projectionId: job.id, leaseId: lease.id },
        createdAt: now,
      },
      mutations: [{ type: "update", expectedVersion: job.version, resource: next }],
      audit: audit(job, "claim_membership_projection", "accepted", now),
    });
    return result.type === "committed" ? next : null;
  }

  private async transition(
    job: GovernanceResource,
    status: string,
    body: ProjectionBody,
    action: string,
    outcome: GovernanceAuditEvent["outcome"],
  ): Promise<void> {
    const now = this.clock.now();
    const next: GovernanceResource = { ...job, version: job.version + 1, status, body, updatedAt: now };
    const result = await this.repository.commit({
      receipt: {
        workspaceId: job.workspaceId,
        capability: "members.projection.process@1",
        idempotencyKey: `${action}-${job.id}-${job.version}`,
        requestDigest: canonicalDigest({ id: job.id, version: job.version, status, errorCode: body.lastErrorCode ?? null }),
        result: { projectionId: job.id, status },
        createdAt: now,
      },
      mutations: [{ type: "update", expectedVersion: job.version, resource: next }],
      audit: audit(job, action, outcome, now),
    });
    if (result.type === "conflict") throw new GovernanceMembershipProjectionError("PROJECTION_CHANGED_CONCURRENTLY", true);
  }
}

/**
 * Better Auth organization mutations run only after a dedicated, current
 * admin session is validated for the exact mapped organization. This avoids
 * granting a broad owner service actor; Workspace authority remains canonical
 * in workspace_members and these rows are an access projection only.
 */
export class BetterAuthOrganizationMembershipProjectionPort implements GovernanceMembershipProjectionPort {
  private async context(workspaceId: string) {
    const cookie = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_COOKIE?.trim();
    const configuredUserId = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_USER_ID?.trim();
    if (!cookie || !configuredUserId) throw new GovernanceMembershipProjectionError("PROJECTION_CREDENTIAL_NOT_CONFIGURED", false);
    const headers = new Headers({ cookie });
    const session = await auth.api.getSession({ headers });
    if (!session || session.user.id !== configuredUserId) {
      throw new GovernanceMembershipProjectionError("PROJECTION_CREDENTIAL_INVALID", false);
    }
    const [settings] = await getDb().select({ organizationId: workspaceSettings.organizationId })
      .from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
    if (!settings?.organizationId) throw new GovernanceMembershipProjectionError("WORKSPACE_ORGANIZATION_UNMAPPED", false);
    const [serviceMember] = await getDb().select({ role: member.role }).from(member).where(and(
      eq(member.organizationId, settings.organizationId),
      eq(member.userId, configuredUserId),
    )).limit(1);
    if (serviceMember?.role !== "admin") {
      throw new GovernanceMembershipProjectionError("PROJECTION_ACTOR_NOT_LEAST_PRIVILEGED_ADMIN", false);
    }
    return { headers, organizationId: settings.organizationId, configuredUserId };
  }

  async apply(input: { workspaceId: string; operation: ProjectionOperation }): Promise<void> {
    const context = await this.context(input.workspaceId);
    try {
      if (input.operation.operation === "upsert" || input.operation.operation === "update_role") {
        await this.upsert(context, input.operation.userId, input.operation.role);
        return;
      }
      if (input.operation.operation === "remove") {
        await this.remove(context, input.operation.userId);
        return;
      }
      if (input.operation.operation === "transfer_ownership") {
        // Better Auth roles grant no Workspace business authority. Both humans
        // retain only admin/member access projection; canonical ownership lives
        // exclusively in workspace_members.
        await this.upsert(context, input.operation.currentOwnerUserId, "admin");
        await this.upsert(context, input.operation.newOwnerUserId, "admin");
        return;
      }
      const rows = await getDb().select({ id: member.id, userId: member.userId }).from(member)
        .where(eq(member.organizationId, context.organizationId));
      for (const row of rows) {
        if (row.userId !== context.configuredUserId) await this.remove(context, row.userId);
      }
    } catch (error) {
      if (error instanceof GovernanceMembershipProjectionError) throw error;
      throw new GovernanceMembershipProjectionError("BETTER_AUTH_ORGANIZATION_MUTATION_FAILED", true);
    }
  }

  private async upsert(
    context: { headers: Headers; organizationId: string; configuredUserId: string },
    userId: string,
    role: "admin" | "member",
  ) {
    if (userId === context.configuredUserId) throw new GovernanceMembershipProjectionError("PROJECTION_SERVICE_ACTOR_TARGET_FORBIDDEN", false);
    const [existing] = await getDb().select({ id: member.id, role: member.role }).from(member).where(and(
      eq(member.organizationId, context.organizationId),
      eq(member.userId, userId),
    )).limit(1);
    if (!existing) {
      await auth.api.addMember({ headers: context.headers, body: { organizationId: context.organizationId, userId, role } });
      return;
    }
    if (existing.role === role) return;
    await auth.api.updateMemberRole({ headers: context.headers, body: { organizationId: context.organizationId, memberId: existing.id, role } });
  }

  private async remove(
    context: { headers: Headers; organizationId: string; configuredUserId: string },
    userId: string,
  ) {
    if (userId === context.configuredUserId) throw new GovernanceMembershipProjectionError("PROJECTION_SERVICE_ACTOR_TARGET_FORBIDDEN", false);
    const [existing] = await getDb().select({ id: member.id }).from(member).where(and(
      eq(member.organizationId, context.organizationId),
      eq(member.userId, userId),
    )).limit(1);
    if (!existing) return;
    await auth.api.removeMember({ headers: context.headers, body: { organizationId: context.organizationId, memberIdOrEmail: existing.id } });
  }
}
