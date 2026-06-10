import { NextRequest, NextResponse } from "next/server";
import { getProject, softDeleteProject, upsertProject } from "@/lib/studio/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

interface ProjectResponse {
  success: boolean;
  project?: Awaited<ReturnType<typeof getProject>>;
  error?: string;
}

interface ProjectPatchRequest {
  name?: string;
  description?: string | null;
  workflowJson?: Record<string, unknown> | null;
  sourceDirectoryPath?: string | null;
}

type ProjectIdContext = { params: Promise<{ projectId: string }> };

export const GET = withStudioAuth<ProjectIdContext>(
  { route: "/api/studio/projects/[projectId]", action: "read" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<ProjectResponse>> => {
    const { projectId } = await context.params;
    const project = await getProject(authz.workspaceId, projectId);
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      project,
    });
  },
);

export const PATCH = withStudioAuth<ProjectIdContext>(
  { route: "/api/studio/projects/[projectId]", action: "write" },
  async (
    request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<ProjectResponse>> => {
    const { projectId } = await context.params;
    const existing = await getProject(authz.workspaceId, projectId);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as ProjectPatchRequest;
    const resolvedName = body.name?.trim() || existing.name;

    const project = await upsertProject({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId,
      name: resolvedName,
      description:
        body.description === undefined ? existing.description : body.description,
      workflowJson:
        body.workflowJson === undefined
          ? ((existing.workflowJson as Record<string, unknown> | null) ?? null)
          : body.workflowJson,
      sourceDirectoryPath:
        body.sourceDirectoryPath === undefined
          ? existing.sourceDirectoryPath
          : body.sourceDirectoryPath,
    });

    return NextResponse.json({
      success: true,
      project,
    });
  },
);

export const DELETE = withStudioAuth<ProjectIdContext>(
  { route: "/api/studio/projects/[projectId]", action: "delete" },
  async (
    _request: NextRequest,
    authz,
    context,
  ): Promise<NextResponse<ProjectResponse>> => {
    const { projectId } = await context.params;
    const deleted = await softDeleteProject(authz.workspaceId, projectId);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      project: deleted,
    });
  },
);
