import { createHash } from "node:crypto";
import { z } from "zod";

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[a-z0-9][a-z0-9_-]*$`));

export const artifactBindingSchema = z
  .object({
    artifactId: id("artifact_"),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    kind: z.enum(["image", "video", "audio", "document"]),
  })
  .strict();

export const targetContentSchema = z
  .object({
    text: z.string().min(1).optional(),
    artifacts: z.array(artifactBindingSchema).default([]),
  })
  .strict()
  .superRefine((content, ctx) => {
    if (!content.text && content.artifacts.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Target content needs text or at least one Artifact.",
      });
    }
  });

export const timingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }).strict(),
  z
    .object({
      mode: z.literal("at"),
      publishAt: z.string().datetime({ offset: true }),
      displayTimeZone: z
        .string()
        .refine((value) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        }, "displayTimeZone must be a valid IANA timezone.")
        .optional(),
    })
    .strict(),
]);

export const publishingTargetSchema = z
  .object({
    id: id("target_"),
    channelRef: id("channel_"),
    content: targetContentSchema,
    publishingSettings: z.record(z.string(), z.unknown()),
    timing: timingSchema,
  })
  .strict();

export const publishingPlanSchema = z
  .object({
    schema: z.literal("publishing-plan/v1"),
    id: id("pplan_"),
    workspaceId: id("ws_"),
    title: z.string().min(1),
    targets: z.array(publishingTargetSchema).min(1),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const [index, target] of plan.targets.entries()) {
      if (seen.has(target.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", index, "id"],
          message: `Duplicate target id "${target.id}".`,
        });
      }
      seen.add(target.id);
    }
  });

export type PublishingPlan = z.infer<typeof publishingPlanSchema>;
export type PublishingTarget = z.infer<typeof publishingTargetSchema>;
export type ApprovalAction = "schedule" | "publish-now";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "consumed"
  | "revoked"
  | "expired"
  | "superseded";
export type DeliveryStatus =
  | "scheduled"
  | "queued"
  | "blocked"
  | "retry_scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface PublishingAttempt {
  id: string;
  number: number;
  status:
    | "started"
    | "retry_scheduled"
    | "succeeded"
    | "failed"
    | "outcome_unknown";
  startedAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  reconciliation: {
    outcome: "published" | "not-published";
    reconciledAt: string;
    providerPostRef: string | null;
  } | null;
}

export interface PublishingPlanRevision {
  schema: "publishing-plan-revision/v1";
  id: string;
  workspaceId: string;
  revision: number;
  digest: string;
  definition: PublishingPlan;
  createdAt: string;
}

export interface TargetReadiness {
  targetId: string;
  channelRef: string;
  ready: boolean;
  reasons: string[];
}

export interface PublishValidation {
  schema: "publish-validation/v1";
  id: string;
  plan: PlanRevisionRef;
  trigger: "explicit" | "release-gate" | "pre-publish";
  checkedAt: string;
  targets: TargetReadiness[];
}

export interface PlanRevisionRef {
  id: string;
  revision: number;
  digest: string;
}

export type ApprovalDecision =
  | {
      basis: "human";
      approverRef: string;
      decidedAt: string;
    }
  | {
      basis: "policy";
      policyRef: string;
      policyVersion: number;
      evaluationRef: string;
      decidedAt: string;
    };

export interface Approval {
  schema: "publishing-approval/v1";
  id: string;
  workspaceId: string;
  plan: PlanRevisionRef;
  action: ApprovalAction;
  targetIds: string[];
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  decision: ApprovalDecision | null;
  revocation: {
    revokedBy: string;
    revokedAt: string;
    reason: string;
  } | null;
  expiredAt: string | null;
  supersededAt: string | null;
  supersededBy: PlanRevisionRef | null;
  consumedAt: string | null;
  releaseIdempotencyKey: string | null;
}

export interface Delivery {
  schema: "publishing-delivery/v1";
  id: string;
  workspaceId: string;
  plan: PlanRevisionRef;
  targetId: string;
  channelRef: string;
  action: ApprovalAction;
  approvalId: string;
  idempotencyKey: string;
  publishAt: string | null;
  status: DeliveryStatus;
  providerPostRef: string | null;
  block:
    | {
        code: "publish_validation_failed";
        message: string;
        validationId: string;
      }
    | {
        code: "provider_outcome_unknown";
        message: string;
        attemptId: string;
      }
    | null;
  attempts: PublishingAttempt[];
  nextRetryAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestPlan(plan: PublishingPlan): string {
  return `sha256:${createHash("sha256").update(canonicalize(plan)).digest("hex")}`;
}

export function planRef(revision: PublishingPlanRevision): PlanRevisionRef {
  return {
    id: revision.id,
    revision: revision.revision,
    digest: revision.digest,
  };
}
