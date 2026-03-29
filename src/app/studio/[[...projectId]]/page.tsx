import { headers } from "next/headers";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/db";
import { ensurePersonalWorkspaceForUser, getProject } from "@/lib/studio/repository";
import { canUseS3Storage } from "@/lib/storage";
import { StudioClient } from "./StudioClient";

/**
 * Server Component for /studio and /studio/[projectId].
 *
 * - Fetches project data directly from DB (no API round-trip)
 * - Passes serializable initial data to the client component
 * - No useEffect for data fetching
 */

export interface InitialProjectData {
  id: string;
  name: string;
  workflowJson: Record<string, unknown> | null;
  sourceDirectoryPath: string | null;
}

export default async function StudioPage({
  params,
}: {
  params: Promise<{ projectId?: string[] }>;
}) {
  const { projectId: projectIdSegments } = await params;
  const projectId = projectIdSegments?.[0] ?? null;

  let initialProject: InitialProjectData | null = null;
  let loadError: string | null = null;

  // Only fetch on server if we have a projectId and DB is configured (cloud mode)
  if (projectId && isDatabaseConfigured() && canUseS3Storage()) {
    try {
      const reqHeaders = await headers();
      const user = await getAuthenticatedUserFromHeaders(reqHeaders);

      if (user) {
        const { workspaceId } = await ensurePersonalWorkspaceForUser({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
        });

        const project = await getProject(workspaceId, projectId);

        if (project) {
          initialProject = {
            id: project.id,
            name: project.name,
            workflowJson: project.workflowJson as Record<string, unknown> | null,
            sourceDirectoryPath: project.sourceDirectoryPath,
          };
        } else {
          loadError = "Project not found.";
        }
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load project.";
    }
  }

  return (
    <StudioClient
      projectId={projectId}
      initialProject={initialProject}
      loadError={loadError}
    />
  );
}
