import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const body = z.object({ basis: z.enum(["owned","licensed","public_domain","consented"]), permittedRemix: z.enum(["reference_only","transform","derivative"]), evidenceRefs: z.array(z.string().min(1).max(200)).max(100), sourceUrls: z.array(z.string().url()).max(100) }).strict();
const stableId = (workspaceId: string, key: string) => `rights_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;

export const POST = withStudioAuth<undefined>({ route: "/api/studio/model-routing/rights-snapshots", action: "write" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key"); let raw: unknown = null; try { raw = await request.json(); } catch { /* invalid */ }
  const parsed = body.safeParse(raw);
  if (!key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId || !parsed.success || (parsed.data.basis !== "owned" && !parsed.data.evidenceRefs.length && !parsed.data.sourceUrls.length)) return noStoreJson({ success: false, code: "INVALID_RIGHTS_EVIDENCE" }, { status: 400 });
  const at = new Date(); const id = stableId(authz.workspaceId, key);
  const value: InspirationRightsSnapshot = { schema: "inspiration-rights-snapshot/v1", id, workspaceId: authz.workspaceId, revision: 1, ...parsed.data, digest: canonicalDigest(parsed.data) as `sha256:${string}`, createdByUserId: authz.userId, createdAt: at };
  const [stored] = await getDb().insert(inspirationRightsSnapshots).values({ workspaceId: authz.workspaceId, id, revision: 1, snapshot: value, digest: value.digest, basis: value.basis, permittedRemix: value.permittedRemix, createdByUserId: authz.userId, createdAt: at }).onConflictDoNothing().returning({ snapshot: inspirationRightsSnapshots.snapshot });
  if (stored) return noStoreJson({ success: true, snapshot: stored.snapshot });
  const [existing] = await getDb().select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, authz.workspaceId), eq(inspirationRightsSnapshots.id, id), eq(inspirationRightsSnapshots.revision, 1))).limit(1);
  if (!existing || existing.snapshot.digest !== value.digest) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  return noStoreJson({ success: true, snapshot: existing.snapshot });
});
