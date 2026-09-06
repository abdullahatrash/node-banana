import { NextResponse } from "next/server";
import { z } from "zod";
import { activateCampaignCommand, archiveCampaignCommand, CampaignRuntimeError, pauseCampaignCommand, previewCampaignCommand, resumeCampaignCommand } from "@/lib/product-surfaces/campaign-runtime";
import { validateCampaignAuthoringPayload } from "@/lib/product-surfaces/campaign-authoring";
import { saveCampaignDraftCommand } from "@/lib/product-surfaces/domain-commands";
import { campaignPayloadSchema } from "@/lib/product-surfaces/definitions";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_draft"), id: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().positive().optional(), title: z.string().trim().min(1).max(240), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.literal("activate"), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.literal("preview"), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("pause"), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.literal("resume"), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.enum(["archive", "discard"]), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict(),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/product-campaigns", action: "write", permission: "product:campaigns:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "CAMPAIGN_COMMAND_INVALID" }, { status: 400 });
  try {
    if (parsed.data.action === "preview") {
      const admission = await previewCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, authContextId: authz.authContextId, ...parsed.data });
      return NextResponse.json({ success: true, admission });
    }
    let record;
    if (parsed.data.action === "save_draft") {
      const payload = campaignPayloadSchema.parse({ ...parsed.data.payload, runtime: null });
      const validation = await validateCampaignAuthoringPayload({ workspaceId: authz.workspaceId, userId: authz.userId, payload, complete: false });
      if (validation.issues.length) throw new CampaignRuntimeError(validation.issues[0]!);
      record = await saveCampaignDraftCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    } else if (parsed.data.action === "activate") {
      record = await activateCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, authContextId: authz.authContextId, ...parsed.data });
    } else if (parsed.data.action === "pause") {
      record = await pauseCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    } else if (parsed.data.action === "resume") {
      record = await resumeCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    } else {
      record = await archiveCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data, discard: parsed.data.action === "discard" });
    }
    return record ? NextResponse.json({ success: true, record }, { status: parsed.data.action === "activate" ? 202 : 200 }) : NextResponse.json({ success: false, code: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (error instanceof CampaignRuntimeError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "CAMPAIGN_NOT_FOUND" ? 404 : error.code === "CAMPAIGN_REVISION_CONFLICT" ? 409 : 422 });
    if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "CAMPAIGN_CONFLICT" }, { status: 409 });
    throw error;
  }
});
