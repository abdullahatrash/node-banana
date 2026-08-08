import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { DrizzlePublishingPlanRepository } from "../postgres-repository";
import type {
  PublishingPlanMutationReceiptRecord,
  PublishingPlanRecord,
  PublishingPlanRevisionRecord,
  PublishingPlanSuccessfulValidationEvidence,
  PublishingPlanValidationSession,
} from "../types";
import { NOW, publishingPlanDraft, setupPublishingPlans } from "./fixtures";

function repositorySource(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "src/lib/agent-runtime/publishing-plans/postgres-repository.ts",
    ),
    "utf8",
  );
}

function repositoryReturning(row: Record<string, unknown>) {
  return new DrizzlePublishingPlanRepository(
    () =>
      ({
        select: () => {
          const query = {
            from: () => query,
            where: () => query,
            limit: async () => [row],
          };
          return query;
        },
      }) as never,
  );
}

async function validRecords(options?: {
  punctuatedArtifactIds?: boolean;
}): Promise<{
  plan: PublishingPlanRecord;
  revision: PublishingPlanRevisionRecord;
  receipt: PublishingPlanMutationReceiptRecord;
  mode: { kind: "new" };
  validationSession: PublishingPlanValidationSession;
}> {
  const setup = setupPublishingPlans();
  const fixtureChannel = [...setup.channels.snapshots.values()][0];
  if (!fixtureChannel) throw new Error("fixture Channel is required");
  setup.channels.put({
    ...fixtureChannel,
    capabilityVersion: canonicalDigest({ capability: "linkedin@1" }),
  });
  const draft = publishingPlanDraft();
  if (options?.punctuatedArtifactIds) {
    const text = setup.artifacts.snapshots.get(
      "workspace_1\u0000artifact_text",
    );
    const image = setup.artifacts.snapshots.get(
      "workspace_1\u0000artifact_image",
    );
    if (!text || !image) throw new Error("fixture Artifacts are required");
    setup.artifacts.snapshots.clear();
    setup.artifacts.put({ ...text, id: "artifact:text.v1" });
    setup.artifacts.put({ ...image, id: "artifact:image.v1" });
    for (const context of [...setup.contexts.snapshots.values()]) {
      setup.contexts.put({
        ...context,
        resources: {
          ...context.resources,
          artifactIds: ["artifact:image.v1", "artifact:text.v1"],
        },
      });
    }
    setup.effectiveResources.artifactIds = [
      "artifact:text.v1",
      "artifact:image.v1",
    ];
    draft.artifactIds = ["artifact:text.v1", "artifact:image.v1"];
    draft.targets[0]!.contentArtifactId = "artifact:text.v1";
    draft.targets[0]!.mediaArtifactIds = ["artifact:image.v1"];
  }
  const { result: validation, validationSession } =
    await setup.validator.validateForCommit({
      candidate: draft,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      effectiveResources: setup.effectiveResources,
      authorizationContext: {
        keyId: "key_1",
        authorizationEvidenceRef: "otr_creation_evidence",
        capability: "publishing_plan_revisions.create@1",
      },
    });
  if (
    !validation.definitionDigest ||
    !validation.normalizedDefinition ||
    !validation.evidence ||
    !validationSession
  ) {
    throw new Error("fixture must produce a valid Publishing Plan");
  }
  const revision: PublishingPlanRevisionRecord = {
    id: "ppr_1",
    workspaceId: "workspace_1",
    planId: "plan_1",
    revision: 0,
    definitionDigest: validation.definitionDigest,
    definition: validation.normalizedDefinition,
    validationEvidence:
      validation.evidence as PublishingPlanSuccessfulValidationEvidence,
    authorPrincipalId: "principal_1",
    authorKeyId: "key_1",
    creationAuthorizationEvidenceRef: "otr_creation_evidence",
    createdAt: new Date(NOW),
  };
  return {
    plan: {
      id: revision.planId,
      workspaceId: revision.workspaceId,
      currentRevision: 0,
      createdByPrincipalId: revision.authorPrincipalId,
      createdByKeyId: revision.authorKeyId,
      creationAuthorizationEvidenceRef:
        revision.creationAuthorizationEvidenceRef,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
    revision,
    receipt: {
      workspaceId: revision.workspaceId,
      principalId: revision.authorPrincipalId,
      capability: "publishing_plan_revisions.create@1",
      idempotencyKey: "publish-request-1",
      requestFingerprint: `sha256:${"a".repeat(64)}`,
      revisionId: revision.id,
      createdAt: new Date(NOW),
    },
    mode: { kind: "new" },
    validationSession,
  };
}

describe("Postgres Publishing Plan repository contract", () => {
  it("accepts canonical punctuated Artifact IDs through the transaction boundary", async () => {
    const records = await validRecords({ punctuatedArtifactIds: true });
    let transactionEntered = false;
    const repository = new DrizzlePublishingPlanRepository(
      () =>
        ({
          transaction: async () => {
            transactionEntered = true;
            throw new Error("stop after payload parsing");
          },
        }) as never,
    );

    await expect(repository.createRevision(records)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(transactionEntered).toBe(true);
    expect(records.revision.definition.artifactIds).toEqual([
      "artifact:text.v1",
      "artifact:image.v1",
    ]);
  });

  it("rejects cross-workspace mutations before opening a transaction", async () => {
    const records = await validRecords();
    let databaseAccesses = 0;
    const repository = new DrizzlePublishingPlanRepository(() => {
      databaseAccesses += 1;
      throw new Error("database must not be reached");
    });

    await expect(
      repository.createRevision({
        ...records,
        receipt: { ...records.receipt, workspaceId: "workspace_other" },
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      repository.createRevision({
        ...records,
        plan: { ...records.plan, id: "plan_other" },
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(databaseAccesses).toBe(0);
  });

  it("uses a short deterministic receipt-then-plan lock order", () => {
    const source = repositorySource();
    const create = source.slice(
      source.indexOf("async createRevision("),
      source.indexOf("\n  getRevision("),
    );

    expect(create).toContain(".transaction(async (tx)");
    expect(create).toContain("lockReceipt(tx, input.receipt)");
    expect(create).toContain("publishing-plan-validation-session");
    expect(create).toContain("planLock({");
    expect(create.indexOf("lockReceipt(tx, input.receipt)")).toBeLessThan(
      create.indexOf("planLock({"),
    );
    expect(create).toContain(".from(runtimePublishingPlans)");
    expect(create).toContain('.for("update")');
    expect(create).toContain("revision: plan.currentRevision + 1");
    expect(create).toContain('input.mode.kind === "new" && plan');
    expect(create).toContain('input.mode.kind === "edit"');
    expect(create).toContain("plan.createdByPrincipalId !== input.revision.authorPrincipalId");
    expect(create).toContain("plan.currentRevision !== input.mode.expectedRevision");
    expect(create).toContain('{ kind: "plan_conflict" as const }');
    expect(create).toContain('{ kind: "stale_revision" as const }');
    expect(create.indexOf("tx.insert(runtimePublishingPlanRevisions)")).toBeLessThan(
      create.indexOf(".update(runtimePublishingPlans)"),
    );
    expect(create.indexOf(".update(runtimePublishingPlans)")).toBeLessThan(
      create.indexOf("tx.insert(runtimePublishingPlanMutationReceipts)"),
    );
  });

  it("rechecks server authorization and every current-state token in the transaction", () => {
    const source = repositorySource();
    const verify = source.slice(
      source.indexOf("async function verifyCurrentCommitState("),
      source.indexOf("function receiptLock("),
    );

    for (const table of [
      "agentAuthorizationDecisions",
      "agentPrincipals",
      "agentKeys",
      "artifacts",
      "artifactContents",
      "socialAccounts",
      "runtimeSpendControls",
    ]) {
      expect(verify).toContain(table);
    }
    expect(verify).toContain("CREATE_AUTHORIZATION_CONTRACT_DIGEST");
    expect(verify).toContain("exactAuthorizationResources(");
    expect(verify).toContain('authorization.principalStatus !== "active"');
    expect(verify).toContain("authorization.keyRevokedAt !== null");
    expect(verify).toContain("databaseNow >= session.expiresAt");
    expect(verify).toContain("publishingPlanArtifactVersionDigest(");
    expect(verify).toContain("publishingPlanChannelVersionDigest(");
    expect(verify).toContain("publishingPlanPolicyStateDigest(");
    expect(verify).toContain("runtime-budget-spend:");
    expect(verify.match(/\.for\("share"\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(verify).toContain("clock_timestamp()");
    expect(verify.lastIndexOf("clock_timestamp()")).toBeGreaterThan(
      verify.indexOf("runtime-budget-spend:"),
    );
    expect(verify).toContain("finalDatabaseNow >= contextExpiresAt");
    expect(verify).toContain("finalDatabaseNow >= session.expiresAt");
    expect(verify).toContain("authorization.keyExpiresAt <= finalDatabaseNow");
    expect(verify).toContain('target.timing.kind === "scheduled"');
    expect(verify).toContain(
      "new Date(target.timing.publishAt) <= finalDatabaseNow",
    );
    expect(verify).toContain(
      'targetEvidence.channel.platform !== "linkedin"',
    );
    expect(verify).toContain("target.settings.type !== authorKind");
  });

  it("serializes receipt replay and distinguishes fingerprint conflict", () => {
    const source = repositorySource();
    const lock = source.slice(
      source.indexOf("async function lockReceipt("),
      source.indexOf("function mapRevision("),
    );

    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain('.for("update")');
    for (const field of [
      "workspaceId",
      "principalId",
      "capability",
      "idempotencyKey",
    ]) {
      expect(lock).toContain(`runtimePublishingPlanMutationReceipts.${field}`);
    }
    expect(lock).toContain(
      "found.requestFingerprint === input.requestFingerprint",
    );
    expect(lock).toContain('{ kind: "conflict" }');
    expect(lock).toContain('{ kind: "replayed", revisionId: found.revisionId }');
  });

  it("uses workspace-isolated tuple keyset pagination", () => {
    const source = repositorySource();
    const list = source.slice(source.indexOf("async listRevisions("));

    expect(list).toContain(
      "eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId)",
    );
    expect(list).toContain(
      "eq(runtimePublishingPlanRevisions.planId, input.filters.planId)",
    );
    expect(list).toContain(
      "lt(runtimePublishingPlanRevisions.createdAt, input.before.createdAt)",
    );
    expect(list).toContain(
      "lt(runtimePublishingPlanRevisions.id, input.before.id)",
    );
    expect(list).toContain("desc(runtimePublishingPlanRevisions.createdAt)");
    expect(list).toContain("desc(runtimePublishingPlanRevisions.id)");
    expect(list).not.toMatch(/offset\s*\(/i);
  });

  it("rehydrates only closed, digest-bound, unexpired records", () => {
    const source = repositorySource();
    const mapping = source.slice(
      source.indexOf("const normalizedDefinition"),
      source.indexOf("function receiptLock("),
    );

    expect(mapping.match(/\.strict\(\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(mapping).toContain("canonicalDigest(definition) !== input.definitionDigest");
    expect(mapping).toContain("canonicalDigest(evidence)");
    expect(mapping).toContain("authorizesExecution: z.literal(false)");
    expect(mapping).toContain("input.createdAt.getTime() >= expiresAt");
    expect(mapping).toContain("return null");
  });

  it("rejects malformed LinkedIn settings, Channel evidence, and policy identity", async () => {
    const records = await validRecords();
    const base = {
      ...records.revision,
      revision: 1,
      validationEvidenceDigest: canonicalDigest(
        records.revision.validationEvidence,
      ),
    };
    await expect(
      repositoryReturning(base).getRevision({
        workspaceId: base.workspaceId,
        revisionId: base.id,
      }),
    ).resolves.not.toBeNull();

    type MutableRow = {
      [key: string]: unknown;
      definitionDigest: string;
      validationEvidenceDigest: string;
      definition: {
        targets: Array<{ settings: Record<string, unknown> }>;
      };
      validationEvidence: {
        definitionDigest: string;
        context: { authorizationContractDigest: string };
        runtimePolicy: { identity: string; contractDigest: string };
        targets: Array<{
          channel: {
            platform: string;
            authorKind: string;
            capabilityVersion: string;
          };
          artifacts: Array<{ id: string; kind: string; mediaType: string }>;
          settingsDigest: string;
        }>;
      };
    };
    const malformedRows: MutableRow[] = [];

    const unsupportedPlatform = structuredClone(base) as unknown as MutableRow;
    unsupportedPlatform.validationEvidence.targets[0]!.channel.platform = "x";
    unsupportedPlatform.validationEvidenceDigest = canonicalDigest(
      unsupportedPlatform.validationEvidence,
    );
    malformedRows.push(unsupportedPlatform);

    const openSettings = structuredClone(base) as unknown as MutableRow;
    openSettings.definition.targets[0]!.settings = {
      type: "person",
      unsupported: true,
    };
    openSettings.definitionDigest = canonicalDigest(openSettings.definition);
    openSettings.validationEvidence.definitionDigest =
      openSettings.definitionDigest;
    openSettings.validationEvidence.targets[0]!.settingsDigest = canonicalDigest(
      openSettings.definition.targets[0]!.settings,
    );
    openSettings.validationEvidenceDigest = canonicalDigest(
      openSettings.validationEvidence,
    );
    malformedRows.push(openSettings);

    const authorMismatch = structuredClone(base) as unknown as MutableRow;
    authorMismatch.definition.targets[0]!.settings = { type: "organization" };
    authorMismatch.definitionDigest = canonicalDigest(authorMismatch.definition);
    authorMismatch.validationEvidence.definitionDigest =
      authorMismatch.definitionDigest;
    authorMismatch.validationEvidence.targets[0]!.settingsDigest =
      canonicalDigest(authorMismatch.definition.targets[0]!.settings);
    authorMismatch.validationEvidenceDigest = canonicalDigest(
      authorMismatch.validationEvidence,
    );
    malformedRows.push(authorMismatch);

    const wrongPolicy = structuredClone(base) as unknown as MutableRow;
    wrongPolicy.validationEvidence.runtimePolicy.identity = "other-policy@1";
    wrongPolicy.validationEvidence.runtimePolicy.contractDigest =
      canonicalDigest({ contract: "other" });
    wrongPolicy.validationEvidenceDigest = canonicalDigest(
      wrongPolicy.validationEvidence,
    );
    malformedRows.push(wrongPolicy);

    const wrongAuthorizationContract = structuredClone(
      base,
    ) as unknown as MutableRow;
    wrongAuthorizationContract.validationEvidence.context.authorizationContractDigest =
      canonicalDigest({ authorization: "different" });
    wrongAuthorizationContract.validationEvidenceDigest = canonicalDigest(
      wrongAuthorizationContract.validationEvidence,
    );
    malformedRows.push(wrongAuthorizationContract);

    const malformedCapability = structuredClone(base) as unknown as MutableRow;
    malformedCapability.validationEvidence.targets[0]!.channel.capabilityVersion =
      "not-a-digest";
    malformedCapability.validationEvidenceDigest = canonicalDigest(
      malformedCapability.validationEvidence,
    );
    malformedRows.push(malformedCapability);

    const mismatchedMedia = structuredClone(base) as unknown as MutableRow;
    const contentEvidence =
      mismatchedMedia.validationEvidence.targets[0]!.artifacts.find(
        (artifact) => artifact.id === "artifact_text",
      )!;
    contentEvidence.kind = "image";
    contentEvidence.mediaType = "image/png";
    mismatchedMedia.validationEvidenceDigest = canonicalDigest(
      mismatchedMedia.validationEvidence,
    );
    malformedRows.push(mismatchedMedia);

    for (const row of malformedRows) {
      await expect(
        repositoryReturning(row).getRevision({
          workspaceId: base.workspaceId,
          revisionId: base.id,
        }),
      ).resolves.toBeNull();
    }
  });
});
