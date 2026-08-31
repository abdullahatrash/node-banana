import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { authorizationContractDigestFor } from "@/lib/agent-tools/registry";
import { ARTIFACT_TEXT_MEDIA_TYPE } from "@/lib/agent-runtime/artifacts/validation";
import {
  PUBLISHING_PLAN_CAPABILITY_IDENTITIES,
  PUBLISHING_PLAN_CREATE_AUTHORIZATION,
  PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
} from "../capabilities";
import {
  InMemoryPublishingPlanArtifacts,
  InMemoryPublishingPlanChannels,
  InMemoryPublishingPlanRepository,
  InMemoryPublishingPlanRuntimePolicy,
  InMemoryPublishingPlanValidationContexts,
} from "../memory";
import { PublishingPlanRevisionService } from "../service";
import type { PublishingPlanDraft } from "../types";
import { PublishingPlanValidator } from "../validation";

export const NOW = new Date("2026-08-08T12:00:00.000Z");
export const CONTEXT_DIGEST = canonicalDigest({
  schema: "publishing-plan-context/v1",
  id: "context_1",
  workspaceId: "workspace_1",
  principalId: "principal_1",
});

export function publishingPlanDraft(): PublishingPlanDraft {
  return {
    schema: "publishing-plan-draft/v1",
    planId: "plan_1",
    channelIds: ["channel_linkedin"],
    artifactIds: ["artifact_text", "artifact_image"],
    targets: [
      {
        targetId: "target_1",
        channelId: "channel_linkedin",
        contentArtifactId: "artifact_text",
        mediaArtifactIds: ["artifact_image"],
        settings: { type: "person" },
        timing: { kind: "now" },
      },
    ],
  };
}

export function setupPublishingPlans() {
  const repository = new InMemoryPublishingPlanRepository();
  const artifacts = new InMemoryPublishingPlanArtifacts();
  const channels = new InMemoryPublishingPlanChannels();
  const contexts = new InMemoryPublishingPlanValidationContexts();
  const policy = new InMemoryPublishingPlanRuntimePolicy();
  const clock = { now: () => new Date(NOW) };
  artifacts.put({
    id: "artifact_text",
    workspaceId: "workspace_1",
    digest: canonicalDigest({ content: "Launch copy" }),
    versionDigest: canonicalDigest({ artifact: "artifact_text", version: 1 }),
    kind: "text",
    mediaType: ARTIFACT_TEXT_MEDIA_TYPE,
    sizeBytes: 11,
    width: null,
    height: null,
    inlineText: "Launch copy",
    deletedAt: null,
    observedAt: NOW,
  });
  artifacts.put({
    id: "artifact_image",
    workspaceId: "workspace_1",
    digest: canonicalDigest({ image: "opaque" }),
    versionDigest: canonicalDigest({ artifact: "artifact_image", version: 1 }),
    kind: "image",
    mediaType: "image/png",
    sizeBytes: 1024,
    width: 100,
    height: 100,
    inlineText: null,
    deletedAt: null,
    observedAt: NOW,
  });
  channels.put({
    id: "channel_linkedin",
    workspaceId: "workspace_1",
    platform: "linkedin",
    authorKind: "person",
    versionDigest: canonicalDigest({ channel: "channel_linkedin", version: 1 }),
    state: "active",
    capabilityVersion: canonicalDigest({ linkedinPublishing: 1 }),
    maxContentLength: 3_000,
    supportsImages: true,
    maxImages: 9,
    observedAt: NOW,
  });
  const resources = {
    channelIds: ["channel_linkedin"],
    artifactIds: ["artifact_image", "artifact_text"],
  };
  for (const authorizationEvidenceRef of [
    "otr_validate_evidence",
    "otr_publishing_plan_create",
  ]) {
    contexts.put({
      contextId: `context_validate_${authorizationEvidenceRef}`,
      contextDigest: canonicalDigest({ authorizationEvidenceRef, capability: "validate" }),
      workspaceId: "workspace_1",
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef,
      capability: "publishing_plan_revisions.validate@1",
      authorizationContractDigest: authorizationContractDigestFor(
        PUBLISHING_PLAN_CAPABILITY_IDENTITIES.validate,
        PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
      ),
      resources,
      issuedAt: new Date("2026-08-08T11:00:00.000Z"),
      expiresAt: new Date("2026-08-08T13:00:00.000Z"),
    });
  }
  for (const authorizationEvidenceRef of [
    "otr_creation_evidence",
    "otr_publishing_plan_create",
  ]) {
    contexts.put({
      contextId: `context_create_${authorizationEvidenceRef}`,
      contextDigest: canonicalDigest({ authorizationEvidenceRef, capability: "create" }),
      workspaceId: "workspace_1",
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef,
      capability: "publishing_plan_revisions.create@1",
      authorizationContractDigest: authorizationContractDigestFor(
        PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create,
        PUBLISHING_PLAN_CREATE_AUTHORIZATION,
      ),
      resources,
      issuedAt: new Date("2026-08-08T11:00:00.000Z"),
      expiresAt: new Date("2026-08-08T13:00:00.000Z"),
    });
  }
  const validator = new PublishingPlanValidator(
    artifacts,
    channels,
    policy,
    contexts,
    clock,
  );
  const service = new PublishingPlanRevisionService(
    repository,
    validator,
    clock,
  );
  repository.setValidationSessionVerifier((session) =>
    validator.verifySessionCurrent(session),
  );
  const effectiveResources = {
    channelIds: ["channel_linkedin"],
    credentialProfileIds: [],
    workflowIds: [],
    automationIds: [],
    artifactIds: ["artifact_text", "artifact_image"],
  };
  return {
    repository,
    artifacts,
    channels,
    contexts,
    policy,
    validator,
    service,
    clock,
    effectiveResources,
  };
}
