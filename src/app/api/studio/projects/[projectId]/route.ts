import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { resolveRequestContext } from "@/lib/server/requestContext";
import { getProject, softDeleteProject, upsertProject } from "@/lib/studio/repository";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<ProjectResponse>> {
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
    const context = await resolveRequestContext(request);
    const { projectId } = await params;
    const project = await getProject(context.workspaceId, projectId);
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load project",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<ProjectResponse>> {
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
    const context = await resolveRequestContext(request);
    const { projectId } = await params;
    const existing = await getProject(context.workspaceId, projectId);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as ProjectPatchRequest;
    const resolvedName = body.name?.trim() || existing.name;

    const project = await upsertProject({
      workspaceId: context.workspaceId,
      userId: context.userId,
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update project",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<ProjectResponse>> {
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
    const context = await resolveRequestContext(request);
    const { projectId } = await params;
    const deleted = await softDeleteProject(context.workspaceId, projectId);
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete project",
      },
      { status: 500 },
    );
  }
}

