import { NextResponse } from "next/server"
import { listLibraryAssets } from "@/lib/product-surfaces/library-assets"
import { withStudioAuth } from "@/lib/studio/withStudioAuth"

export const GET = withStudioAuth<undefined>({ route: "/api/product-library/assets", action: "read", permission: "assets:read" }, async (request, authz) => {
  const result = await listLibraryAssets({
    workspaceId: authz.workspaceId,
    query: request.nextUrl.searchParams.get("q") ?? undefined,
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: 24,
    readyOnly: true,
  })
  return NextResponse.json({ success: true, ...result })
})
