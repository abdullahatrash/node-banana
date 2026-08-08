import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  ARTIFACT_ID_PATTERN,
  ARTIFACT_TEXT_MEDIA_TYPE,
} from "@/lib/agent-runtime/artifacts/validation";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  artifactContents,
  artifacts,
  runtimePublishingPlanMutationReceipts,
  runtimePublishingPlanRevisions,
  runtimePublishingPlans,
  runtimeSpendControls,
  socialAccounts,
} from "@/lib/db/schema";
import { readLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import {
  PUBLISHING_PLAN_CAPABILITY_IDENTITIES,
  publishingPlanAuthorizationContractDigest,
} from "./authorization-contract";
import {
  PUBLISHING_PLAN_LINKEDIN_CAPABILITIES,
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS,
  publishingPlanArtifactVersionDigest,
  publishingPlanChannelVersionDigest,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanRuntimePolicyContractDigest,
  publishingPlanPolicyStateDigest,
} from "./production-digests";
import type {
  NormalizedPublishingPlanDefinition,
  PublishingPlanCommitResult,
  PublishingPlanRepository,
  PublishingPlanRevisionRecord,
  PublishingPlanSuccessfulValidationEvidence,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class PublishingPlanPersistenceUnavailable extends Error {}

const CREATE_AUTHORIZATION_CONTRACT_DIGEST =
  publishingPlanAuthorizationContractDigest(
    "publishing_plan_revisions.create@1",
  );
const RUNTIME_POLICY_CONTRACT_DIGEST =
  publishingPlanRuntimePolicyContractDigest();

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactIdentifier = z
  .string()
  .min(1)
  .max(200)
  .regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const linkedinSettings = z
  .object({ type: z.enum(["person", "organization"]) })
  .strict();
const context = z
  .object({
    contextId: identifier,
    contextDigest: digest,
    issuedAt: instant,
    expiresAt: instant,
  })
  .strict();
const normalizedTarget = z
  .object({
    targetId: identifier,
    channelId: identifier,
    contentArtifactId: artifactIdentifier,
    mediaArtifactIds: z.array(artifactIdentifier).max(50),
    settings: linkedinSettings,
    timing: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("now"), publishAt: instant })
        .strict(),
      z
        .object({ kind: z.literal("scheduled"), publishAt: instant })
        .strict(),
    ]),
  })
  .strict();
const normalizedDefinition = z
  .object({
    schema: z.literal("publishing-plan-revision-definition/v1"),
    planId: identifier,
    channelIds: z.array(identifier).min(1).max(50),
    artifactIds: z.array(artifactIdentifier).min(1).max(200),
    targets: z.array(normalizedTarget).min(1).max(50),
  })
  .strict();
const blockerCode = z.enum([
  "CHANNEL_INACCESSIBLE",
  "ARTIFACT_MISSING",
  "CONTENT_INVALID",
  "MEDIA_INVALID",
  "SETTINGS_INVALID",
  "TIMING_INVALID",
  "CONTEXT_EXPIRED",
  "POLICY_BLOCKED",
]);
const targetEvidence = z
  .object({
    targetId: identifier,
    channel: z
      .object({
        id: identifier,
        platform: z.literal("linkedin"),
        authorKind: z.enum(["person", "organization"]),
        snapshotDigest: digest,
        capabilityVersion: digest,
      })
      .strict(),
    artifacts: z
      .array(
        z
          .object({
            id: artifactIdentifier,
            digest,
            snapshotDigest: digest,
            kind: z.enum(["text", "image"]),
            mediaType: z.enum([
              ARTIFACT_TEXT_MEDIA_TYPE,
              "image/jpeg",
              "image/png",
              "image/gif",
            ]),
            sizeBytes: z.number().int().nonnegative().max(52_428_800),
          })
          .strict(),
      )
      .min(1)
      .max(51),
    settingsDigest: digest,
    publishAt: instant,
    policyEvidenceDigest: digest,
    policyStateDigest: digest,
    blockerCodes: z.array(blockerCode).length(0),
  })
  .strict();
const validationEvidence = z
  .object({
    schema: z.literal("publishing-plan-validation-evidence/v1"),
    submittedDraftDigest: digest,
    definitionDigest: digest,
    currentStateDigest: digest,
    evaluatedAt: instant,
    context: context
      .extend({
        capability: z.literal("publishing_plan_revisions.create@1"),
        keyId: identifier,
        authorizationEvidenceRef: z.string().min(1).max(200),
        authorizationContractDigest: z.literal(
          CREATE_AUTHORIZATION_CONTRACT_DIGEST,
        ),
        resources: z
          .object({
            channelIds: z.array(identifier).min(1).max(50),
            artifactIds: z.array(artifactIdentifier).min(1).max(200),
          })
          .strict(),
      })
      .strict(),
    runtimePolicy: z
      .object({
        identity: z.literal(PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY),
        contractDigest: z.literal(RUNTIME_POLICY_CONTRACT_DIGEST),
      })
      .strict(),
    targets: z.array(targetEvidence).min(1).max(50),
    authorizesExecution: z.literal(false),
  })
  .strict();
const validationSession = z
  .object({
    schema: z.literal("publishing-plan-validation-session/v1"),
    id: z.string().min(1).max(200).regex(/^ppvs_[A-Za-z0-9_-]+$/),
    workspaceId: identifier,
    principalId: identifier,
    planId: identifier,
    submittedDraftDigest: digest,
    definitionDigest: digest,
    currentStateDigest: digest,
    authorizationContext: z
      .object({
        keyId: identifier,
        authorizationEvidenceRef: z.string().min(1).max(200),
        capability: z.literal("publishing_plan_revisions.create@1"),
        contextId: identifier,
        contextDigest: digest,
        contextIssuedAt: z.date(),
        contextExpiresAt: z.date(),
        authorizationContractDigest: z.literal(
          CREATE_AUTHORIZATION_CONTRACT_DIGEST,
        ),
        resources: z
          .object({
            channelIds: z.array(identifier).min(1).max(50),
            artifactIds: z.array(artifactIdentifier).min(1).max(200),
          })
          .strict(),
      })
      .strict(),
    targets: z
      .array(
        z
          .object({
            targetId: identifier,
            channelId: identifier,
            channelSnapshotDigest: digest,
            contentArtifactId: artifactIdentifier,
            mediaArtifactIds: z.array(artifactIdentifier).max(50),
            artifactSnapshotDigests: z.array(digest).min(1).max(51),
            settings: linkedinSettings,
            timing: z.discriminatedUnion("kind", [
              z
                .object({ kind: z.literal("now"), publishAt: instant })
                .strict(),
              z
                .object({ kind: z.literal("scheduled"), publishAt: instant })
                .strict(),
            ]),
            policyEvidenceDigest: digest,
            policyStateDigest: digest,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    issuedAt: z.date(),
    expiresAt: z.date(),
  })
  .strict();

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sameOrder(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sortedUnique(values: string[]): boolean {
  return unique(values) && sameOrder(values, [...values].sort());
}

function postgresDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("PostgreSQL returned an invalid timestamp.");
  }
  return date;
}

function exactAuthorizationResources(
  resources: Array<{ kind: string; id: string }>,
  channelIds: string[],
  artifactIds: string[],
): boolean {
  if (
    !unique(channelIds) ||
    !unique(artifactIds) ||
    resources.some(
      (resource) =>
        !resource ||
        Object.keys(resource).sort().join(",") !== "id,kind" ||
        (resource.kind === "channel"
          ? !identifier.safeParse(resource.id).success
          : resource.kind === "artifact"
            ? !artifactIdentifier.safeParse(resource.id).success
            : true),
    )
  ) {
    return false;
  }
  const expected = [
    ...channelIds.map((id) => `channel:${id}`),
    ...artifactIds.map((id) => `artifact:${id}`),
  ].sort();
  const actual = resources
    .map((resource) => `${resource.kind}:${resource.id}`)
    .sort();
  return (
    unique(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function validPayload(input: {
  planId: string;
  definitionDigest: string;
  definition: unknown;
  validationEvidence: unknown;
  createdAt: Date;
}):
  | {
      definition: NormalizedPublishingPlanDefinition;
      evidence: PublishingPlanSuccessfulValidationEvidence;
      evidenceDigest: string;
    }
  | null {
  const parsedDefinition = normalizedDefinition.safeParse(input.definition);
  const parsedEvidence = validationEvidence.safeParse(input.validationEvidence);
  if (!parsedDefinition.success || !parsedEvidence.success) return null;
  const definition = parsedDefinition.data;
  const evidence = parsedEvidence.data;
  if (
    definition.planId !== input.planId ||
    canonicalDigest(definition) !== input.definitionDigest ||
    !unique(definition.channelIds) ||
    !unique(definition.artifactIds) ||
    !unique(definition.targets.map((target) => target.targetId)) ||
    !sameSet(
      definition.channelIds,
      [...new Set(definition.targets.map((target) => target.channelId))],
    ) ||
    !sameSet(
      definition.artifactIds,
      [
        ...new Set(
          definition.targets.flatMap((target) => [
            target.contentArtifactId,
            ...target.mediaArtifactIds,
          ]),
        ),
      ],
    ) ||
    evidence.definitionDigest !== input.definitionDigest ||
    !sortedUnique(evidence.context.resources.channelIds) ||
    !sortedUnique(evidence.context.resources.artifactIds) ||
    !sameSet(evidence.context.resources.channelIds, definition.channelIds) ||
    !sameSet(evidence.context.resources.artifactIds, definition.artifactIds) ||
    evidence.targets.length !== definition.targets.length ||
    evidence.targets.some((item, index) => {
      const target = definition.targets[index];
      const content = target
        ? item.artifacts.find(
            (artifact) => artifact.id === target.contentArtifactId,
          )
        : undefined;
      const media = target
        ? target.mediaArtifactIds.map((artifactId) =>
            item.artifacts.find((artifact) => artifact.id === artifactId),
          )
        : [];
      return (
        !target ||
        item.targetId !== target.targetId ||
        item.channel.id !== target.channelId ||
        item.channel.authorKind !== target.settings.type ||
        item.publishAt !== target.timing.publishAt ||
        item.settingsDigest !== canonicalDigest(target.settings) ||
        !sameSet(
          item.artifacts.map((artifact) => artifact.id),
          [target.contentArtifactId, ...target.mediaArtifactIds],
        ) ||
        content?.kind !== "text" ||
        content.mediaType !== ARTIFACT_TEXT_MEDIA_TYPE ||
        media.some(
          (artifact) =>
            !artifact ||
            artifact.kind !== "image" ||
            !["image/jpeg", "image/png", "image/gif"].includes(
              artifact.mediaType,
            ),
        )
      );
    })
  ) {
    return null;
  }
  const issuedAt = new Date(evidence.context.issuedAt).getTime();
  const evaluatedAt = new Date(evidence.evaluatedAt).getTime();
  const expiresAt = new Date(evidence.context.expiresAt).getTime();
  if (
    !Number.isFinite(input.createdAt.getTime()) ||
    issuedAt > evaluatedAt ||
    evaluatedAt >= expiresAt ||
    input.createdAt.getTime() >= expiresAt
  ) {
    return null;
  }
  return {
    definition,
    evidence: evidence as PublishingPlanSuccessfulValidationEvidence,
    evidenceDigest: canonicalDigest(evidence),
  };
}

function validSessionBinding(input: {
  session: unknown;
  revision: PublishingPlanRevisionRecord;
  evidence: PublishingPlanSuccessfulValidationEvidence;
}): ReturnType<typeof validationSession.parse> | null {
  const parsed = validationSession.safeParse(input.session);
  if (!parsed.success) return null;
  const session = parsed.data;
  const evidence = input.evidence;
  if (
    session.workspaceId !== input.revision.workspaceId ||
    session.principalId !== input.revision.authorPrincipalId ||
    session.planId !== input.revision.planId ||
    session.submittedDraftDigest !== evidence.submittedDraftDigest ||
    session.definitionDigest !== input.revision.definitionDigest ||
    session.currentStateDigest !== evidence.currentStateDigest ||
    session.authorizationContext.keyId !== input.revision.authorKeyId ||
    session.authorizationContext.authorizationEvidenceRef !==
      input.revision.creationAuthorizationEvidenceRef ||
    evidence.context.keyId !== input.revision.authorKeyId ||
    evidence.context.authorizationEvidenceRef !==
      input.revision.creationAuthorizationEvidenceRef ||
    session.authorizationContext.contextId !== evidence.context.contextId ||
    session.authorizationContext.contextDigest !== evidence.context.contextDigest ||
    session.authorizationContext.contextIssuedAt.toISOString() !==
      evidence.context.issuedAt ||
    session.authorizationContext.contextExpiresAt.toISOString() !==
      evidence.context.expiresAt ||
    session.authorizationContext.authorizationContractDigest !==
      evidence.context.authorizationContractDigest ||
    !sortedUnique(session.authorizationContext.resources.channelIds) ||
    !sortedUnique(session.authorizationContext.resources.artifactIds) ||
    !sameSet(
      session.authorizationContext.resources.channelIds,
      input.revision.definition.channelIds,
    ) ||
    !sameSet(
      session.authorizationContext.resources.artifactIds,
      input.revision.definition.artifactIds,
    ) ||
    session.targets.length !== input.revision.definition.targets.length ||
    session.targets.some((target, index) => {
      const definition = input.revision.definition.targets[index];
      const targetEvidence = evidence.targets[index];
      return (
        !definition ||
        !targetEvidence ||
        target.targetId !== definition.targetId ||
        target.channelId !== definition.channelId ||
        target.channelSnapshotDigest !== targetEvidence.channel?.snapshotDigest ||
        target.contentArtifactId !== definition.contentArtifactId ||
        !sameOrder(target.mediaArtifactIds, definition.mediaArtifactIds) ||
        canonicalDigest(target.settings) !== canonicalDigest(definition.settings) ||
        canonicalDigest(target.timing) !== canonicalDigest(definition.timing) ||
        target.policyEvidenceDigest !== targetEvidence.policyEvidenceDigest ||
        target.policyStateDigest !== targetEvidence.policyStateDigest ||
        !sameSet(
          target.artifactSnapshotDigests,
          targetEvidence.artifacts.map((artifact) => artifact.snapshotDigest),
        )
      );
    })
  ) {
    return null;
  }
  return session;
}

async function verifyCurrentCommitState(
  tx: Tx,
  input: {
    revision: PublishingPlanRevisionRecord;
    evidence: PublishingPlanSuccessfulValidationEvidence;
    session: ReturnType<typeof validationSession.parse>;
  },
): Promise<boolean> {
  const { revision, evidence, session } = input;
  const authorizationRows = await tx
    .select({
      decision: agentAuthorizationDecisions,
      principalStatus: agentPrincipals.status,
      principalRevokedAt: agentPrincipals.revokedAt,
      keyRevokedAt: agentKeys.revokedAt,
      keyExpiresAt: agentKeys.expiresAt,
      databaseNow: sql<unknown>`statement_timestamp()`,
    })
    .from(agentAuthorizationDecisions)
    .innerJoin(
      agentPrincipals,
      and(
        eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
        eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
      ),
    )
    .innerJoin(
      agentKeys,
      and(
        eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
        eq(agentKeys.id, agentAuthorizationDecisions.keyId),
      ),
    )
    .where(
      and(
        eq(agentAuthorizationDecisions.workspaceId, revision.workspaceId),
        eq(agentAuthorizationDecisions.principalId, revision.authorPrincipalId),
        eq(agentAuthorizationDecisions.keyId, revision.authorKeyId),
        eq(
          agentAuthorizationDecisions.operatorTraceRef,
          revision.creationAuthorizationEvidenceRef,
        ),
        eq(
          agentAuthorizationDecisions.capabilityName,
          PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create.name,
        ),
        eq(
          agentAuthorizationDecisions.capabilityVersion,
          PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create.version,
        ),
        eq(
          agentAuthorizationDecisions.authorizationContractDigest,
          CREATE_AUTHORIZATION_CONTRACT_DIGEST,
        ),
        eq(agentAuthorizationDecisions.outcome, "allowed"),
      ),
    )
    .limit(1)
    .for("share");
  const authorization = authorizationRows[0];
  if (!authorization) return false;
  const databaseNow = postgresDate(authorization.databaseNow);
  const decision = authorization.decision;
  const contextExpiresAt = new Date(
    Math.min(
      decision.createdAt.getTime() + PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS,
      authorization.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );
  const sortedDecisionResources = [...decision.resources].sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
  const expectedContextDigest = canonicalDigest({
    schema: "publishing-plan-validation-context/v1",
    decisionId: decision.id,
    workspaceId: decision.workspaceId,
    principalId: decision.principalId,
    keyId: decision.keyId,
    capability: "publishing_plan_revisions.create@1",
    authorizationContractDigest: decision.authorizationContractDigest,
    grantRevisionId: decision.grantRevisionId,
    policyRevisionId: decision.policyRevisionId,
    resources: sortedDecisionResources,
    issuedAt: decision.createdAt.toISOString(),
    expiresAt: contextExpiresAt.toISOString(),
  });
  if (
    authorization.principalStatus !== "active" ||
    authorization.principalRevokedAt !== null ||
    authorization.keyRevokedAt !== null ||
    (authorization.keyExpiresAt !== null && authorization.keyExpiresAt <= databaseNow) ||
    databaseNow >= contextExpiresAt ||
    databaseNow < session.issuedAt ||
    databaseNow >= session.expiresAt ||
    session.expiresAt > contextExpiresAt ||
    session.authorizationContext.authorizationContractDigest !==
      CREATE_AUTHORIZATION_CONTRACT_DIGEST ||
    session.authorizationContext.contextId !==
      `ppvc_${decision.id.replaceAll("-", "")}` ||
    session.authorizationContext.contextDigest !== expectedContextDigest ||
    session.authorizationContext.contextIssuedAt.getTime() !==
      decision.createdAt.getTime() ||
    session.authorizationContext.contextExpiresAt.getTime() !==
      contextExpiresAt.getTime() ||
    !exactAuthorizationResources(
      decision.resources,
      revision.definition.channelIds,
      revision.definition.artifactIds,
    )
  ) {
    return false;
  }

  const artifactRows = await tx
    .select({ artifact: artifacts, content: artifactContents })
    .from(artifacts)
    .innerJoin(
      artifactContents,
      and(
        eq(artifactContents.workspaceId, artifacts.workspaceId),
        eq(artifactContents.digest, artifacts.contentDigest),
      ),
    )
    .where(
      and(
        eq(artifacts.workspaceId, revision.workspaceId),
        inArray(artifacts.id, [...revision.definition.artifactIds].sort()),
      ),
    )
    .orderBy(asc(artifacts.id))
    .for("share");
  if (artifactRows.length !== revision.definition.artifactIds.length) return false;
  const artifactById = new Map(
    artifactRows.map((row) => [row.artifact.id, row] as const),
  );

  const channelRows = await tx
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, revision.workspaceId),
        inArray(socialAccounts.id, [...revision.definition.channelIds].sort()),
      ),
    )
    .orderBy(asc(socialAccounts.id))
    .for("share");
  if (channelRows.length !== revision.definition.channelIds.length) return false;
  const channelById = new Map(channelRows.map((row) => [row.id, row] as const));
  const capabilityVersion = publishingPlanLinkedInCapabilityVersion();

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-budget-spend:${revision.workspaceId}`}, 0))`,
  );
  const spendRows = await tx
    .select()
    .from(runtimeSpendControls)
    .where(eq(runtimeSpendControls.workspaceId, revision.workspaceId))
    .limit(1)
    .for("share");
  const suspended = spendRows[0]?.suspended ?? false;
  const policyStateDigest = publishingPlanPolicyStateDigest({
    identity: PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
    contractDigest: RUNTIME_POLICY_CONTRACT_DIGEST,
    workspaceId: revision.workspaceId,
    suspended,
  });
  if (
    evidence.runtimePolicy.identity !==
      PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
    evidence.runtimePolicy.contractDigest !== RUNTIME_POLICY_CONTRACT_DIGEST ||
    suspended
  ) {
    return false;
  }

  for (const [targetIndex, target] of revision.definition.targets.entries()) {
    const targetEvidence = evidence.targets[targetIndex];
    const sessionTarget = session.targets[targetIndex];
    const account = channelById.get(target.channelId);
    const authorKind = account
      ? readLinkedInAuthorKind(account.additionalSettings)
      : null;
    if (
      !targetEvidence?.channel ||
      !sessionTarget ||
      !account ||
      account.platform !== "linkedin" ||
      !authorKind ||
      account.disabled ||
      account.requiresReauth ||
      (account.tokenExpiresAt !== null &&
        account.tokenExpiresAt <= databaseNow &&
        !account.refreshTokenEncrypted) ||
      targetEvidence.channel.authorKind !== authorKind ||
      targetEvidence.channel.platform !== "linkedin" ||
      target.settings.type !== authorKind ||
      targetEvidence.channel.capabilityVersion !== capabilityVersion ||
      sessionTarget.policyStateDigest !== policyStateDigest ||
      targetEvidence.policyStateDigest !== policyStateDigest
    ) {
      return false;
    }
    const channelVersionDigest = publishingPlanChannelVersionDigest({
      id: account.id,
      workspaceId: account.workspaceId,
      platform: "linkedin",
      authorKind,
      disabled: account.disabled,
      requiresReauth: account.requiresReauth,
      tokenExpiresAt: account.tokenExpiresAt,
      hasRefreshToken: Boolean(account.refreshTokenEncrypted),
      updatedAt: account.updatedAt,
      capabilityVersion,
    });
    const channelSnapshotDigest = canonicalDigest({
      id: account.id,
      workspaceId: account.workspaceId,
      platform: "linkedin",
      authorKind,
      versionDigest: channelVersionDigest,
      state: "active",
      capabilityVersion,
      maxContentLength: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxContentLength,
      supportsImages: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.supportsImages,
      maxImages: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxImages,
    });
    if (
      sessionTarget.channelSnapshotDigest !== channelSnapshotDigest ||
      targetEvidence.channel.snapshotDigest !== channelSnapshotDigest
    ) {
      return false;
    }

    const targetArtifactIds = [
      target.contentArtifactId,
      ...target.mediaArtifactIds,
    ];
    if (
      targetEvidence.artifacts.length !== targetArtifactIds.length ||
      sessionTarget.artifactSnapshotDigests.length !== targetArtifactIds.length
    ) {
      return false;
    }
    for (const [artifactIndex, artifactId] of targetArtifactIds.entries()) {
      const row = artifactById.get(artifactId);
      const artifactEvidence = targetEvidence.artifacts[artifactIndex];
      if (
        !row ||
        !artifactEvidence ||
        row.artifact.deletedAt !== null ||
        artifactEvidence.id !== row.artifact.id ||
        artifactEvidence.digest !== row.artifact.contentDigest ||
        artifactEvidence.kind !== row.artifact.kind ||
        artifactEvidence.mediaType !== row.artifact.mediaType ||
        artifactEvidence.sizeBytes !== row.artifact.sizeBytes
      ) {
        return false;
      }
      const versionDigest = publishingPlanArtifactVersionDigest({
        id: row.artifact.id,
        workspaceId: row.artifact.workspaceId,
        digest: row.artifact.contentDigest,
        kind: row.artifact.kind as "text" | "image",
        mediaType: row.artifact.mediaType,
        sizeBytes: row.artifact.sizeBytes,
        width: row.content.width,
        height: row.content.height,
        createdAt: row.artifact.createdAt,
        deletedAt: row.artifact.deletedAt,
      });
      const snapshotDigest = canonicalDigest({
        id: row.artifact.id,
        workspaceId: row.artifact.workspaceId,
        digest: row.artifact.contentDigest,
        versionDigest,
        kind: row.artifact.kind,
        mediaType: row.artifact.mediaType,
        sizeBytes: row.artifact.sizeBytes,
        width: row.content.width,
        height: row.content.height,
        deletedAt: null,
      });
      if (
        artifactEvidence.snapshotDigest !== snapshotDigest ||
        sessionTarget.artifactSnapshotDigests[artifactIndex] !== snapshotDigest
      ) {
        return false;
      }
    }
  }
  // Resource and spend-control locks can block. Re-read the database clock
  // only after every current-state lock is held so a session, key, context, or
  // scheduled instant cannot expire while this transaction is waiting.
  const finalClockRows = await tx
    .select({ databaseNow: sql<unknown>`clock_timestamp()` })
    .from(agentAuthorizationDecisions)
    .where(eq(agentAuthorizationDecisions.id, decision.id))
    .limit(1);
  const finalDatabaseNow = finalClockRows[0]
    ? postgresDate(finalClockRows[0].databaseNow)
    : null;
  if (
    !finalDatabaseNow ||
    (authorization.keyExpiresAt !== null &&
      authorization.keyExpiresAt <= finalDatabaseNow) ||
    finalDatabaseNow >= contextExpiresAt ||
    finalDatabaseNow < session.issuedAt ||
    finalDatabaseNow >= session.expiresAt ||
    revision.definition.targets.some(
      (target) =>
        target.timing.kind === "scheduled" &&
        new Date(target.timing.publishAt) <= finalDatabaseNow,
    )
  ) {
    return false;
  }
  return true;
}

function receiptLock(input: {
  workspaceId: string;
  principalId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return JSON.stringify([
    "publishing-plan-receipt",
    input.workspaceId,
    input.principalId,
    input.capability,
    input.idempotencyKey,
  ]);
}

function planLock(input: { workspaceId: string; planId: string }): string {
  return JSON.stringify([
    "publishing-plan-head",
    input.workspaceId,
    input.planId,
  ]);
}

async function lockReceipt(
  tx: Tx,
  input: {
    workspaceId: string;
    principalId: string;
    capability: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; revisionId: string }
> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input)}, 0))`,
  );
  const rows = await tx
    .select()
    .from(runtimePublishingPlanMutationReceipts)
    .where(
      and(
        eq(runtimePublishingPlanMutationReceipts.workspaceId, input.workspaceId),
        eq(runtimePublishingPlanMutationReceipts.principalId, input.principalId),
        eq(runtimePublishingPlanMutationReceipts.capability, input.capability),
        eq(
          runtimePublishingPlanMutationReceipts.idempotencyKey,
          input.idempotencyKey,
        ),
      ),
    )
    .limit(1)
    .for("update");
  const found = rows[0];
  if (!found) return { kind: "absent" };
  return found.requestFingerprint === input.requestFingerprint
    ? { kind: "replayed", revisionId: found.revisionId }
    : { kind: "conflict" };
}

export function rehydratePublishingPlanRevision(
  row: typeof runtimePublishingPlanRevisions.$inferSelect,
): PublishingPlanRevisionRecord | null {
  if (
    !identifier.safeParse(row.id).success ||
    !identifier.safeParse(row.planId).success ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !digest.safeParse(row.definitionDigest).success
  ) {
    return null;
  }
  const payload = validPayload(row);
  if (
    !payload ||
    payload.evidenceDigest !== row.validationEvidenceDigest
  ) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    planId: row.planId,
    revision: row.revision,
    definitionDigest: row.definitionDigest,
    definition: payload.definition,
    validationEvidence: payload.evidence,
    authorPrincipalId: row.authorPrincipalId,
    authorKeyId: row.authorKeyId,
    creationAuthorizationEvidenceRef: row.creationAuthorizationEvidenceRef,
    createdAt: new Date(row.createdAt),
  };
}

async function findRevision(
  database: Db | Tx,
  input: { workspaceId: string; revisionId: string },
): Promise<PublishingPlanRevisionRecord | null> {
  const rows = await database
    .select()
    .from(runtimePublishingPlanRevisions)
    .where(
      and(
        eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId),
        eq(runtimePublishingPlanRevisions.id, input.revisionId),
      ),
    )
    .limit(1);
  return rows[0] ? rehydratePublishingPlanRevision(rows[0]) : null;
}

export class DrizzlePublishingPlanRepository
  implements PublishingPlanRepository
{
  constructor(private readonly getDatabase: () => Db) {}

  async readReceipt(
    input: Parameters<PublishingPlanRepository["readReceipt"]>[0],
  ) {
    const rows = await this.getDatabase()
      .select()
      .from(runtimePublishingPlanMutationReceipts)
      .where(
        and(
          eq(runtimePublishingPlanMutationReceipts.workspaceId, input.workspaceId),
          eq(runtimePublishingPlanMutationReceipts.principalId, input.principalId),
          eq(runtimePublishingPlanMutationReceipts.capability, input.capability),
          eq(
            runtimePublishingPlanMutationReceipts.idempotencyKey,
            input.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) return { kind: "absent" as const };
    return found.requestFingerprint === input.requestFingerprint
      ? {
          kind: "replayed" as const,
          revisionId: found.revisionId,
        }
      : { kind: "conflict" as const };
  }

  async createRevision(
    input: Parameters<PublishingPlanRepository["createRevision"]>[0],
  ): Promise<PublishingPlanCommitResult> {
    const payload = validPayload(input.revision);
    const session = payload
      ? validSessionBinding({
          session: input.validationSession,
          revision: input.revision,
          evidence: payload.evidence,
        })
      : null;
    if (
      !payload ||
      !session ||
      input.plan.workspaceId !== input.revision.workspaceId ||
      input.plan.id !== input.revision.planId ||
      input.plan.createdByPrincipalId !== input.revision.authorPrincipalId ||
      input.plan.createdByKeyId !== input.revision.authorKeyId ||
      input.plan.creationAuthorizationEvidenceRef !==
        input.revision.creationAuthorizationEvidenceRef ||
      input.receipt.workspaceId !== input.revision.workspaceId ||
      input.receipt.principalId !== input.revision.authorPrincipalId ||
      input.receipt.capability !== "publishing_plan_revisions.create@1" ||
      input.receipt.revisionId !== input.revision.id ||
      input.receipt.createdAt.getTime() !== input.revision.createdAt.getTime() ||
      (input.mode.kind === "new" && input.plan.currentRevision !== 0) ||
      (input.mode.kind === "edit" &&
        (!Number.isSafeInteger(input.mode.expectedRevision) ||
          input.mode.expectedRevision < 1))
    ) {
      return { kind: "unavailable" };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const receipt = await lockReceipt(tx, input.receipt);
        if (receipt.kind === "conflict") return { kind: "conflict" as const };
        if (receipt.kind === "replayed") {
          const revision = await findRevision(tx, {
            workspaceId: input.receipt.workspaceId,
            revisionId: receipt.revisionId,
          });
          return revision
            ? { kind: "replayed" as const, revision }
            : { kind: "unavailable" as const };
        }

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
            "publishing-plan-validation-session",
            session.workspaceId,
            session.id,
          ])}, 0))`,
        );
        const consumedSessions = await tx
          .select({
            revisionId: runtimePublishingPlanMutationReceipts.revisionId,
          })
          .from(runtimePublishingPlanMutationReceipts)
          .where(
            and(
              eq(
                runtimePublishingPlanMutationReceipts.workspaceId,
                session.workspaceId,
              ),
              eq(
                runtimePublishingPlanMutationReceipts.validationSessionId,
                session.id,
              ),
            ),
          )
          .limit(1)
          .for("update");
        if (consumedSessions[0]) {
          return { kind: "validation_expired" as const };
        }

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${planLock({
            workspaceId: input.revision.workspaceId,
            planId: input.revision.planId,
          })}, 0))`,
        );
        const planRows = await tx
          .select()
          .from(runtimePublishingPlans)
          .where(
            and(
              eq(runtimePublishingPlans.workspaceId, input.revision.workspaceId),
              eq(runtimePublishingPlans.id, input.revision.planId),
            ),
          )
          .limit(1)
          .for("update");
        let plan = planRows[0];
        if (input.mode.kind === "new" && plan) {
          return { kind: "plan_conflict" as const };
        }
        if (input.mode.kind === "edit") {
          if (!plan || plan.createdByPrincipalId !== input.revision.authorPrincipalId) {
            return { kind: "plan_conflict" as const };
          }
          if (plan.currentRevision !== input.mode.expectedRevision) {
            return { kind: "stale_revision" as const };
          }
        }
        if (!(await verifyCurrentCommitState(tx, {
          revision: input.revision,
          evidence: payload.evidence,
          session,
        }))) {
          return { kind: "validation_expired" as const };
        }
        if (!plan) {
          const inserted = await tx
            .insert(runtimePublishingPlans)
            .values({
              workspaceId: input.plan.workspaceId,
              id: input.plan.id,
              currentRevision: 0,
              createdByPrincipalId: input.plan.createdByPrincipalId,
              createdByKeyId: input.plan.createdByKeyId,
              creationAuthorizationEvidenceRef:
                input.plan.creationAuthorizationEvidenceRef,
              createdAt: input.plan.createdAt,
              updatedAt: input.plan.updatedAt,
            })
            .returning();
          plan = inserted[0];
        }
        if (!plan) throw new PublishingPlanPersistenceUnavailable();

        const storedRevision: PublishingPlanRevisionRecord = {
          ...input.revision,
          revision: plan.currentRevision + 1,
          definition: payload.definition,
          validationEvidence: payload.evidence,
        };
        await tx.insert(runtimePublishingPlanRevisions).values({
          ...storedRevision,
          validationEvidenceDigest: payload.evidenceDigest,
        });
        const advanced = await tx
          .update(runtimePublishingPlans)
          .set({
            currentRevision: storedRevision.revision,
            updatedAt: storedRevision.createdAt,
          })
          .where(
            and(
              eq(runtimePublishingPlans.workspaceId, storedRevision.workspaceId),
              eq(runtimePublishingPlans.id, storedRevision.planId),
              eq(runtimePublishingPlans.currentRevision, plan.currentRevision),
            ),
          )
          .returning({ id: runtimePublishingPlans.id });
        if (!advanced[0]) throw new PublishingPlanPersistenceUnavailable();
        await tx.insert(runtimePublishingPlanMutationReceipts).values({
          ...input.receipt,
          keyId: storedRevision.authorKeyId,
          authorizationEvidenceRef:
            storedRevision.creationAuthorizationEvidenceRef,
          planId: storedRevision.planId,
          revisionId: storedRevision.id,
          validationSessionId: session.id,
          validationSubmittedDraftDigest: session.submittedDraftDigest,
          validationDefinitionDigest: session.definitionDigest,
          validationCurrentStateDigest: session.currentStateDigest,
          validationIssuedAt: session.issuedAt,
          validationExpiresAt: session.expiresAt,
        });
        return { kind: "created" as const, revision: storedRevision };
      });
    } catch {
      return { kind: "unavailable" };
    }
  }

  getRevision(
    input: Parameters<PublishingPlanRepository["getRevision"]>[0],
  ) {
    return findRevision(this.getDatabase(), input);
  }

  async listRevisions(
    input: Parameters<PublishingPlanRepository["listRevisions"]>[0],
  ) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      return [];
    }
    const rows = await this.getDatabase()
      .select()
      .from(runtimePublishingPlanRevisions)
      .where(
        and(
          eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId),
          input.filters.planId
            ? eq(runtimePublishingPlanRevisions.planId, input.filters.planId)
            : undefined,
          input.before
            ? or(
                lt(runtimePublishingPlanRevisions.createdAt, input.before.createdAt),
                and(
                  eq(
                    runtimePublishingPlanRevisions.createdAt,
                    input.before.createdAt,
                  ),
                  lt(runtimePublishingPlanRevisions.id, input.before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(runtimePublishingPlanRevisions.createdAt),
        desc(runtimePublishingPlanRevisions.id),
      )
      .limit(input.limit);
    return rows.flatMap((row) => {
      const revision = rehydratePublishingPlanRevision(row);
      return revision ? [revision] : [];
    });
  }
}
