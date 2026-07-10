import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { WorkflowFile } from "@/store/workflowStore";
import { ContentLevel, getPresetTemplate } from "@/lib/quickstart/templates";
import { buildQuickstartPrompt } from "@/lib/quickstart/prompts";
import {
  validateWorkflowJSON,
  repairWorkflowJSON,
  parseJSONFromResponse,
} from "@/lib/quickstart/validation";
import { ImageInputNodeData } from "@/types";
import { headers } from "next/headers";
import {
  resolveInferenceKey,
  isInferenceKeyError,
} from "@/lib/byok/resolveInferenceKey";

export const maxDuration = 60; // 1 minute timeout

/**
 * Build the base URL for fetching public assets.
 * Works both locally (localhost) and on Vercel (where fs.readFile can't access public/).
 */
function getBaseUrl(requestHeaders: Headers): string {
  const forwardedProto = requestHeaders.get("x-forwarded-proto") || "http";
  const host = requestHeaders.get("host") || "localhost:3000";
  return `${forwardedProto}://${host}`;
}

/**
 * Convert local image paths (e.g., /sample-images/model.jpg) to base64 data URLs.
 * Uses HTTP fetch instead of fs.readFile so it works on serverless platforms (Vercel)
 * where the public/ folder is served via CDN, not available on the filesystem.
 */
async function convertLocalImagesToBase64(
  workflow: WorkflowFile,
  baseUrl: string,
): Promise<WorkflowFile> {
  const updatedNodes = await Promise.all(
    workflow.nodes.map(async (node) => {
      if (node.type === "imageInput") {
        const data = node.data as ImageInputNodeData;
        if (data.image && data.image.startsWith("/sample-images/")) {
          try {
            const imageUrl = `${baseUrl}${data.image}`;
            const response = await fetch(imageUrl);
            if (!response.ok) {
              console.error(`Failed to fetch sample image: ${imageUrl} (${response.status})`);
              return node;
            }

            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");

            const ext = data.image.split(".").pop()?.toLowerCase() || "jpg";
            const mimeType = ext === "png" ? "image/png"
              : ext === "webp" ? "image/webp"
              : "image/jpeg";

            return {
              ...node,
              data: {
                ...data,
                image: `data:${mimeType};base64,${base64}`,
              },
            };
          } catch (error) {
            console.error(`Failed to convert image to base64: ${data.image}`, error);
            return node;
          }
        }
      }
      return node;
    })
  );

  return {
    ...workflow,
    nodes: updatedNodes,
  };
}

interface QuickstartRequest {
  description: string;
  contentLevel: ContentLevel;
  templateId?: string;
}

interface QuickstartResponse {
  success: boolean;
  workflow?: WorkflowFile;
  error?: string;
}

export async function POST(request: NextRequest) {
  const requestId = `qs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  console.log(`[Quickstart:${requestId}] New request received`);

  try {
    const body: QuickstartRequest = await request.json();
    const { description, contentLevel, templateId } = body;

    console.log(`[Quickstart:${requestId}] Parameters:`, {
      hasDescription: !!description,
      descriptionLength: description?.length || 0,
      contentLevel,
      templateId,
    });

    // If a preset template is selected, return it directly
    if (templateId) {
      console.log(`[Quickstart:${requestId}] Using preset template: ${templateId}`);
      try {
        const workflow = getPresetTemplate(templateId, contentLevel);
        // Convert any local image paths to base64 via HTTP fetch (works on Vercel)
        const requestHeaders = await headers();
        const baseUrl = getBaseUrl(requestHeaders);
        const workflowWithBase64 = await convertLocalImagesToBase64(workflow, baseUrl);
        console.log(`[Quickstart:${requestId}] Preset template loaded successfully`);
        return NextResponse.json<QuickstartResponse>({
          success: true,
          workflow: workflowWithBase64,
        });
      } catch (error) {
        console.error(`[Quickstart:${requestId}] Preset template error:`, error);
        return NextResponse.json<QuickstartResponse>(
          {
            success: false,
            error: error instanceof Error ? error.message : "Failed to load template",
          },
          { status: 400 }
        );
      }
    }

    // Validate description
    if (!description || typeof description !== "string" || description.trim().length < 3) {
      console.warn(`[Quickstart:${requestId}] Invalid description`);
      return NextResponse.json<QuickstartResponse>(
        {
          success: false,
          error: "Please provide a description of your workflow (at least 3 characters)",
        },
        { status: 400 }
      );
    }

    // BYOK: request header override → workspace vault → typed error. No env.
    const geminiApiKey = request.headers.get("X-Gemini-API-Key");
    const workspaceId = request.headers.get("x-workspace-id");
    const apiKey = await resolveInferenceKey({
      headerKey: geminiApiKey,
      workspaceId,
      provider: "gemini",
    });

    // Build the prompt
    const prompt = buildQuickstartPrompt(description.trim(), contentLevel);
    console.log(`[Quickstart:${requestId}] Prompt built, length: ${prompt.length}`);

    // Call Gemini API
    console.log(`[Quickstart:${requestId}] Calling Gemini API...`);
    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.3, // Lower for more consistent JSON output
        maxOutputTokens: 16384, // Increased for complex workflows with many nodes
      },
    });

    const duration = Date.now() - startTime;
    console.log(`[Quickstart:${requestId}] Gemini API response in ${duration}ms`);

    // Extract text from response
    const responseText = response.text;
    if (!responseText) {
      console.error(`[Quickstart:${requestId}] No text in Gemini response`);
      return NextResponse.json<QuickstartResponse>(
        {
          success: false,
          error: "No response from AI model",
        },
        { status: 500 }
      );
    }

    console.log(`[Quickstart:${requestId}] Response text length: ${responseText.length}`);

    // Parse JSON from response
    let parsedWorkflow: unknown;
    try {
      parsedWorkflow = parseJSONFromResponse(responseText);
      console.log(`[Quickstart:${requestId}] JSON parsed successfully`);
    } catch (error) {
      console.error(`[Quickstart:${requestId}] JSON parse error:`, error);
      console.error(`[Quickstart:${requestId}] Response text:`, responseText.substring(0, 500));
      return NextResponse.json<QuickstartResponse>(
        {
          success: false,
          error: "Failed to parse workflow from AI response. Please try again.",
        },
        { status: 500 }
      );
    }

    // Validate the workflow
    const validation = validateWorkflowJSON(parsedWorkflow);
    console.log(`[Quickstart:${requestId}] Validation result:`, {
      valid: validation.valid,
      errorCount: validation.errors.length,
    });

    // Repair if needed
    let workflow: WorkflowFile;
    if (!validation.valid) {
      console.log(`[Quickstart:${requestId}] Repairing workflow...`);
      validation.errors.forEach((err) => {
        console.log(`[Quickstart:${requestId}] Validation error: ${err.path} - ${err.message}`);
      });
      workflow = repairWorkflowJSON(parsedWorkflow);
      console.log(`[Quickstart:${requestId}] Workflow repaired`);
    } else {
      workflow = parsedWorkflow as WorkflowFile;
    }

    // Ensure the workflow has an ID
    if (!workflow.id) {
      workflow.id = `wf_${Date.now()}_quickstart`;
    }

    console.log(`[Quickstart:${requestId}] Success - nodes: ${workflow.nodes.length}, edges: ${workflow.edges.length}`);

    return NextResponse.json<QuickstartResponse>({
      success: true,
      workflow,
    });
  } catch (error) {
    console.error(`[Quickstart:${requestId}] Unexpected error:`, error);

    // No resolvable BYOK key: return a typed 4xx naming the provider and
    // pointing to Settings → Provider Keys — never a 500, never a leaked env
    // name. `error` mirrors `message` so the quickstart UI's error display shows it.
    if (isInferenceKeyError(error)) {
      return NextResponse.json(
        { success: false, error: error.message, ...error.toJSON() },
        { status: 401 }
      );
    }

    // Handle rate limiting
    if (error instanceof Error && error.message.includes("429")) {
      return NextResponse.json<QuickstartResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json<QuickstartResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate workflow",
      },
      { status: 500 }
    );
  }
}
