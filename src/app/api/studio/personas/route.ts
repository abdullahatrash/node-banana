import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { createPersonaSchema } from "@/lib/creator-personas/schemas";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { CreatorPersonaError } from "@/lib/creator-personas/repository";

function failure(error: unknown) {
  if (error instanceof CreatorPersonaError) return NextResponse.json({ success: false, code: error.code }, { status: ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409 : 422 });
  throw error;
}

export const GET = withStudioAuth<undefined>({ route: "/api/studio/personas", action: "read", permission: "product:personas:read" }, async (request, authz) => {
  const beforeAt = request.nextUrl.searchParams.get("beforeAt");
  const beforeId = request.nextUrl.searchParams.get("beforeId");
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 30), 1), 100);
  const items = await CREATOR_PERSONAS.list(authz.workspaceId, { limit: limit + 1, before: beforeAt && beforeId ? { updatedAt: new Date(beforeAt), id: beforeId } : undefined });
  const page = items.slice(0, limit), last = page.at(-1);
  return NextResponse.json({ success: true, items: page, nextCursor: items.length > limit && last ? { updatedAt: last.updatedAt.toISOString(), id: last.id } : null });
});
export const POST = withStudioAuth<undefined>({ route: "/api/studio/personas", action: "write", permission: "product:personas:manage" }, async (request, authz) => {
  const parsed = createPersonaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_PERSONA", issues: parsed.error.issues }, { status: 400 });
  try {
    const { action: _action, retentionUntil, ...input } = parsed.data;
    const result = await CREATOR_PERSONAS.create({ ...input, retentionUntil: new Date(retentionUntil), workspaceId: authz.workspaceId, userId: authz.userId });
    return NextResponse.json({ success: true, result }, { status: 201 });
  } catch (error) { return failure(error); }
});
