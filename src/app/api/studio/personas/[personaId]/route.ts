import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";

type Context = { params: Promise<{ personaId: string }> };
export const GET = withStudioAuth<Context>({ route: "/api/studio/personas/[personaId]", action: "read", permission: "product:personas:read" }, async (_request, authz, context) => {
  const { personaId } = await context.params;
  const result = await CREATOR_PERSONAS.get(authz.workspaceId, personaId);
  return result ? NextResponse.json({ success: true, result }) : NextResponse.json({ success: false, code: "PERSONA_NOT_FOUND" }, { status: 404 });
});
