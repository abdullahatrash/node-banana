import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  publishingPlanDraft,
  setupPublishingPlans,
} from "./fixtures";

function validate(
  setup: ReturnType<typeof setupPublishingPlans>,
  candidate: unknown,
) {
  return setup.validator.validate({
    candidate,
    workspaceId: "workspace_1",
    principalId: "principal_1",
    authorizationContext: {
      keyId: "key_1",
      authorizationEvidenceRef: "otr_validate_evidence",
      capability: "publishing_plan_revisions.validate@1" as const,
    },
    effectiveResources: setup.effectiveResources,
  });
}

describe("PublishingPlanValidator", () => {
  it("normalizes multiple targets and records secret-safe non-authorizing evidence", async () => {
    const setup = setupPublishingPlans();
    const draft = publishingPlanDraft();
    draft.targets.push({
      ...structuredClone(draft.targets[0]!),
      targetId: "target_2",
      timing: {
        kind: "scheduled",
        scheduledAt: "2026-08-09T10:00:00+02:00",
      },
    });

    const result = await validate(setup, draft);

    expect(result.valid).toBe(true);
    expect(result.normalizedDefinition?.targets).toHaveLength(2);
    expect(result.normalizedDefinition?.targets[0]?.settings).toEqual({
      type: "person",
    });
    expect(result.normalizedDefinition?.targets[1]?.timing).toEqual({
      kind: "scheduled",
      publishAt: "2026-08-09T08:00:00.000Z",
    });
    expect(result.evidence?.authorizesExecution).toBe(false);
    expect(result.evidence?.submittedDraftDigest).not.toBe(
      result.evidence?.definitionDigest,
    );
    expect(result.normalizedDefinition).not.toHaveProperty("context");
    expect(result.evidence?.targets).toHaveLength(2);
    const serializedEvidence = JSON.stringify(result.evidence);
    expect(serializedEvidence).not.toContain("Launch copy");
    expect(serializedEvidence).not.toContain("credential");
    expect(serializedEvidence).not.toContain("token");
  });

  it("returns stable inaccessible-channel and missing-Artifact blockers", async () => {
    const setup = setupPublishingPlans();
    setup.effectiveResources.channelIds = [];
    setup.effectiveResources.artifactIds = ["artifact_text"];

    const result = await validate(setup, publishingPlanDraft());

    expect(result.blockers.map((item) => item.code)).toEqual([
      "CHANNEL_INACCESSIBLE",
      "ARTIFACT_MISSING",
    ]);
  });

  it("rejects invalid LinkedIn settings without silently defaulting them", async () => {
    const setup = setupPublishingPlans();
    const draft = publishingPlanDraft();
    draft.targets[0]!.settings = {
      type: "company",
      rawProviderPayload: "forbidden",
    };

    const result = await validate(setup, draft);

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: "SETTINGS_INVALID",
        targetId: "target_1",
      }),
    ]);
  });

  it("rejects client-authored context and trusts only the server resolver", async () => {
    const setup = setupPublishingPlans();
    const clientContext = {
      ...publishingPlanDraft(),
      context: {
        contextId: "forged",
        contextDigest: `sha256:${"f".repeat(64)}`,
        issuedAt: "2026-08-08T12:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    };

    await expect(validate(setup, clientContext)).resolves.toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "PUBLISHING_PLAN_DRAFT_INVALID" })],
    });
  });

  it("reports expired server contexts, past timing, media, and policy distinctly", async () => {
    const setup = setupPublishingPlans();
    setup.policy.block("target_1", ["EMERGENCY_SPEND_SUSPENDED"]);
    const draft = publishingPlanDraft();
    draft.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-08T11:59:00.000Z",
    };
    setup.channels.put({
      ...setup.channels.snapshots.values().next().value!,
      maxImages: 0,
    });

    const result = await validate(setup, draft);

    expect(result.blockers.map((item) => item.code)).toEqual([
      "MEDIA_INVALID",
      "TIMING_INVALID",
      "POLICY_BLOCKED",
    ]);
  });

  it("keeps late timing blockers in deterministic contract order", async () => {
    const setup = setupPublishingPlans();
    setup.policy.block("target_1", ["EMERGENCY_SPEND_SUSPENDED"]);
    setup.channels.put({
      ...setup.channels.snapshots.values().next().value!,
      maxImages: 0,
    });
    const draft = publishingPlanDraft();
    draft.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-08T12:00:30.000Z",
    };
    const clockValues = [
      new Date("2026-08-08T12:00:00.000Z"),
      new Date("2026-08-08T12:01:00.000Z"),
    ];
    setup.clock.now = () => clockValues.shift() ?? new Date(NaN);

    const result = await validate(setup, draft);

    expect(result.blockers.map((item) => item.code)).toEqual([
      "MEDIA_INVALID",
      "TIMING_INVALID",
      "POLICY_BLOCKED",
    ]);
    expect(result.evidence?.targets[0]?.blockerCodes).toEqual([
      "MEDIA_INVALID",
      "TIMING_INVALID",
      "POLICY_BLOCKED",
    ]);
  });

  it("returns CONTEXT_EXPIRED from missing server admission context", async () => {
    const setup = setupPublishingPlans();
    setup.contexts.snapshots.clear();

    await expect(validate(setup, publishingPlanDraft())).resolves.toMatchObject({
      valid: false,
      blockers: [expect.objectContaining({ code: "CONTEXT_EXPIRED" })],
    });
  });

  it("requires exact unique authorization manifests", async () => {
    const setup = setupPublishingPlans();
    const draft = publishingPlanDraft();
    draft.channelIds.push("channel_unused");
    draft.artifactIds.push("artifact_text");

    const result = await validate(setup, draft);

    expect(result.valid).toBe(false);
    expect(result.normalizedDefinition).toBeNull();
    expect(result.issues.map((item) => item.path)).toEqual([
      "artifactIds",
      "channelIds",
      "artifactIds",
    ]);
  });

  it("binds settings to the trusted LinkedIn author kind", async () => {
    const setup = setupPublishingPlans();
    const channel = setup.channels.snapshots.values().next().value!;
    setup.channels.put({
      ...channel,
      authorKind: "organization",
      versionDigest: canonicalDigest({ channel: channel.id, version: 2 }),
    });
    const explicitPerson = publishingPlanDraft();
    const derived = publishingPlanDraft();
    derived.targets[0]!.settings = {};

    await expect(validate(setup, explicitPerson)).resolves.toMatchObject({
      valid: false,
      blockers: [expect.objectContaining({ code: "SETTINGS_INVALID" })],
    });
    await expect(validate(setup, derived)).resolves.toMatchObject({
      valid: true,
      normalizedDefinition: {
        targets: [expect.objectContaining({ settings: { type: "organization" } })],
      },
    });
  });

  it("gates v1 to LinkedIn and binds the returned Channel ID", async () => {
    const setup = setupPublishingPlans();
    const channel = setup.channels.snapshots.values().next().value!;
    setup.channels.put({ ...channel, platform: "x" as "linkedin" });
    await expect(validate(setup, publishingPlanDraft())).resolves.toMatchObject({
      valid: false,
      blockers: [expect.objectContaining({ code: "CHANNEL_INACCESSIBLE" })],
    });

    setup.channels.snapshots.clear();
    setup.channels.snapshots.set("workspace_1\u0000channel_linkedin", {
      ...channel,
      id: "channel_other",
    });
    await expect(validate(setup, publishingPlanDraft())).resolves.toMatchObject({
      valid: false,
      blockers: [expect.objectContaining({ code: "CHANNEL_INACCESSIBLE" })],
    });
  });

  it("fails closed on malformed Artifact, context, and policy output", async () => {
    const setup = setupPublishingPlans();
    const artifact = setup.artifacts.snapshots.get(
      "workspace_1\u0000artifact_image",
    )!;
    setup.artifacts.put({ ...artifact, versionDigest: "not-a-digest" });
    await expect(validate(setup, publishingPlanDraft())).resolves.toMatchObject({
      blockers: [expect.objectContaining({ code: "ARTIFACT_MISSING" })],
    });

    const context = setup.contexts.snapshots.values().next().value!;
    setup.contexts.snapshots.clear();
    setup.contexts.put({
      ...context,
      authorizationContractDigest: `sha256:${"0".repeat(64)}`,
    });
    await expect(validate(setup, publishingPlanDraft())).resolves.toMatchObject({
      blockers: [expect.objectContaining({ code: "CONTEXT_EXPIRED" })],
    });

    const policySetup = setupPublishingPlans();
    policySetup.policy.evaluate = async () => ({
      allowed: true,
      reasonCodes: ["MALFORMED_ALLOWED_REASON"],
      evidenceDigest: canonicalDigest({ evidence: 1 }),
      stateDigest: canonicalDigest({ state: 1 }),
    });
    await expect(
      validate(policySetup, publishingPlanDraft()),
    ).resolves.toMatchObject({
      blockers: [expect.objectContaining({ code: "POLICY_BLOCKED" })],
    });
  });

  it("never echoes malicious adapter canaries through public validation evidence", async () => {
    const channelSetup = setupPublishingPlans();
    const channel = channelSetup.channels.snapshots.values().next().value!;
    channelSetup.channels.put({
      ...channel,
      capabilityVersion: "PASSWORD_SECRET_CANARY",
    });
    const channelResult = await validate(channelSetup, publishingPlanDraft());
    expect(channelResult.blockers).toEqual([
      expect.objectContaining({ code: "CHANNEL_INACCESSIBLE" }),
    ]);
    expect(JSON.stringify(channelResult)).not.toContain("PASSWORD_SECRET_CANARY");

    const artifactSetup = setupPublishingPlans();
    const image = artifactSetup.artifacts.snapshots.get(
      "workspace_1\u0000artifact_image",
    )!;
    artifactSetup.artifacts.put({
      ...image,
      mediaType: "image/passwordsecret",
    });
    const artifactResult = await validate(artifactSetup, publishingPlanDraft());
    expect(artifactResult.blockers).toEqual([
      expect.objectContaining({ code: "ARTIFACT_MISSING" }),
    ]);
    expect(JSON.stringify(artifactResult)).not.toContain("passwordsecret");

    const identitySetup = setupPublishingPlans();
    Object.defineProperty(identitySetup.policy, "identity", {
      value: "secret.password@1",
    });
    const identityResult = await validate(identitySetup, publishingPlanDraft());
    expect(identityResult.blockers).toEqual([
      expect.objectContaining({ code: "POLICY_BLOCKED" }),
    ]);
    expect(JSON.stringify(identityResult)).not.toContain("secret.password@1");

    const reasonSetup = setupPublishingPlans();
    reasonSetup.policy.evaluate = async () => ({
      allowed: false,
      reasonCodes: ["SECRET_PASSWORD_CANARY"],
      evidenceDigest: canonicalDigest({ evidence: 1 }),
      stateDigest: canonicalDigest({ state: 1 }),
    });
    const reasonResult = await validate(reasonSetup, publishingPlanDraft());
    expect(reasonResult.blockers).toEqual([
      expect.objectContaining({
        code: "POLICY_BLOCKED",
        details: { reasonCodes: ["POLICY_EVALUATION_UNAVAILABLE"] },
      }),
    ]);
    expect(JSON.stringify(reasonResult)).not.toContain("SECRET_PASSWORD_CANARY");
  });

  it("accepts canonical Artifact IDs containing dots and colons", async () => {
    const setup = setupPublishingPlans();
    const text = setup.artifacts.snapshots.get("workspace_1\u0000artifact_text")!;
    const image = setup.artifacts.snapshots.get("workspace_1\u0000artifact_image")!;
    setup.artifacts.snapshots.clear();
    setup.artifacts.put({ ...text, id: "artifact:text.v1" });
    setup.artifacts.put({ ...image, id: "artifact:image.v1" });
    const contexts = [...setup.contexts.snapshots.values()];
    setup.contexts.snapshots.clear();
    for (const context of contexts) {
      setup.contexts.put({
        ...context,
        resources: {
          channelIds: ["channel_linkedin"],
          artifactIds: ["artifact:image.v1", "artifact:text.v1"],
        },
      });
    }
    setup.effectiveResources.artifactIds = [
      "artifact:text.v1",
      "artifact:image.v1",
    ];
    const draft = publishingPlanDraft();
    draft.artifactIds = ["artifact:text.v1", "artifact:image.v1"];
    draft.targets[0]!.contentArtifactId = "artifact:text.v1";
    draft.targets[0]!.mediaArtifactIds = ["artifact:image.v1"];

    await expect(validate(setup, draft)).resolves.toMatchObject({ valid: true });
  });

  it("isolates mutable policy inputs and reads each repeated resource once", async () => {
    const setup = setupPublishingPlans();
    let channelReads = 0;
    let artifactReads = 0;
    const originalChannelRead = setup.channels.getCurrent.bind(setup.channels);
    const originalArtifactRead = setup.artifacts.getCurrent.bind(setup.artifacts);
    setup.channels.getCurrent = async (input) => {
      channelReads += 1;
      return originalChannelRead(input);
    };
    setup.artifacts.getCurrent = async (input) => {
      artifactReads += 1;
      return originalArtifactRead(input);
    };
    setup.policy.evaluate = async (input) => {
      input.evaluatedAt.setTime(0);
      return {
        allowed: true,
        reasonCodes: [],
        evidenceDigest: canonicalDigest({ targetId: input.target.targetId }),
        stateDigest: canonicalDigest({ policy: "stable" }),
      };
    };
    const draft = publishingPlanDraft();
    draft.targets.push({
      ...structuredClone(draft.targets[0]!),
      targetId: "target_2",
    });

    const result = await validate(setup, draft);

    expect(result.valid).toBe(true);
    expect(result.normalizedDefinition?.targets[0]?.timing.publishAt).toBe(
      "2026-08-08T12:00:00.000Z",
    );
    expect(channelReads).toBe(1);
    expect(artifactReads).toBe(2);
  });
});
