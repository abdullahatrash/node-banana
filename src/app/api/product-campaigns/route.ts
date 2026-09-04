import { NextResponse } from "next/server";
import { z } from "zod";
import { activateCampaignCommand, CampaignRuntimeError } from "@/lib/product-surfaces/campaign-runtime";
import { saveCampaignDraftCommand } from "@/lib/product-surfaces/domain-commands";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_draft"), id: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().positive().optional(), title: z.string().trim().min(1).max(240), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ action: z.literal("activate"), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict(),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/product-campaigns", action: "write", permission: "product:campaigns:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "CAMPAIGN_COMMAND_INVALID" }, { status: 400 });
  try {
    const record = parsed.data.action === "save_draft"
      ? await saveCampaignDraftCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
      : await activateCampaignCommand({ workspaceId: authz.workspaceId, userId: authz.userId, authContextId: authz.authContextId, ...parsed.data });
    return record ? NextResponse.json({ success: true, record }, { status: parsed.data.action === "activate" ? 202 : 200 }) : NextResponse.json({ success: false, code: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (error instanceof CampaignRuntimeError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "CAMPAIGN_NOT_FOUND" ? 404 : error.code === "CAMPAIGN_REVISION_CONFLICT" ? 409 : 422 });
    if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "CAMPAIGN_CONFLICT" }, { status: 409 });
    throw error;
  }
});
