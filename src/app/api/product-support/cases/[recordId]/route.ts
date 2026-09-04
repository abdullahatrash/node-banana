import { NextResponse } from "next/server"
import { z } from "zod"
import { SupportCasePolicyError, transitionSupportCase } from "@/lib/product-support/cases"
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository"
import { withStudioAuth } from "@/lib/studio/withStudioAuth"

const bodySchema = z.object({ expectedRevision: z.number().int().positive(), state: z.enum(["waiting_customer", "investigating", "resolved", "closed"]), resolution: z.string().trim().max(5_000).default(""), idempotencyKey: z.string().trim().min(8).max(200) }).strict()

export const PATCH = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/product-support/cases/[recordId]", action: "write", permission: "product:support:submit" }, async (request, authz, context) => {
  const { recordId } = await context.params
  const parsed = bodySchema.safeParse(await request.json())
  if (!recordId || !parsed.success) return NextResponse.json({ success: false, code: "SUPPORT_CASE_COMMAND_INVALID" }, { status: 400 })
  try {
    const record = await transitionSupportCase({ workspaceId: authz.workspaceId, userId: authz.userId, actorRole: authz.role, recordId, ...parsed.data })
    if (!record) return NextResponse.json({ success: false, code: "SUPPORT_CASE_NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ success: true, record })
  } catch (error) {
    if (error instanceof SupportCasePolicyError) return NextResponse.json({ success: false, code: error.code }, { status: 403 })
    if (error instanceof ProductRecordConflictError) return NextResponse.json({ success: false, code: "SUPPORT_CASE_REVISION_CONFLICT" }, { status: 409 })
    if (error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "SUPPORT_CASE_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    throw error
  }
})
