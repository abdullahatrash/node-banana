import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { workspaceSettings } from "@/lib/db/schema";
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
  operatorAlertRequired?: boolean;
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
  apply(input: {
    projectionId: string;
    requestDigest: string;
    workspaceId: string;
    operation: ProjectionOperation;
  }): Promise<void>;
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
      await this.projection.apply({
        projectionId: claimed.id,
        requestDigest: canonicalDigest({ workspaceId: claimed.workspaceId, operation }),
        workspaceId: claimed.workspaceId,
        operation,
      });
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
      const exhausted = !known.retryable;
      const status = exhausted ? "dead_letter" : "retry_pending";
      const delayMs = Math.min(60 * 60_000, 60_000 * (2 ** Math.max(0, body.attempts - 1)));
      await this.transition(claimed, status, {
        ...body,
        lease: null,
        nextAttemptAt: exhausted ? null : new Date(this.clock.now().getTime() + delayMs).toISOString(),
        lastErrorCode: known.code,
        completedAt: exhausted ? this.clock.now().toISOString() : null,
        operatorAlertRequired: known.retryable && body.attempts >= MAX_ATTEMPTS,
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
 * A scoped non-human integration signs one exact organization projection for
 * a dedicated Better Auth projection service. No expiring human cookie or
 * broad owner identity is stored in this process.
 */
export class BetterAuthOrganizationMembershipProjectionPort implements GovernanceMembershipProjectionPort {
  constructor(
    private readonly contextOverride?: (workspaceId: string) => Promise<{ url: URL; keyId: string; secret: string; organizationId: string }>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async context(workspaceId: string) {
    if (this.contextOverride) return this.contextOverride(workspaceId);
    const endpoint = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_URL?.trim();
    const keyId = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_KEY_ID?.trim();
    const secret = process.env.GOVERNANCE_MEMBERSHIP_PROJECTION_SIGNING_KEY?.trim();
    if (!endpoint || !keyId || !secret || Buffer.byteLength(secret, "utf8") < 32) throw new GovernanceMembershipProjectionError("PROJECTION_CREDENTIAL_NOT_CONFIGURED", true);
    let url: URL;
    try { url = new URL("/v1/better-auth/organization-membership", endpoint); }
    catch { throw new GovernanceMembershipProjectionError("PROJECTION_ENDPOINT_INVALID", true); }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new GovernanceMembershipProjectionError("PROJECTION_ENDPOINT_INSECURE", true);
    const [settings] = await getDb().select({ organizationId: workspaceSettings.organizationId })
      .from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
    if (!settings?.organizationId) throw new GovernanceMembershipProjectionError("WORKSPACE_ORGANIZATION_UNMAPPED", true);
    return { url, keyId, secret, organizationId: settings.organizationId };
  }

  async apply(input: { projectionId: string; requestDigest: string; workspaceId: string; operation: ProjectionOperation }): Promise<void> {
    const context = await this.context(input.workspaceId);
    const issuedAt = new Date().toISOString();
    const payload = {
      schema: "better-auth-membership-projection/v2",
      projectionId: input.projectionId,
      requestDigest: input.requestDigest,
      workspaceId: input.workspaceId,
      organizationId: context.organizationId,
      operation: input.operation,
      issuedAt,
      nonce: randomUUID(),
    };
    const signature = createHmac("sha256", context.secret).update(canonicalJson(payload)).digest("base64url");
    try {
      const response = await this.fetcher(context.url, { method: "POST", headers: { "content-type": "application/json", "x-governance-key-id": context.keyId, "x-governance-signature": signature, "x-governance-issued-at": issuedAt }, body: canonicalJson(payload), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new GovernanceMembershipProjectionError(`PROJECTION_SERVICE_HTTP_${response.status}`, true);
      const result = await response.json() as {
        success?: boolean;
        projectionId?: string;
        requestDigest?: string;
        outcome?: "applied" | "replayed";
      };
      if (
        result.success !== true ||
        result.projectionId !== input.projectionId ||
        result.requestDigest !== input.requestDigest ||
        (result.outcome !== "applied" && result.outcome !== "replayed")
      ) {
        throw new GovernanceMembershipProjectionError("PROJECTION_SERVICE_RECEIPT_INVALID", true);
      }
    } catch (error) {
      if (error instanceof GovernanceMembershipProjectionError) throw error;
      throw new GovernanceMembershipProjectionError("BETTER_AUTH_PROJECTION_UNAVAILABLE", true);
    }
  }
}
