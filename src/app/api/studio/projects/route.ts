import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { listProjects, upsertProject } from "@/lib/studio/repository";

interface ProjectsGetResponse {
  success: boolean;
  projects?: Awaited<ReturnType<typeof listProjects>>;
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

    const projects = await listProjects(authz.workspaceId);
    return NextResponse.json({
      success: true,
      projects,
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
