import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  ARTIFACT_ID_PATTERN,
  ARTIFACT_TEXT_MEDIA_TYPE,
} from "@/lib/agent-runtime/artifacts/validation";
import { getPublishingSettingsDefinition } from "@/lib/social/publishing-settings";
import { validateMediaConstraints } from "@/lib/social/media";
import { z } from "zod";
import type {
  NormalizedPublishingPlanDefinition,
  NormalizedPublishingPlanTarget,
  PublishingPlanArtifactSnapshot,
  PublishingPlanArtifactSnapshotPort,
  PublishingPlanBlocker,
  PublishingPlanBlockerCode,
  PublishingPlanChannelSnapshot,
  PublishingPlanChannelSnapshotPort,
  PublishingPlanDraft,
  PublishingPlanDraftIssue,
  PublishingPlanRuntimePolicyDecision,
  PublishingPlanRuntimePolicyPort,
  PublishingPlanTargetValidationEvidence,
  PublishingPlanValidationContextPort,
  PublishingPlanValidationContextSnapshot,
  PublishingPlanValidationInput,
  PublishingPlanValidationResult,
  PublishingPlanValidationSession,
} from "./types";
import { publishingPlanAuthorizationContractDigest } from "./authorization-contract";
import { PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY } from "./production-digests";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ALLOWED_POLICY_IDENTITY = PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY;
const ALLOWED_POLICY_REASON_CODES = new Set(["EMERGENCY_SPEND_SUSPENDED"]);
const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
]);
const SESSION_TTL_MS = 30_000;
const MAX_CONTEXT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_DRAFT_BYTES = 262_144;
const MAX_SETTINGS_BYTES = 16_384;

const id = z.string().min(1).max(200).regex(ID_PATTERN);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const isoInstant = z.string().datetime({ offset: true });
const timing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now") }).strict(),
  z.object({ kind: z.literal("scheduled"), scheduledAt: isoInstant }).strict(),
]);
const target = z
  .object({
    targetId: id,
    channelId: id,
    contentArtifactId: artifactId,
    mediaArtifactIds: z.array(artifactId).max(50),
    settings: z.record(z.string(), z.unknown()),
    timing,
  })
  .strict();
const draftSchema = z
  .object({
    schema: z.literal("publishing-plan-draft/v1"),
    planId: id,
    channelIds: z.array(id).min(1).max(50),
    artifactIds: z.array(artifactId).min(1).max(200),
    targets: z.array(target).min(1).max(50),
  })
  .strict();

const blockerOrder: PublishingPlanBlockerCode[] = [
  "CHANNEL_INACCESSIBLE",
  "ARTIFACT_MISSING",
  "CONTENT_INVALID",
  "MEDIA_INVALID",
  "SETTINGS_INVALID",
  "TIMING_INVALID",
  "CONTEXT_EXPIRED",
  "POLICY_BLOCKED",
];

interface InternalValidation {
  result: PublishingPlanValidationResult;
  currentStateDigest: string | null;
  contextExpiresAt: Date | null;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sameSet(left: string[], right: string[]): boolean {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index])
  );
}

function issue(path: string, message: string): PublishingPlanDraftIssue {
  return { code: "PUBLISHING_PLAN_DRAFT_INVALID", path, message };
}

function boundedJson(value: unknown, maximum: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && Buffer.byteLength(serialized) <= maximum;
  } catch {
    return false;
  }
}

function structuralIssues(draft: PublishingPlanDraft): PublishingPlanDraftIssue[] {
  const issues: PublishingPlanDraftIssue[] = [];
  if (!boundedJson(draft, MAX_DRAFT_BYTES)) {
    issues.push(issue("$", "Publishing Plan draft exceeds its safe size."));
  }
  if (!unique(draft.channelIds)) {
    issues.push(issue("channelIds", "Channel manifest IDs must be unique."));
  }
  if (!unique(draft.artifactIds)) {
    issues.push(issue("artifactIds", "Artifact manifest IDs must be unique."));
  }
  if (!unique(draft.targets.map((item) => item.targetId))) {
    issues.push(issue("targets", "Target IDs must be unique."));
  }
  for (const [index, item] of draft.targets.entries()) {
    if (!unique(item.mediaArtifactIds)) {
      issues.push(
        issue(
          `targets.${index}.mediaArtifactIds`,
          "A target cannot reference the same media Artifact twice.",
        ),
      );
    }
    if (item.mediaArtifactIds.includes(item.contentArtifactId)) {
      issues.push(
        issue(
          `targets.${index}.mediaArtifactIds`,
          "The content Artifact cannot also be a media Artifact.",
        ),
      );
    }
    if (
      Object.keys(item.settings).length > 20 ||
      Object.keys(item.settings).some(
        (key) => !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key),
      ) ||
      !boundedJson(item.settings, MAX_SETTINGS_BYTES)
    ) {
      issues.push(
        issue(
          `targets.${index}.settings`,
          "Channel Publishing Settings exceed their safe contract.",
        ),
      );
    }
  }
  const referencedChannels = [
    ...new Set(draft.targets.map((item) => item.channelId)),
  ];
  const referencedArtifacts = [
    ...new Set(
      draft.targets.flatMap((item) => [
        item.contentArtifactId,
        ...item.mediaArtifactIds,
      ]),
    ),
  ];
  if (!sameSet(draft.channelIds, referencedChannels)) {
    issues.push(
      issue(
        "channelIds",
        "Channel manifest must exactly match the IDs referenced by targets.",
      ),
    );
  }
  if (!sameSet(draft.artifactIds, referencedArtifacts)) {
    issues.push(
      issue(
        "artifactIds",
        "Artifact manifest must exactly match the IDs referenced by targets.",
      ),
    );
  }
  return issues;
}

function addBlocker(
  blockers: PublishingPlanBlocker[],
  code: PublishingPlanBlockerCode,
  targetId: string,
  path: string,
  message: string,
  reasonCodes?: string[],
): void {
  if (blockers.some((item) => item.code === code && item.targetId === targetId)) {
    return;
  }
  blockers.push({
    code,
    targetId,
    path,
    message,
    ...(reasonCodes ? { details: { reasonCodes: [...reasonCodes].sort() } } : {}),
  });
}

function invalidResult(issues: PublishingPlanDraftIssue[]): InternalValidation {
  return {
    result: {
      schema: "publishing-plan-validation-result/v1",
      valid: false,
      issues,
      blockers: [],
      definitionDigest: null,
      normalizedDefinition: null,
      evidence: null,
    },
    currentStateDigest: null,
    contextExpiresAt: null,
  };
}

function contextBlocked(draft: PublishingPlanDraft): InternalValidation {
  return {
    result: {
      schema: "publishing-plan-validation-result/v1",
      valid: false,
      issues: [],
      blockers: draft.targets.map((item) => ({
        code: "CONTEXT_EXPIRED",
        targetId: item.targetId,
        path: "$",
        message: "The server validation context is unavailable or expired.",
      })),
      definitionDigest: null,
      normalizedDefinition: null,
      evidence: null,
    },
    currentStateDigest: null,
    contextExpiresAt: null,
  };
}

function safeDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validContext(
  value: PublishingPlanValidationContextSnapshot | null,
  input: PublishingPlanValidationInput,
  draft: PublishingPlanDraft,
  now: Date,
): value is PublishingPlanValidationContextSnapshot {
  try {
    if (!value) return false;
    const issuedAt = value.issuedAt.getTime();
    const expiresAt = value.expiresAt.getTime();
    return (
      ID_PATTERN.test(value.contextId) &&
      DIGEST_PATTERN.test(value.contextDigest) &&
      value.workspaceId === input.workspaceId &&
      value.principalId === input.principalId &&
      value.keyId === input.authorizationContext.keyId &&
      value.authorizationEvidenceRef ===
        input.authorizationContext.authorizationEvidenceRef &&
      value.capability === input.authorizationContext.capability &&
      DIGEST_PATTERN.test(value.authorizationContractDigest) &&
      value.authorizationContractDigest ===
        publishingPlanAuthorizationContractDigest(value.capability) &&
      Array.isArray(value.resources.channelIds) &&
      Array.isArray(value.resources.artifactIds) &&
      unique(value.resources.channelIds) &&
      unique(value.resources.artifactIds) &&
      value.resources.channelIds.every((resourceId) => ID_PATTERN.test(resourceId)) &&
      value.resources.artifactIds.every((resourceId) =>
        ARTIFACT_ID_PATTERN.test(resourceId),
      ) &&
      value.resources.channelIds.join("\u0000") ===
        [...value.resources.channelIds].sort().join("\u0000") &&
      value.resources.artifactIds.join("\u0000") ===
        [...value.resources.artifactIds].sort().join("\u0000") &&
      sameSet(value.resources.channelIds, draft.channelIds) &&
      sameSet(value.resources.artifactIds, draft.artifactIds) &&
      ID_PATTERN.test(value.keyId) &&
      ID_PATTERN.test(value.authorizationEvidenceRef) &&
      safeDate(value.issuedAt) &&
      safeDate(value.expiresAt) &&
      issuedAt <= now.getTime() &&
      expiresAt > now.getTime() &&
      expiresAt > issuedAt &&
      expiresAt - issuedAt <= MAX_CONTEXT_LIFETIME_MS
    );
  } catch {
    return false;
  }
}

function validArtifact(
  value: PublishingPlanArtifactSnapshot | null,
  workspaceId: string,
  requestedId: string,
  now: Date,
): value is PublishingPlanArtifactSnapshot {
  try {
    return Boolean(
      value &&
        value.id === requestedId &&
        ARTIFACT_ID_PATTERN.test(value.id) &&
        value.workspaceId === workspaceId &&
        DIGEST_PATTERN.test(value.digest) &&
        DIGEST_PATTERN.test(value.versionDigest) &&
        (value.kind === "text" || value.kind === "image") &&
        (value.mediaType === ARTIFACT_TEXT_MEDIA_TYPE ||
          ALLOWED_IMAGE_MEDIA_TYPES.has(value.mediaType)) &&
        Number.isSafeInteger(value.sizeBytes) &&
        value.sizeBytes >= 0 &&
        value.sizeBytes <= 52_428_800 &&
        (value.width === null ||
          (Number.isSafeInteger(value.width) && value.width > 0 && value.width <= 100_000)) &&
        (value.height === null ||
          (Number.isSafeInteger(value.height) && value.height > 0 && value.height <= 100_000)) &&
        (value.inlineText === null ||
          (typeof value.inlineText === "string" && value.inlineText.length <= 100_000)) &&
        (value.deletedAt === null || safeDate(value.deletedAt)) &&
        safeDate(value.observedAt) &&
        value.observedAt.getTime() <= now.getTime(),
    );
  } catch {
    return false;
  }
}

function validChannel(
  value: PublishingPlanChannelSnapshot | null,
  workspaceId: string,
  requestedId: string,
  now: Date,
): value is PublishingPlanChannelSnapshot {
  try {
    return Boolean(
      value &&
        value.id === requestedId &&
        ID_PATTERN.test(value.id) &&
        value.workspaceId === workspaceId &&
        value.platform === "linkedin" &&
        (value.authorKind === "person" || value.authorKind === "organization") &&
        DIGEST_PATTERN.test(value.versionDigest) &&
        value.state === "active" &&
        DIGEST_PATTERN.test(value.capabilityVersion) &&
        Number.isSafeInteger(value.maxContentLength) &&
        value.maxContentLength >= 1 &&
        value.maxContentLength <= 3_000 &&
        typeof value.supportsImages === "boolean" &&
        Number.isSafeInteger(value.maxImages) &&
        value.maxImages >= 0 &&
        value.maxImages <= 9 &&
        safeDate(value.observedAt) &&
        value.observedAt.getTime() <= now.getTime(),
    );
  } catch {
    return false;
  }
}

function safeArtifactEvidence(snapshot: PublishingPlanArtifactSnapshot) {
  return {
    id: snapshot.id,
    digest: snapshot.digest,
    snapshotDigest: artifactSnapshotDigest(snapshot),
    kind: snapshot.kind,
    mediaType: snapshot.mediaType,
    sizeBytes: snapshot.sizeBytes,
  };
}

function channelSnapshotDigest(snapshot: PublishingPlanChannelSnapshot): string {
  return canonicalDigest({
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    platform: snapshot.platform,
    authorKind: snapshot.authorKind,
    versionDigest: snapshot.versionDigest,
    state: snapshot.state,
    capabilityVersion: snapshot.capabilityVersion,
    maxContentLength: snapshot.maxContentLength,
    supportsImages: snapshot.supportsImages,
    maxImages: snapshot.maxImages,
  });
}

function artifactSnapshotDigest(snapshot: PublishingPlanArtifactSnapshot): string {
  return canonicalDigest({
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    digest: snapshot.digest,
    versionDigest: snapshot.versionDigest,
    kind: snapshot.kind,
    mediaType: snapshot.mediaType,
    sizeBytes: snapshot.sizeBytes,
    width: snapshot.width,
    height: snapshot.height,
    deletedAt: snapshot.deletedAt?.toISOString() ?? null,
  });
}

function policyConfiguration(
  policy: PublishingPlanRuntimePolicyPort,
): { identity: typeof ALLOWED_POLICY_IDENTITY; contractDigest: string } | null {
  try {
    return policy.identity === ALLOWED_POLICY_IDENTITY &&
      DIGEST_PATTERN.test(policy.contractDigest)
      ? { identity: policy.identity, contractDigest: policy.contractDigest }
      : null;
  } catch {
    return null;
  }
}

function safePolicyDecision(
  value: PublishingPlanRuntimePolicyDecision,
): PublishingPlanRuntimePolicyDecision | null {
  try {
    if (
      !value ||
      typeof value.allowed !== "boolean" ||
      !Array.isArray(value.reasonCodes) ||
      value.reasonCodes.length > 32 ||
      !unique(value.reasonCodes) ||
      value.reasonCodes.some((code) => !ALLOWED_POLICY_REASON_CODES.has(code)) ||
      !DIGEST_PATTERN.test(value.evidenceDigest) ||
      !DIGEST_PATTERN.test(value.stateDigest) ||
      (value.allowed && value.reasonCodes.length > 0) ||
      (!value.allowed && value.reasonCodes.length === 0)
    ) {
      return null;
    }
    return {
      allowed: value.allowed,
      reasonCodes: [...value.reasonCodes].sort(),
      evidenceDigest: value.evidenceDigest,
      stateDigest: value.stateDigest,
    };
  } catch {
    return null;
  }
}

function immutableClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (current: unknown): void => {
    if (!current || typeof current !== "object" || Object.isFrozen(current)) return;
    for (const child of Object.values(current)) freeze(child);
    Object.freeze(current);
  };
  freeze(clone);
  return clone;
}

function canonicalTarget(input: {
  draft: PublishingPlanDraft["targets"][number];
  settings: Record<string, unknown>;
  publishAt: string;
}): NormalizedPublishingPlanTarget {
  return {
    targetId: input.draft.targetId,
    channelId: input.draft.channelId,
    contentArtifactId: input.draft.contentArtifactId,
    mediaArtifactIds: [...input.draft.mediaArtifactIds],
    settings: structuredClone(input.settings),
    timing: { kind: input.draft.timing.kind, publishAt: input.publishAt },
  };
}

export class PublishingPlanValidator {
  constructor(
    private readonly artifacts: PublishingPlanArtifactSnapshotPort,
    private readonly channels: PublishingPlanChannelSnapshotPort,
    private readonly policy: PublishingPlanRuntimePolicyPort,
    private readonly contexts: PublishingPlanValidationContextPort,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async validate(input: PublishingPlanValidationInput): Promise<PublishingPlanValidationResult> {
    return (await this.validateInternal(input)).result;
  }

  async validateForCommit(input: PublishingPlanValidationInput): Promise<{
    result: PublishingPlanValidationResult;
    validationSession: PublishingPlanValidationSession | null;
  }> {
    const baseline = await this.validateInternal(input);
    if (
      !baseline.result.valid ||
      !baseline.result.definitionDigest ||
      !baseline.result.evidence ||
      !baseline.currentStateDigest ||
      !baseline.contextExpiresAt
    ) {
      return { result: baseline.result, validationSession: null };
    }
    if (input.authorizationContext.capability !== "publishing_plan_revisions.create@1") {
      return { result: baseline.result, validationSession: null };
    }
    const now = this.clock.now();
    const expiresAt = new Date(
      Math.min(
        baseline.contextExpiresAt.getTime(),
        now.getTime() + SESSION_TTL_MS,
      ),
    );
    const session: PublishingPlanValidationSession = {
      schema: "publishing-plan-validation-session/v1" as const,
      id: `ppvs_${randomUUID().replaceAll("-", "")}`,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      planId: baseline.result.normalizedDefinition!.planId,
      submittedDraftDigest: baseline.result.evidence.submittedDraftDigest,
      definitionDigest: baseline.result.definitionDigest,
      currentStateDigest: baseline.currentStateDigest,
      authorizationContext: {
        keyId: baseline.result.evidence.context.keyId,
        authorizationEvidenceRef:
          baseline.result.evidence.context.authorizationEvidenceRef,
        capability: "publishing_plan_revisions.create@1",
        contextId: baseline.result.evidence.context.contextId,
        contextDigest: baseline.result.evidence.context.contextDigest,
        contextIssuedAt: new Date(baseline.result.evidence.context.issuedAt),
        contextExpiresAt: new Date(baseline.result.evidence.context.expiresAt),
        authorizationContractDigest:
          baseline.result.evidence.context.authorizationContractDigest,
        resources: structuredClone(
          baseline.result.evidence.context.resources,
        ),
      },
      targets: baseline.result.normalizedDefinition!.targets.map(
        (target, index) => {
          const evidence = baseline.result.evidence!.targets[index]!;
          return {
            targetId: target.targetId,
            channelId: target.channelId,
            channelSnapshotDigest: evidence.channel!.snapshotDigest,
            contentArtifactId: target.contentArtifactId,
            mediaArtifactIds: [...target.mediaArtifactIds],
            artifactSnapshotDigests: evidence.artifacts.map(
              (artifact) => artifact.snapshotDigest,
            ),
            settings: structuredClone(target.settings),
            timing: structuredClone(target.timing),
            policyEvidenceDigest: evidence.policyEvidenceDigest!,
            policyStateDigest: evidence.policyStateDigest!,
          };
        },
      ),
      issuedAt: now,
      expiresAt,
    };
    return {
      result: baseline.result,
      validationSession: session,
    };
  }

  /** In-memory verifier; production repositories re-read these tokens in their tx. */
  async verifySessionCurrent(session: PublishingPlanValidationSession): Promise<boolean> {
    try {
      const now = this.clock.now();
      if (
        session.schema !== "publishing-plan-validation-session/v1" ||
        !ID_PATTERN.test(session.id) ||
        !ID_PATTERN.test(session.workspaceId) ||
        !ID_PATTERN.test(session.principalId) ||
        !ID_PATTERN.test(session.planId) ||
        !DIGEST_PATTERN.test(session.submittedDraftDigest) ||
        !DIGEST_PATTERN.test(session.definitionDigest) ||
        !DIGEST_PATTERN.test(session.currentStateDigest) ||
        !safeDate(session.issuedAt) ||
        !safeDate(session.expiresAt) ||
        !safeDate(session.authorizationContext.contextIssuedAt) ||
        !safeDate(session.authorizationContext.contextExpiresAt) ||
        session.issuedAt.getTime() > now.getTime() ||
        session.expiresAt.getTime() <= now.getTime() ||
        session.expiresAt.getTime() <= session.issuedAt.getTime() ||
        session.expiresAt.getTime() - session.issuedAt.getTime() > SESSION_TTL_MS ||
        session.expiresAt.getTime() >
          session.authorizationContext.contextExpiresAt.getTime()
      ) {
        return false;
      }
      const candidate: PublishingPlanDraft = {
        schema: "publishing-plan-draft/v1",
        planId: session.planId,
        channelIds: [...new Set(session.targets.map((target) => target.channelId))],
        artifactIds: [
          ...new Set(
            session.targets.flatMap((target) => [
              target.contentArtifactId,
              ...target.mediaArtifactIds,
            ]),
          ),
        ],
        targets: session.targets.map((target) => ({
          targetId: target.targetId,
          channelId: target.channelId,
          contentArtifactId: target.contentArtifactId,
          mediaArtifactIds: [...target.mediaArtifactIds],
          settings: structuredClone(target.settings),
          timing: { kind: "now" as const },
        })),
      };
      if (structuralIssues(candidate).length > 0) return false;
      const resolvedContext = await this.contexts.resolveCurrent({
        workspaceId: session.workspaceId,
        principalId: session.principalId,
        keyId: session.authorizationContext.keyId,
        authorizationEvidenceRef:
          session.authorizationContext.authorizationEvidenceRef,
        capability: session.authorizationContext.capability,
      });
      const contextInput: PublishingPlanValidationInput = {
        candidate,
        workspaceId: session.workspaceId,
        principalId: session.principalId,
        authorizationContext: {
          keyId: session.authorizationContext.keyId,
          authorizationEvidenceRef:
            session.authorizationContext.authorizationEvidenceRef,
          capability: session.authorizationContext.capability,
        },
        effectiveResources: {
          channelIds: candidate.channelIds,
          artifactIds: candidate.artifactIds,
          credentialProfileIds: [],
          workflowIds: [],
          automationIds: [],
        },
      };
      if (!validContext(resolvedContext, contextInput, candidate, now)) return false;
      if (
        resolvedContext.contextId !== session.authorizationContext.contextId ||
        resolvedContext.contextDigest !== session.authorizationContext.contextDigest ||
        resolvedContext.issuedAt.getTime() !==
          session.authorizationContext.contextIssuedAt.getTime() ||
        resolvedContext.expiresAt.getTime() !==
          session.authorizationContext.contextExpiresAt.getTime() ||
        resolvedContext.authorizationContractDigest !==
          session.authorizationContext.authorizationContractDigest ||
        !sameSet(
          resolvedContext.resources.channelIds,
          session.authorizationContext.resources.channelIds,
        ) ||
        !sameSet(
          resolvedContext.resources.artifactIds,
          session.authorizationContext.resources.artifactIds,
        )
      ) return false;
      const policyConfig = policyConfiguration(this.policy);
      if (!policyConfig) return false;
      const channels = new Map<string, PublishingPlanChannelSnapshot | null>();
      const artifacts = new Map<string, PublishingPlanArtifactSnapshot | null>();
      for (const channelId of candidate.channelIds) {
        const value = await this.channels
          .getCurrent({ workspaceId: session.workspaceId, channelId })
          .catch(() => null);
        channels.set(channelId, value ? structuredClone(value) : null);
      }
      for (const artifactId of candidate.artifactIds) {
        const value = await this.artifacts
          .getCurrent({ workspaceId: session.workspaceId, artifactId })
          .catch(() => null);
        artifacts.set(artifactId, value ? structuredClone(value) : null);
      }
      const currentTargetState: unknown[] = [];
      for (const target of session.targets) {
        const channel = channels.get(target.channelId) ?? null;
        const content = artifacts.get(target.contentArtifactId) ?? null;
        const rawMedia = target.mediaArtifactIds.map(
          (artifactId) => artifacts.get(artifactId) ?? null,
        );
        if (
          !validChannel(channel, session.workspaceId, target.channelId, now) ||
          !validArtifact(content, session.workspaceId, target.contentArtifactId, now) ||
          content.deletedAt !== null ||
          rawMedia.some(
            (artifact, index) =>
              !validArtifact(
                artifact,
                session.workspaceId,
                target.mediaArtifactIds[index]!,
                now,
              ) || artifact.deletedAt !== null,
          ) ||
          channelSnapshotDigest(channel) !== target.channelSnapshotDigest ||
          JSON.stringify([
            artifactSnapshotDigest(content),
            ...rawMedia.map((artifact) => artifactSnapshotDigest(artifact!)),
          ]) !== JSON.stringify(target.artifactSnapshotDigests) ||
          (target.timing.kind === "scheduled" &&
            new Date(target.timing.publishAt).getTime() <= now.getTime())
        ) return false;
        const media = rawMedia as PublishingPlanArtifactSnapshot[];
        const normalizedTarget: NormalizedPublishingPlanTarget = {
          targetId: target.targetId,
          channelId: target.channelId,
          contentArtifactId: target.contentArtifactId,
          mediaArtifactIds: [...target.mediaArtifactIds],
          settings: structuredClone(target.settings),
          timing: structuredClone(target.timing),
        };
        const decision = safePolicyDecision(
          await this.policy.evaluate(
            immutableClone({
              workspaceId: session.workspaceId,
              principalId: session.principalId,
              target: normalizedTarget,
              channel,
              content,
              media,
              evaluatedAt: now,
            }),
          ),
        );
        if (
          !decision ||
          !decision.allowed ||
          decision.evidenceDigest !== target.policyEvidenceDigest ||
          decision.stateDigest !== target.policyStateDigest
        ) return false;
        currentTargetState.push({
          targetId: target.targetId,
          channelDigest: channelSnapshotDigest(channel),
          artifactDigests: [
            artifactSnapshotDigest(content),
            ...media.map(artifactSnapshotDigest),
          ],
          policy: decision,
        });
      }
      const context = {
        contextId: resolvedContext.contextId,
        contextDigest: resolvedContext.contextDigest,
        issuedAt: resolvedContext.issuedAt.toISOString(),
        expiresAt: resolvedContext.expiresAt.toISOString(),
        capability: resolvedContext.capability,
        keyId: resolvedContext.keyId,
        authorizationEvidenceRef: resolvedContext.authorizationEvidenceRef,
        authorizationContractDigest: resolvedContext.authorizationContractDigest,
        resources: structuredClone(resolvedContext.resources),
      };
      return canonicalDigest({
        schema: "publishing-plan-current-state/v1",
        context,
        runtimePolicy: policyConfig,
        targets: currentTargetState,
      }) === session.currentStateDigest;
    } catch {
      return false;
    }
  }

  private async validateInternal(
    input: PublishingPlanValidationInput,
  ): Promise<InternalValidation> {
    const parsed = draftSchema.safeParse(input.candidate);
    if (!parsed.success) {
      return invalidResult(
        parsed.error.issues.map((item) =>
          issue(item.path.join(".") || "$", "Publishing Plan draft field is invalid."),
        ),
      );
    }
    const draft = parsed.data;
    const issues = structuralIssues(draft);
    if (issues.length > 0) return invalidResult(issues);
    let submittedDraftDigest: string;
    try {
      submittedDraftDigest = canonicalDigest(input.candidate);
    } catch {
      return invalidResult([issue("$", "Publishing Plan draft is not canonical JSON.")]);
    }

    const allowedChannels = new Set(input.effectiveResources.channelIds);
    const allowedArtifacts = new Set(input.effectiveResources.artifactIds ?? []);
    const channelCache = new Map<string, Promise<PublishingPlanChannelSnapshot | null>>();
    const artifactCache = new Map<string, Promise<PublishingPlanArtifactSnapshot | null>>();
    const readChannel = (channelId: string) => {
      let pending = channelCache.get(channelId);
      if (!pending) {
        pending = this.channels
          .getCurrent({ workspaceId: input.workspaceId, channelId })
          .then((value) => (value ? structuredClone(value) : null))
          .catch(() => null);
        channelCache.set(channelId, pending);
      }
      return pending;
    };
    const readArtifact = (artifactId: string) => {
      let pending = artifactCache.get(artifactId);
      if (!pending) {
        pending = this.artifacts
          .getCurrent({ workspaceId: input.workspaceId, artifactId })
          .then((value) => (value ? structuredClone(value) : null))
          .catch(() => null);
        artifactCache.set(artifactId, pending);
      }
      return pending;
    };
    const contextPending = this.contexts
      .resolveCurrent({
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        keyId: input.authorizationContext.keyId,
        authorizationEvidenceRef:
          input.authorizationContext.authorizationEvidenceRef,
        capability: input.authorizationContext.capability,
      })
      .then((value) => (value ? structuredClone(value) : null))
      .catch(() => null);
    await Promise.all([
      contextPending,
      ...draft.channelIds
        .filter((channelId) => allowedChannels.has(channelId))
        .map(readChannel),
      ...draft.artifactIds
        .filter((artifactId) => allowedArtifacts.has(artifactId))
        .map(readArtifact),
    ]);
    const evaluatedAt = this.clock.now();
    const resolvedContext = await contextPending;
    if (!validContext(resolvedContext, input, draft, evaluatedAt)) {
      return contextBlocked(draft);
    }
    const context = {
      contextId: resolvedContext.contextId,
      contextDigest: resolvedContext.contextDigest,
      issuedAt: resolvedContext.issuedAt.toISOString(),
      expiresAt: resolvedContext.expiresAt.toISOString(),
      capability: resolvedContext.capability,
      keyId: resolvedContext.keyId,
      authorizationEvidenceRef: resolvedContext.authorizationEvidenceRef,
      authorizationContractDigest: resolvedContext.authorizationContractDigest,
      resources: {
        channelIds: [...resolvedContext.resources.channelIds],
        artifactIds: [...resolvedContext.resources.artifactIds],
      },
    };
    const policyConfig = policyConfiguration(this.policy);
    const blockers: PublishingPlanBlocker[] = [];
    const normalizedTargets: NormalizedPublishingPlanTarget[] = [];
    const targetEvidence: PublishingPlanTargetValidationEvidence[] = [];
    const currentTargetState: unknown[] = [];

    for (const [index, item] of draft.targets.entries()) {
      const targetBlockers: PublishingPlanBlocker[] = [];
      const rawChannel = allowedChannels.has(item.channelId)
        ? await readChannel(item.channelId)
        : null;
      const channel = validChannel(
        rawChannel,
        input.workspaceId,
        item.channelId,
        evaluatedAt,
      )
        ? rawChannel
        : null;
      if (!channel) {
        addBlocker(
          targetBlockers,
          "CHANNEL_INACCESSIBLE",
          item.targetId,
          `targets.${index}.channelId`,
          "The target Channel is inaccessible or unsupported.",
        );
      }

      const artifactIds = [item.contentArtifactId, ...item.mediaArtifactIds];
      const snapshots = new Map<string, PublishingPlanArtifactSnapshot>();
      for (const artifactId of artifactIds) {
        const rawSnapshot = allowedArtifacts.has(artifactId)
          ? await readArtifact(artifactId)
          : null;
        if (
          validArtifact(rawSnapshot, input.workspaceId, artifactId, evaluatedAt) &&
          rawSnapshot.deletedAt === null
        ) {
          snapshots.set(artifactId, rawSnapshot);
        } else {
          addBlocker(
            targetBlockers,
            "ARTIFACT_MISSING",
            item.targetId,
            `targets.${index}`,
            "One or more referenced Artifacts are unavailable.",
          );
        }
      }
      const content = snapshots.get(item.contentArtifactId) ?? null;
      const media = item.mediaArtifactIds.flatMap((artifactId) => {
        const snapshot = snapshots.get(artifactId);
        return snapshot ? [snapshot] : [];
      });
      if (
        content &&
        (content.kind !== "text" ||
          content.mediaType !== ARTIFACT_TEXT_MEDIA_TYPE ||
          typeof content.inlineText !== "string" ||
          content.inlineText.trim().length === 0 ||
          (channel !== null && content.inlineText.length > channel.maxContentLength))
      ) {
        addBlocker(
          targetBlockers,
          "CONTENT_INVALID",
          item.targetId,
          `targets.${index}.contentArtifactId`,
          "The content Artifact is not publishable for this Channel.",
        );
      }
      const sharedMediaValidation = validateMediaConstraints(
        "linkedin",
        media.map(() => ({ type: "image", url: "artifact://current" })),
      );
      if (
        media.some(
          (snapshot) => snapshot.kind !== "image" || !snapshot.mediaType.startsWith("image/"),
        ) ||
        !sharedMediaValidation.valid ||
        (channel !== null &&
          ((media.length > 0 && !channel.supportsImages) ||
            media.length > channel.maxImages))
      ) {
        addBlocker(
          targetBlockers,
          "MEDIA_INVALID",
          item.targetId,
          `targets.${index}.mediaArtifactIds`,
          "The media Artifacts are not publishable for this Channel.",
        );
      }

      let normalizedSettings: Record<string, unknown> = structuredClone(item.settings);
      if (channel) {
        try {
          const definition = getPublishingSettingsDefinition("linkedin");
          const settingValidation = definition.validateForPublish(item.settings, {
            content: content?.inlineText ?? "",
            media: media.map(() => ({ type: "image", url: "artifact://current" })),
          });
          const requestedKind = item.settings.type;
          if (
            !settingValidation.valid ||
            (requestedKind !== undefined && requestedKind !== channel.authorKind)
          ) {
            addBlocker(
              targetBlockers,
              "SETTINGS_INVALID",
              item.targetId,
              `targets.${index}.settings`,
              "The LinkedIn author settings do not match this Channel.",
            );
          }
          normalizedSettings = { type: channel.authorKind };
        } catch {
          addBlocker(
            targetBlockers,
            "SETTINGS_INVALID",
            item.targetId,
            `targets.${index}.settings`,
            "The LinkedIn settings contract is unavailable.",
          );
        }
      }

      const publishAt =
        item.timing.kind === "now"
          ? evaluatedAt.toISOString()
          : new Date(item.timing.scheduledAt).toISOString();
      if (
        item.timing.kind === "scheduled" &&
        new Date(item.timing.scheduledAt).getTime() <= evaluatedAt.getTime()
      ) {
        addBlocker(
          targetBlockers,
          "TIMING_INVALID",
          item.targetId,
          `targets.${index}.timing.scheduledAt`,
          "Scheduled publishing requires a future instant.",
        );
      }

      const normalizedTarget = canonicalTarget({ draft: item, settings: normalizedSettings, publishAt });
      let policyEvidenceDigest: string | null = null;
      let policyStateDigest: string | null = null;
      let policyState: unknown = { valid: false };
      if (
        policyConfig &&
        channel &&
        content &&
        media.length === item.mediaArtifactIds.length
      ) {
        try {
          const decision = safePolicyDecision(
            await this.policy.evaluate(
              immutableClone({
                workspaceId: input.workspaceId,
                principalId: input.principalId,
                target: canonicalTarget({ draft: item, settings: normalizedSettings, publishAt }),
                channel,
                content,
                media,
                evaluatedAt,
              }),
            ),
          );
          if (!decision) throw new Error("malformed policy decision");
          policyEvidenceDigest = decision.evidenceDigest;
          policyStateDigest = decision.stateDigest;
          policyState = decision;
          if (!decision.allowed) {
            addBlocker(
              targetBlockers,
              "POLICY_BLOCKED",
              item.targetId,
              `targets.${index}`,
              "Current runtime policy blocks this target.",
              decision.reasonCodes,
            );
          }
        } catch {
          addBlocker(
            targetBlockers,
            "POLICY_BLOCKED",
            item.targetId,
            `targets.${index}`,
            "Current runtime policy could not admit this target.",
            ["POLICY_EVALUATION_UNAVAILABLE"],
          );
        }
      } else if (!policyConfig) {
        addBlocker(
          targetBlockers,
          "POLICY_BLOCKED",
          item.targetId,
          `targets.${index}`,
          "Current runtime policy is unavailable.",
          ["POLICY_CONFIGURATION_INVALID"],
        );
      }

      const finalTarget = canonicalTarget({ draft: item, settings: normalizedSettings, publishAt });
      targetBlockers.sort(
        (left, right) =>
          blockerOrder.indexOf(left.code) - blockerOrder.indexOf(right.code),
      );
      blockers.push(...targetBlockers);
      normalizedTargets.push(finalTarget);
      const channelDigest = channel ? channelSnapshotDigest(channel) : null;
      const artifactDigests = artifactIds.flatMap((artifactId) => {
        const snapshot = snapshots.get(artifactId);
        return snapshot ? [artifactSnapshotDigest(snapshot)] : [];
      });
      currentTargetState.push({
        targetId: item.targetId,
        channelDigest,
        artifactDigests,
        policy: policyState,
      });
      targetEvidence.push({
        targetId: item.targetId,
        channel: channel
          ? {
              id: channel.id,
              platform: "linkedin",
              authorKind: channel.authorKind,
              snapshotDigest: channelDigest!,
              capabilityVersion: channel.capabilityVersion,
            }
          : null,
        artifacts: artifactIds.flatMap((artifactId) => {
          const snapshot = snapshots.get(artifactId);
          return snapshot ? [safeArtifactEvidence(snapshot)] : [];
        }),
        settingsDigest: canonicalDigest(normalizedSettings),
        publishAt,
        policyEvidenceDigest,
        policyStateDigest,
        blockerCodes: targetBlockers.map((blocker) => blocker.code),
      });
    }

    const finalizedAt = this.clock.now();
    if (finalizedAt.getTime() >= resolvedContext.expiresAt.getTime()) {
      return contextBlocked(draft);
    }
    draft.targets.forEach((item, index) => {
      if (
        item.timing.kind === "scheduled" &&
        new Date(item.timing.scheduledAt).getTime() <= finalizedAt.getTime() &&
        !blockers.some(
          (blocker) =>
            blocker.targetId === item.targetId && blocker.code === "TIMING_INVALID",
        )
      ) {
        const timingBlocker: PublishingPlanBlocker = {
          code: "TIMING_INVALID",
          targetId: item.targetId,
          path: `targets.${index}.timing.scheduledAt`,
          message: "Scheduled publishing requires a future instant.",
        };
        blockers.push(timingBlocker);
        targetEvidence[index]?.blockerCodes.push("TIMING_INVALID");
      }
    });
    const targetOrder = new Map(
      draft.targets.map((target, index) => [target.targetId, index] as const),
    );
    blockers.sort(
      (left, right) =>
        (targetOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) -
          (targetOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER) ||
        blockerOrder.indexOf(left.code) - blockerOrder.indexOf(right.code) ||
        left.path.localeCompare(right.path),
    );
    for (const item of targetEvidence) {
      item.blockerCodes.sort(
        (left, right) =>
          blockerOrder.indexOf(left) - blockerOrder.indexOf(right),
      );
    }
    const normalizedDefinition: NormalizedPublishingPlanDefinition = {
      schema: "publishing-plan-revision-definition/v1",
      planId: draft.planId,
      channelIds: [...draft.channelIds],
      artifactIds: [...draft.artifactIds],
      targets: normalizedTargets,
    };
    const definitionDigest = canonicalDigest(normalizedDefinition);
    const currentStateDigest = canonicalDigest({
      schema: "publishing-plan-current-state/v1",
      context,
      runtimePolicy: {
        identity: policyConfig?.identity ?? ALLOWED_POLICY_IDENTITY,
        contractDigest:
          policyConfig?.contractDigest ?? canonicalDigest({ unavailable: true }),
      },
      targets: currentTargetState,
    });
    const evidence = {
      schema: "publishing-plan-validation-evidence/v1" as const,
      submittedDraftDigest,
      definitionDigest,
      currentStateDigest,
      evaluatedAt: finalizedAt.toISOString(),
      context: structuredClone(context),
      runtimePolicy: {
        identity: policyConfig?.identity ?? ALLOWED_POLICY_IDENTITY,
        contractDigest:
          policyConfig?.contractDigest ?? canonicalDigest({ unavailable: true }),
      },
      targets: targetEvidence,
      authorizesExecution: false as const,
    };
    return {
      result: {
        schema: "publishing-plan-validation-result/v1",
        valid: blockers.length === 0,
        issues: [],
        blockers,
        definitionDigest,
        normalizedDefinition,
        evidence,
      },
      currentStateDigest,
      contextExpiresAt: new Date(resolvedContext.expiresAt),
    };
  }
}
