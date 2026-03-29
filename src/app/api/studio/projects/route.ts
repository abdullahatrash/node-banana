import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { countProjects, listProjects, upsertProject } from "@/lib/studio/repository";
import { MAX_PROJECTS_PER_WORKSPACE } from "@/lib/studio/constants";

interface ProjectsGetResponse {
  success: boolean;
  projects?: Awaited<ReturnType<typeof listProjects>>;
  projectCount?: number;
  maxProjects?: number;
  error?: string;
}

interface ProjectsPostRequest {
  projectId?: string;
  name: string;
  description?: string;
  workflowJson?: Record<string, unknown>;
  sourceDirectoryPath?: string;
}

interface ProjectsPostResponse {
  success: boolean;
  project?: Awaited<ReturnType<typeof upsertProject>>;
  error?: string;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ProjectsGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use project persistence APIs.",
      },
      { status: 503 },
    );
  }

  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/projects",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const [projectsList, projectCount] = await Promise.all([
      listProjects(authz.workspaceId),
      countProjects(authz.workspaceId),
    ]);
    return NextResponse.json({
      success: true,
      projects: projectsList,
      projectCount,
      maxProjects: MAX_PROJECTS_PER_WORKSPACE,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list projects",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ProjectsPostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use project persistence APIs.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as ProjectsPostRequest;
    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { success: false, error: "Project name is required." },
        { status: 400 },
      );
    }

    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/projects",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    // Enforce project limit on new project creation (skip for updates to existing projects)
    if (!body.projectId) {
      const currentCount = await countProjects(authz.workspaceId);
      if (currentCount >= MAX_PROJECTS_PER_WORKSPACE) {
        return NextResponse.json(
          {
            success: false,
            error: `Project limit reached (${MAX_PROJECTS_PER_WORKSPACE}). Delete an existing project to create a new one.`,
          },
          { status: 403 },
        );
      }
    }

    const project = await upsertProject({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId: body.projectId,
      name: body.name.trim(),
      description: body.description || null,
      workflowJson: body.workflowJson || null,
      sourceDirectoryPath: body.sourceDirectoryPath || null,
    });

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save project",
      },
      { status: 500 },
    );
  }
}
