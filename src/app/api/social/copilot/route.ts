import { NextRequest, NextResponse } from "next/server";
import { withApiPermission } from "@/lib/studio/authz";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await withApiPermission(request, {
    route: "/api/social/copilot",
    permission: "social:view",
  });
  if (!auth.authorized) {
    return auth.response;
  }

  return NextResponse.json({
    success: false,
    code: "SOCIAL_COPILOT_ADMITTED_GENERATION_UNAVAILABLE",
    error: "Social Copilot is unavailable until its Brand-aware admitted text adapter is qualified. \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0627\u062c\u062a\u0645\u0627\u0639\u064a \u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u062d\u062a\u0649 \u0627\u0639\u062a\u0645\u0627\u062f \u0645\u0648\u0635\u0644 \u0646\u0635\u064a \u0622\u0645\u0646 \u0648\u0645\u062f\u0631\u0643 \u0644\u0644\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u062a\u062c\u0627\u0631\u064a\u0629.",
    nextAction: { code: "inspect_model_routing", href: "/studio/model-routing" },
  }, { status: 503 });
}
