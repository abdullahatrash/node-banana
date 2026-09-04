import { NextResponse } from "next/server";
import { z } from "zod";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "@/lib/governance/region-enforcement";
import { BlitzSimilarityEvaluatorError } from "@/lib/product-surfaces/blitz-similarity-evaluator";
import { BlitzSimilarityServiceError, evaluateAndStoreBlitzSimilarity } from "@/lib/product-surfaces/blitz-similarity-service";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({ itemId: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), candidateAssetId: z.string().min(1).max(200) }).strict();
export const POST = withStudioAuth<undefined>({ route: "/api/blitz/similarity", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "BLITZ_SIMILARITY_REQUEST_INVALID" }, { status: 400 });
  try {
    await requireGovernanceRegionRoute({ workspaceId: authz.workspaceId, route: GOVERNANCE_REGION_ROUTES.assetStorage, configuredRegion: process.env.S3_REGION ?? process.env.APP_DATA_REGION });
    return NextResponse.json({ success: true, ...(await evaluateAndStoreBlitzSimilarity({ workspaceId: authz.workspaceId, ...parsed.data })) });
  } catch (error) {
    if (error instanceof BlitzSimilarityEvaluatorError || error instanceof BlitzSimilarityServiceError) return NextResponse.json({ success: false, code: error.code }, { status: error.code.endsWith("UNAVAILABLE") ? 503 : 422 });
    throw error;
  }
});
