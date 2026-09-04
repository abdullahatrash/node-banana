import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { brandProfiles } from "@/lib/db/schema";
import { getDashboardReadModel } from "@/lib/product-surfaces/dashboard";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>({ route: "/api/product-copilot/context", action: "read" }, async (_request, authz) => {
  const activeProfile = await getDb().select({ id: brandProfiles.id }).from(brandProfiles).where(and(eq(brandProfiles.workspaceId, authz.workspaceId), eq(brandProfiles.status, "active"))).limit(1);
  const model = await getDashboardReadModel(authz.workspaceId, activeProfile.length > 0);
  return NextResponse.json({
    success: true,
    suggestion: { ...model.nextAction, generatedAt: model.generatedAt.toISOString() },
  });
});
