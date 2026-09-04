import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb } from "@/lib/db";
import { modelTextOutputReceipts } from "@/lib/model-routing/db-schema";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const idSchema = z.string().regex(/^text_[a-f0-9]{32}$/);

export const GET = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/copy/outputs/[outputId]", action: "read" }, async (request: NextRequest, authz, context) => {
  const outputId = idSchema.safeParse((await context.params).outputId);
  if (!outputId.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const [output] = await getDb().select({ id: modelTextOutputReceipts.id, content: modelTextOutputReceipts.content, contentDigest: modelTextOutputReceipts.contentDigest }).from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, authz.workspaceId), eq(modelTextOutputReceipts.id, outputId.data))).limit(1);
  return output ? noStoreJson({ success: true, output }) : noStoreJson({ success: false, code: "NOT_FOUND" }, { status: 404 });
});
