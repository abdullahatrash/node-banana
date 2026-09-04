import { NextRequest, NextResponse } from "next/server"
import { isDatabaseConfigured } from "@/lib/db"
import { AnalyticsObservationError } from "@/lib/product-surfaces/analytics-observation-policy"
import { PRODUCTION_ANALYTICS_OBSERVATIONS } from "@/lib/product-surfaces/analytics-observation-repository"
import { AnalyticsObservationService } from "@/lib/product-surfaces/analytics-observation-service"

const service = new AnalyticsObservationService(PRODUCTION_ANALYTICS_OBSERVATIONS)
const SOURCE_KEY_HEADER = "x-tasmeemai-source-key"

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !isDatabaseConfigured() || !await PRODUCTION_ANALYTICS_OBSERVATIONS.hasVerifiedWebsiteOrigin(origin)) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: cors(origin) })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  const sourceKey = request.headers.get(SOURCE_KEY_HEADER)
  if (!origin || !sourceKey || !isDatabaseConfigured()) return NextResponse.json({ success: false, code: "ANALYTICS_SOURCE_NOT_VERIFIED" }, { status: 403 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ success: false, code: "ANALYTICS_OBSERVATION_INVALID" }, { status: 400 }) }
  try {
    const result = await service.collectWebsite({ ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}), sourceKey }, origin)
    return NextResponse.json({ success: true, accepted: result.created, duplicate: !result.created, observedAt: result.observation.windowEndedAt.toISOString() }, { status: result.created ? 202 : 200, headers: cors(origin) })
  } catch (error) {
    if (error instanceof AnalyticsObservationError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "ANALYTICS_OBSERVATION_INVALID" ? 400 : 403 })
    throw error
  }
}

function cors(origin: string) {
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": `content-type, ${SOURCE_KEY_HEADER}`, "access-control-max-age": "600", vary: "Origin" }
}
