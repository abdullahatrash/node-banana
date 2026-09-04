import { NextResponse } from "next/server";
import { z } from "zod";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { CreatorPersonaError } from "@/lib/creator-personas/repository";

type Context = { params: Promise<{ personaId: string }> };
const querySchema = z.object({ purpose: z.enum(["generation", "content_set", "channel", "blitz"]), resourceId: z.string().min(1).max(200).nullable() });

export const GET = withStudioAuth<Context>({ route: "/api/studio/personas/[personaId]/reuse", action: "read", permission: "product:personas:read" }, async (request, authz, context) => {
  const parsed = querySchema.safeParse({ purpose: request.nextUrl.searchParams.get("purpose"), resourceId: request.nextUrl.searchParams.get("resourceId") });
  if (!parsed.success || (parsed.data.purpose !== "generation" && !parsed.data.resourceId)) return NextResponse.json({ success: false, code: "PERSONA_REUSE_QUERY_INVALID" }, { status: 400 });
  const { personaId } = await context.params;
  try {
    const binding = parsed.data.resourceId
      ? await CREATOR_PERSONAS.resolveUsage({ workspaceId: authz.workspaceId, personaId, purpose: parsed.data.purpose, resourceId: parsed.data.resourceId })
      : await CREATOR_PERSONAS.prepareUsage({ workspaceId: authz.workspaceId, personaId, purpose: "generation" });
    return NextResponse.json({ success: true, binding }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CreatorPersonaError) return NextResponse.json({ success: false, code: error.code }, { status: 409 });
    throw error;
  }
});
