import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";
import { derivePublicServiceStatus } from "@/lib/release-control/service";

export async function GET(request: NextRequest) {
  const locale = new URL(request.url).searchParams.get("locale") === "ar" ? "ar" : "en";
  const statusWorkspaceId = process.env.PUBLIC_STATUS_WORKSPACE_ID?.trim();
  if (!statusWorkspaceId) {
    return noStoreJson({
      success: true,
      configured: false,
      status: "unknown",
      incidents: [],
    });
  }
  if (!isDatabaseConfigured()) {
    return noStoreJson(
      { success: false, configured: true, status: "unknown", incidents: [] },
      { status: 503 },
    );
  }
  try {
    const incidents = await getReleaseControlService().publicIncidents(locale, statusWorkspaceId);
    return noStoreJson({ configured: true, success: true, status: derivePublicServiceStatus(incidents), incidents });
  } catch {
    return noStoreJson(
      { success: false, configured: true, status: "unknown", incidents: [] },
      { status: 503 },
    );
  }
}
