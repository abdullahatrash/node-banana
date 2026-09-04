import { NextResponse } from "next/server";
import { getDashboardReadModel } from "@/lib/product-surfaces/dashboard";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>({ route: "/api/product-copilot/context", action: "read" }, async (_request, authz) => {
  const model = await getDashboardReadModel(authz.workspaceId);
  return NextResponse.json({
    success: true,
    suggestion: { ...model.nextAction, generatedAt: model.generatedAt.toISOString() },
  });
});
