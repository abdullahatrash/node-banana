import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";

export async function GET(request: NextRequest) {
  const locale = new URL(request.url).searchParams.get("locale") === "ar" ? "ar" : "en";
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, status: "unknown", incidents: [] }, { status: 503 });
  try {
    const incidents = await getReleaseControlService().publicIncidents(locale);
    return noStoreJson({ success: true, status: incidents.some((item) => item.status !== "resolved") ? "degraded" : "operational", incidents });
  } catch { return noStoreJson({ success: false, status: "unknown", incidents: [] }, { status: 503 }); }
}
