import { NextResponse } from "next/server";

export function admittedGenerationRequired(surface: "media" | "text") {
  return NextResponse.json({
    success: false,
    code: "ADMITTED_GENERATION_REQUIRED",
    error: surface === "media"
      ? "Use the admitted Studio generation flow so Brand Profile, language, rights, exact price, budget reservation, region evidence, and operation status are pinned before provider work."
      : "Text providers are disabled until they implement the same admitted Generation Intent, authoritative budget reservation, provenance, and durable Operation contract.",
    next: surface === "media" ? "/api/studio/generations" : "/studio/model-routing",
  }, { status: 428, headers: { "Cache-Control": "no-store" } });
}
