import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { resolveWorkspaceMemberPermissions } from "@/lib/studio/authz";
import { COMMERCIAL } from "@/lib/commercial/production";
import type { CommercialStatusSummary } from "@/lib/commercial/summary";

export interface ProductShellWorkspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

export interface ProductShellContext {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
  workspaces: ProductShellWorkspace[];
  initialWorkspaceId: string | null;
  canReadBilling: boolean;
  initialCommercialStatus: CommercialStatusSummary | null;
}

export async function getProductShellContext(
  requestedPath: string,
): Promise<ProductShellContext> {
  const { session, aggregate } = await requireOnboardingComplete(requestedPath);
  const rows = await getDb()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, session.user.id),
        isNull(workspaces.deletedAt),
      ),
    );

  const authorizedWorkspaceId = aggregate?.session.workspaceId;
  const initialWorkspaceId = rows.some(
    (workspace) => workspace.id === authorizedWorkspaceId,
  )
    ? authorizedWorkspaceId ?? null
    : null;
  const permissions = initialWorkspaceId
    ? await resolveWorkspaceMemberPermissions({
        workspaceId: initialWorkspaceId,
        userId: session.user.id,
      })
    : [];

  const canReadBilling = permissions.includes("product:billing:read");
  const initialCommercialStatus = canReadBilling && initialWorkspaceId
    ? await COMMERCIAL.status(initialWorkspaceId)
    : null;

  return {
    user: {
      name: session.user.name || session.user.email || "",
      email: session.user.email,
      avatar: session.user.image || "",
    },
    workspaces: rows,
    initialWorkspaceId,
    canReadBilling,
    initialCommercialStatus,
  };
}
