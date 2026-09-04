import "server-only";

import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  assets,
  brandProfiles,
  contentThemeRevisions,
  contentThemes,
  contentWorkflowRevisions,
  contentWorkflows,
  creatorPersonas,
  runtimePublishingApprovalAuthorityGrants,
  runtimePublishingApprovalAuthorityRevocations,
  socialAccounts,
  workspaceProductRecords,
} from "@/lib/db/schema";
import { configuredCatalog } from "@/lib/model-routing/catalog";
import { inspirationRightsEvidence } from "@/lib/model-routing/db-schema";
import { isCuratedContentThemeLicenseEvidence } from "./content-theme-catalog";
import { campaignPayloadSchema } from "./definitions";

type CampaignPayload = ReturnType<typeof campaignPayloadSchema.parse>;

export type CampaignSelectorOption = {
  id: string;
  label: string;
  detail: string | null;
};

export type CampaignWorkflowOption = CampaignSelectorOption & {
  workflowId: string;
  revisionId: string;
  revision: number;
  definitionDigest: string;
  inputs: Array<{ name: string; kind: "text" | "image"; required: boolean }>;
};

export type CampaignThemeOption = CampaignSelectorOption & {
  themeId: string;
  revision: number;
  digest: string;
};

export type CampaignGrantOption = CampaignSelectorOption & {
  channelId: string;
  expiresAt: string | null;
};

export type CampaignAuthoringOptions = {
  brand: { id: string; revision: number; digest: string; label: string } | null;
  inspirations: CampaignSelectorOption[];
  personas: CampaignSelectorOption[];
  demoAssets: CampaignSelectorOption[];
  mediaSets: CampaignSelectorOption[];
  themes: CampaignThemeOption[];
  channels: CampaignSelectorOption[];
  workflows: CampaignWorkflowOption[];
  modelPolicies: CampaignSelectorOption[];
  grants: CampaignGrantOption[];
};

function metadataLabel(metadata: Record<string, unknown> | null, fallback: string) {
  const candidate = metadata?.name ?? metadata?.fileName ?? metadata?.title;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
}

export async function loadCampaignAuthoringOptions(input: {
  workspaceId: string;
  userId: string;
  now?: Date;
}): Promise<CampaignAuthoringOptions> {
  const database = getDb();
  const now = input.now ?? new Date();
  const [records, personaRows, assetRows, channelRows, workflowRows, themeRows, brandRows, grantRows] = await Promise.all([
    database.select({ id: workspaceProductRecords.id, kind: workspaceProductRecords.kind, title: workspaceProductRecords.title, state: workspaceProductRecords.state, revision: workspaceProductRecords.revision })
      .from(workspaceProductRecords)
      .where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), isNull(workspaceProductRecords.archivedAt)))
      .orderBy(desc(workspaceProductRecords.updatedAt)),
    database.select({ id: creatorPersonas.id, name: creatorPersonas.name, revision: creatorPersonas.revision })
      .from(creatorPersonas)
      .where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.state, "active"), isNull(creatorPersonas.deletedAt)))
      .orderBy(desc(creatorPersonas.updatedAt)),
    database.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata })
      .from(assets).where(and(eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt))).orderBy(desc(assets.updatedAt)),
    database.select({ id: socialAccounts.id, platform: socialAccounts.platform, displayName: socialAccounts.displayName, username: socialAccounts.username })
      .from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false), eq(socialAccounts.requiresReauth, false))).orderBy(desc(socialAccounts.updatedAt)),
    database.select({ workflowId: contentWorkflows.id, revisionId: contentWorkflowRevisions.id, revision: contentWorkflowRevisions.revision, definitionDigest: contentWorkflowRevisions.definitionDigest, definition: contentWorkflowRevisions.definition })
      .from(contentWorkflows).innerJoin(contentWorkflowRevisions, and(eq(contentWorkflowRevisions.workspaceId, contentWorkflows.workspaceId), eq(contentWorkflowRevisions.workflowId, contentWorkflows.id), eq(contentWorkflowRevisions.revision, contentWorkflows.currentRevision)))
      .where(eq(contentWorkflows.workspaceId, input.workspaceId)).orderBy(desc(contentWorkflows.updatedAt)),
    database.select({ themeId: contentThemes.id, title: contentThemes.title, revision: contentThemeRevisions.revision, digest: contentThemeRevisions.documentDigest, licenseEvidenceIds: contentThemeRevisions.licenseEvidenceIds, licenseExpiresAt: contentThemeRevisions.licenseExpiresAt })
      .from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id), eq(contentThemeRevisions.revision, contentThemes.activeRevision)))
      .where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.state, "active"), isNull(contentThemes.archivedAt))).orderBy(desc(contentThemes.updatedAt)),
    database.select({ id: brandProfiles.id, revision: brandProfiles.revision, profile: brandProfiles.profile })
      .from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "active"))).limit(1),
    database.select({ grant: runtimePublishingApprovalAuthorityGrants, revokedId: runtimePublishingApprovalAuthorityRevocations.grantId })
      .from(runtimePublishingApprovalAuthorityGrants)
      .leftJoin(runtimePublishingApprovalAuthorityRevocations, and(eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId), eq(runtimePublishingApprovalAuthorityRevocations.grantId, runtimePublishingApprovalAuthorityGrants.id)))
      .where(and(eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId), eq(runtimePublishingApprovalAuthorityGrants.userId, input.userId), eq(runtimePublishingApprovalAuthorityGrants.action, "publish"), lte(runtimePublishingApprovalAuthorityGrants.issuedAt, now), isNull(runtimePublishingApprovalAuthorityRevocations.grantId)))
      .orderBy(desc(runtimePublishingApprovalAuthorityGrants.issuedAt)),
  ]);

  const labelRecord = (kind: string, states: readonly string[]) => records
    .filter((row) => row.kind === kind && states.includes(row.state))
    .map((row) => ({ id: row.id, label: row.title, detail: `v${row.revision}` }));
  const readyAssets = assetRows.filter((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null;
    return Boolean(row.checksum && metadata?.uploadState === "ready");
  }).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null;
    return { id: row.id, label: metadataLabel(metadata, row.id), detail: row.type };
  });
  const qualifiedModels = configuredCatalog(undefined, undefined, now).flatMap((model) => {
    const qualification = model.qualification;
    return qualification.status === "qualified" ? [{
      id: `${model.provider}:${model.model}@${qualification.version}#${qualification.inputSchemaDigest}`,
      label: model.label,
      detail: `${model.capabilities.join(" · ")} · ${qualification.inputSchemaDigest}`,
    }] : [];
  });
  const brand = brandRows[0]
    ? { id: brandRows[0].id, revision: brandRows[0].revision, digest: canonicalDigest(brandRows[0].profile), label: `v${brandRows[0].revision}` }
    : null;
  const themeLicenseIds = [...new Set(themeRows.flatMap((row) => Array.isArray(row.licenseEvidenceIds) ? row.licenseEvidenceIds : []))];
  const themeLicenseRows = themeLicenseIds.length ? await database.select({ id: inspirationRightsEvidence.id }).from(inspirationRightsEvidence).where(and(eq(inspirationRightsEvidence.workspaceId, input.workspaceId), inArray(inspirationRightsEvidence.id, themeLicenseIds), eq(inspirationRightsEvidence.basis, "licensed"), or(isNull(inspirationRightsEvidence.expiresAt), gt(inspirationRightsEvidence.expiresAt, now)))) : [];
  const currentThemeLicenseIds = new Set(themeLicenseRows.map((row) => row.id));

  return {
    brand,
    inspirations: labelRecord("inspiration_item", ["active", "saved"]),
    personas: personaRows.map((row) => ({ id: row.id, label: row.name, detail: `v${row.revision}` })),
    demoAssets: readyAssets,
    mediaSets: labelRecord("media_set", ["active"]),
    themes: themeRows.filter((row) => (!row.licenseExpiresAt || row.licenseExpiresAt > now) && Array.isArray(row.licenseEvidenceIds) && row.licenseEvidenceIds.length > 0 && row.licenseEvidenceIds.every((evidenceId) => currentThemeLicenseIds.has(evidenceId) || isCuratedContentThemeLicenseEvidence({ themeId: row.themeId, revision: row.revision, digest: row.digest, evidenceId }))).map((row) => ({ id: `${row.themeId}:${row.revision}`, themeId: row.themeId, revision: row.revision, digest: row.digest, label: row.title, detail: `v${row.revision}` })),
    channels: channelRows.map((row) => ({ id: row.id, label: row.displayName, detail: `${row.platform}${row.username ? ` · @${row.username}` : ""}` })),
    workflows: workflowRows.map((row) => ({
      id: row.revisionId,
      workflowId: row.workflowId,
      revisionId: row.revisionId,
      revision: row.revision,
      definitionDigest: row.definitionDigest,
      label: row.definition.name,
      detail: `v${row.revision}`,
      inputs: Object.entries(row.definition.inputs).map(([name, definition]) => ({ name, kind: definition.kind, required: definition.required })),
    })),
    modelPolicies: [{ id: "workspace-default", label: "Workspace default", detail: null }, ...qualifiedModels],
    grants: grantRows.filter((row) => !row.revokedId && (!row.grant.expiresAt || row.grant.expiresAt > now)).map((row) => ({ id: row.grant.id, label: row.grant.id, detail: row.grant.channelId, channelId: row.grant.channelId, expiresAt: row.grant.expiresAt?.toISOString() ?? null })),
  };
}

function duplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

export function campaignAuthoringIssues(payload: CampaignPayload, options: CampaignAuthoringOptions, complete: boolean): string[] {
  const issues = new Set<string>();
  const ids = (items: CampaignSelectorOption[]) => new Set(items.map((item) => item.id));
  const checkIds = (values: string[], allowed: Set<string>, code: string) => {
    if (duplicates(values) || values.some((value) => !allowed.has(value))) issues.add(code);
  };
  checkIds(payload.inspirationIds, ids(options.inspirations), "CAMPAIGN_INSPIRATION_INVALID");
  checkIds(payload.personaIds, ids(options.personas), "CAMPAIGN_PERSONA_INVALID");
  checkIds(payload.demoAssetIds, ids(options.demoAssets), "CAMPAIGN_DEMO_MEDIA_INVALID");
  checkIds(payload.mediaSetIds, ids(options.mediaSets), "CAMPAIGN_MEDIA_SET_INVALID");
  checkIds(payload.channelIds, ids(options.channels), "CAMPAIGN_CHANNEL_INVALID");
  const themeById = new Map(options.themes.map((item) => [item.id, item]));
  if (duplicates(payload.themeRevisionRefs.map((item) => `${item.themeId}:${item.revision}`)) || payload.themeRevisionRefs.some((item) => {
    const current = themeById.get(`${item.themeId}:${item.revision}`);
    return !current || current.digest !== item.digest;
  })) issues.add("CAMPAIGN_THEME_REVISION_INVALID");
  if (payload.brandProfileRef) {
    if (!options.brand || payload.brandProfileRef.id !== options.brand.id || payload.brandProfileRef.revision !== options.brand.revision || payload.brandProfileRef.digest !== options.brand.digest) issues.add("CAMPAIGN_BRAND_REVISION_INVALID");
  }
  if (!options.modelPolicies.some((item) => item.id === payload.execution.modelPolicy)) issues.add("CAMPAIGN_MODEL_POLICY_INVALID");
  if (payload.execution.workflow) {
    const workflow = options.workflows.find((item) => item.revisionId === payload.execution.workflow?.workflowRevisionId);
    if (!workflow || workflow.workflowId !== payload.execution.workflow.workflowId || duplicates(payload.execution.workflow.inputArtifactIds) || payload.execution.workflow.inputArtifactIds.some((id) => !ids(options.demoAssets).has(id))) issues.add("CAMPAIGN_WORKFLOW_BINDING_INVALID");
    if (workflow) {
      const expectedText = workflow.inputs.filter((item) => item.kind === "text");
      if (Object.keys(payload.execution.workflow.inputs).some((key) => !expectedText.some((item) => item.name === key)) || expectedText.some((item) => item.required && !payload.execution.workflow?.inputs[item.name]?.trim())) issues.add("CAMPAIGN_WORKFLOW_INPUTS_INVALID");
    }
  }
  if (payload.reviewMode === "evaluate_policy") {
    const grant = options.grants.find((item) => item.id === payload.autoPublishGrantId);
    if (!grant || payload.channelIds.length !== 1 || grant.channelId !== payload.channelIds[0]) issues.add("CAMPAIGN_GRANT_INVALID");
  } else if (payload.autoPublishGrantId) issues.add("CAMPAIGN_GRANT_INVALID");
  if (payload.cadence.startAt && payload.cadence.endAt && payload.cadence.startAt >= payload.cadence.endAt) issues.add("CAMPAIGN_DATE_RANGE_INVALID");
  if (payload.cadence.calendarCapacity < payload.cadence.postsPerWeek) issues.add("CAMPAIGN_CALENDAR_CAPACITY_INVALID");
  if (complete) {
    if (!payload.brandProfileRef) issues.add("CAMPAIGN_BRAND_REVISION_REQUIRED");
    if (payload.contentLanguage === "ar" && !payload.arabicVariety) issues.add("CAMPAIGN_ARABIC_VARIETY_REQUIRED");
    if (!payload.channelIds.length) issues.add("CAMPAIGN_CHANNEL_REQUIRED");
    if (!payload.execution.workflow) issues.add("CAMPAIGN_WORKFLOW_BINDING_REQUIRED");
  }
  return [...issues].sort();
}

export async function validateCampaignAuthoringPayload(input: {
  workspaceId: string;
  userId: string;
  payload: CampaignPayload;
  complete: boolean;
  now?: Date;
}) {
  const options = await loadCampaignAuthoringOptions(input);
  return { options, issues: campaignAuthoringIssues(input.payload, options, input.complete) };
}
