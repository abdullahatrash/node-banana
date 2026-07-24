import { NextRequest, NextResponse } from "next/server";
import { countProjects, getProject, listProjects, upsertProject } from "@/lib/studio/repository";
import { MAX_PROJECTS_PER_WORKSPACE } from "@/lib/studio/constants";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import {
  InvalidWorkflowCredentialSlotsError,
  sanitizeWorkflowCredentialSlots,
} from "@/lib/studio/workflow-schema";

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

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/projects", action: "read" },
  async (_request: NextRequest, authz): Promise<NextResponse<ProjectsGetResponse>> => {
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
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/projects", action: "write" },
  async (request: NextRequest, authz): Promise<NextResponse<ProjectsPostResponse>> => {
    const body = (await request.json()) as ProjectsPostRequest;
    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { success: false, error: "Project name is required." },
        { status: 400 },
      );
    }

    // Enforce project limit: skip only for updates to projects that already exist in the DB
    const isExistingProject = body.projectId
      ? Boolean(await getProject(authz.workspaceId, body.projectId))
      : false;

    if (!isExistingProject) {
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

    let workflowJson: Record<string, unknown> | null;
    try {
      workflowJson = sanitizeWorkflowCredentialSlots(body.workflowJson || null);
    } catch (error) {
      if (!(error instanceof InvalidWorkflowCredentialSlotsError)) throw error;
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    const project = await upsertProject({
      workspaceId: authz.workspaceId,
      userId: authz.userId,
      projectId: body.projectId,
      name: body.name.trim(),
      description: body.description || null,
      workflowJson,
      sourceDirectoryPath: body.sourceDirectoryPath || null,
    });

    return NextResponse.json({
      success: true,
      project,
    });
  },
);
