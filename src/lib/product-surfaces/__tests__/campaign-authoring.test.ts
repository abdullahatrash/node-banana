import { describe, expect, it } from "vitest";
import { campaignAuthoringIssues, type CampaignAuthoringOptions } from "../campaign-authoring";
import { campaignPayloadSchema } from "../definitions";

const digest = `sha256:${"a".repeat(64)}`;
const options: CampaignAuthoringOptions = {
  brand: { id: "brand_1", revision: 3, digest, label: "v3" },
  inspirations: [{ id: "inspiration_1", label: "Reference", detail: "v1" }],
  personas: [{ id: "persona_1", label: "Presenter", detail: "v4" }],
  demoAssets: [{ id: "asset_1", label: "Demo", detail: "video" }],
  mediaSets: [{ id: "set_1", label: "Products", detail: "v2" }],
  themes: [{ id: "theme_1:2", themeId: "theme_1", revision: 2, digest, label: "Seasonal", detail: "v2" }],
  channels: [{ id: "channel_1", label: "TikTok", detail: "tiktok" }],
  workflows: [{ id: "workflow_revision_1", workflowId: "workflow_1", revisionId: "workflow_revision_1", revision: 2, definitionDigest: digest, label: "Publish", detail: "v2", inputs: [{ name: "brief", kind: "text", required: true }, { name: "source", kind: "image", required: false }] }],
  modelPolicies: [{ id: "workspace-default", label: "Workspace default", detail: null }],
  grants: [{ id: "grant_1", channelId: "channel_1", expiresAt: null, label: "Grant", detail: "channel_1" }],
};

function payload() {
  return campaignPayloadSchema.parse({
    currentStep: 10,
    name: "Arabic launch",
    formatMix: { slideshow: 60, video_hook_demo: 40 },
    remixRatio: 50,
    inspirationIds: ["inspiration_1"],
    brandProfileRef: { id: "brand_1", revision: 3, digest },
    contentLanguage: "ar",
    arabicVariety: "gulf",
    personaIds: ["persona_1"],
    demoAssetIds: ["asset_1"],
    mediaSetIds: ["set_1"],
    themeRevisionRefs: [{ themeId: "theme_1", revision: 2, digest }],
    channelIds: ["channel_1"],
    variantsPerChannel: 2,
    cadence: { timezone: "Asia/Riyadh", weekStart: 0, startAt: "2026-09-10T00:00:00.000Z", endAt: "2026-10-10T00:00:00.000Z", postsPerWeek: 3, calendarCapacity: 20 },
    execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000, workflow: { workflowId: "workflow_1", workflowRevisionId: "workflow_revision_1", inputs: { brief: "Launch" }, inputArtifactIds: ["asset_1"] } },
    reviewMode: "evaluate_policy",
    autoPublishGrantId: "grant_1",
    validationErrors: [],
  });
}

describe("campaign authoring authority", () => {
  it("admits only an exact complete workspace-backed campaign", () => {
    expect(campaignAuthoringIssues(payload(), options, true)).toEqual([]);
  });

  it("fails closed for stale references, duplicate Assets, and a mismatched Grant", () => {
    const requested = payload();
    requested.brandProfileRef = { ...requested.brandProfileRef!, revision: 2 };
    requested.execution.workflow!.inputArtifactIds = ["asset_1", "asset_1"];
    requested.channelIds = ["missing_channel"];
    expect(campaignAuthoringIssues(requested, options, true)).toEqual(expect.arrayContaining([
      "CAMPAIGN_BRAND_REVISION_INVALID",
      "CAMPAIGN_CHANNEL_INVALID",
      "CAMPAIGN_GRANT_INVALID",
      "CAMPAIGN_WORKFLOW_BINDING_INVALID",
    ]));
  });

  it("allows incomplete provisional drafts but blocks incomplete activation", () => {
    const requested = payload();
    requested.brandProfileRef = null;
    requested.channelIds = [];
    requested.execution.workflow = null;
    requested.reviewMode = "request_human";
    requested.autoPublishGrantId = null;
    expect(campaignAuthoringIssues(requested, options, false)).toEqual([]);
    expect(campaignAuthoringIssues(requested, options, true)).toEqual(expect.arrayContaining([
      "CAMPAIGN_BRAND_REVISION_REQUIRED",
      "CAMPAIGN_CHANNEL_REQUIRED",
      "CAMPAIGN_WORKFLOW_BINDING_REQUIRED",
    ]));
  });
});
