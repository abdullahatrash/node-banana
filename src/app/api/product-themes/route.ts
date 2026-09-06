import { NextResponse } from "next/server";
import { z } from "zod";
import { addCuratedContentTheme, archiveCuratedContentTheme, ContentThemeCatalogError, getWorkspaceRemixSummary } from "@/lib/product-surfaces/content-theme-catalog-repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), catalogId: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal("archive"), catalogId: z.string().trim().min(1).max(120) }).strict(),
]);

export const GET = withStudioAuth<undefined>({ route: "/api/product-themes", action: "read", permission: "product:read" }, async (_request, authz) => NextResponse.json({ success: true, data: await getWorkspaceRemixSummary(authz.workspaceId) }, { headers: { "Cache-Control": "private, no-store" } }));

export const POST = withStudioAuth<undefined>({ route: "/api/product-themes", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "CONTENT_THEME_COMMAND_INVALID" }, { status: 400 });
  try {
    const result = parsed.data.action === "add" ? await addCuratedContentTheme({ workspaceId: authz.workspaceId, userId: authz.userId, catalogId: parsed.data.catalogId }) : await archiveCuratedContentTheme({ workspaceId: authz.workspaceId, catalogId: parsed.data.catalogId });
    return NextResponse.json({ success: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ContentThemeCatalogError) return NextResponse.json({ success: false, code: error.code }, { status: error.code.endsWith("NOT_FOUND") ? 404 : 409 });
    throw error;
  }
});
