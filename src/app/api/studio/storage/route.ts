import { NextResponse } from "next/server";
import { getWorkspaceStorageSummary } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/storage", action: "read", permission: "assets:read" },
  async (_request, authz) => NextResponse.json(
    { success: true, data: await getWorkspaceStorageSummary(authz.workspaceId) },
    { headers: { "Cache-Control": "private, no-store" } },
  ),
);
