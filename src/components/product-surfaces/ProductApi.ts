import { getActiveWorkspaceId } from "@/lib/studio/client";

export async function productRequest(path: string, body: Record<string, unknown>, method = "POST") {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new Error("WORKSPACE_REQUIRED");
  const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(body) });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.success !== true) throw new Error(typeof result.code === "string" ? result.code : typeof result.error === "string" ? result.error : "REQUEST_FAILED");
  return result;
}
