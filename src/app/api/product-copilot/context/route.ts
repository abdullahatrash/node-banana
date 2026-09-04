import { NextResponse } from "next/server";
import { getProductCopilotContext } from "@/lib/product-surfaces/copilot-context";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>({ route: "/api/product-copilot/context", action: "read" }, async (_request, authz) => {
  const context = await getProductCopilotContext(authz.workspaceId);
  return NextResponse.json({
    success: true,
    ...context,
  });
});
