import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";

export async function GET(request: NextRequest) {
  const locale = new URL(request.url).searchParams.get("locale") === "ar" ? "ar" : "en";
  const statusWorkspaceId = process.env.PUBLIC_STATUS_WORKSPACE_ID?.trim();
  if (!isDatabaseConfigured() || !statusWorkspaceId) return noStoreJson({ success: false, status: "unknown", incidents: [] }, { status: 503 });
  try {
    const incidents = await getReleaseControlService().publicIncidents(locale, statusWorkspaceId);
    return noStoreJson({ success: true, status: incidents.some((item) => item.status !== "resolved") ? "degraded" : "operational", incidents });
  } catch { return noStoreJson({ success: false, status: "unknown", incidents: [] }, { status: 503 }); }
}
