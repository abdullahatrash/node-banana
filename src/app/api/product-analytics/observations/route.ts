import { NextResponse } from "next/server"
import { AnalyticsObservationError } from "@/lib/product-surfaces/analytics-observation-policy"
import { PRODUCTION_ANALYTICS_OBSERVATIONS } from "@/lib/product-surfaces/analytics-observation-repository"
import { AnalyticsObservationService } from "@/lib/product-surfaces/analytics-observation-service"
import { withStudioAuth } from "@/lib/studio/withStudioAuth"

const service = new AnalyticsObservationService(PRODUCTION_ANALYTICS_OBSERVATIONS)

export const POST = withStudioAuth<undefined>({ route: "/api/product-analytics/observations", action: "write", permission: "product:analytics:write" }, async (request, authz) => {
  const credential = process.env.ANALYTICS_REFRESH_RECEIPT_SECRET?.trim()
  if (!credential) return NextResponse.json({ success: false, code: "ANALYTICS_RECEIPT_CREDENTIAL_UNAVAILABLE" }, { status: 503 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ success: false, code: "ANALYTICS_OBSERVATION_INVALID" }, { status: 400 }) }
  try {
    const result = await service.collectGeo(authz.workspaceId, body, credential)
    return NextResponse.json({ success: true, accepted: result.created, duplicate: !result.created, observation: result.observation }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof AnalyticsObservationError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "ANALYTICS_OBSERVATION_INVALID" ? 400 : 409 })
    throw error
  }
})
