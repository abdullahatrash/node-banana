import { getActiveWorkspaceId } from "@/lib/studio/client";

const PRODUCT_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;

export class ProductRequestError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ProductRequestError";
    this.code = code;
    this.details = details;
  }
}

function responseErrorCode(result: Record<string, unknown>): string {
  return typeof result.code === "string" && PRODUCT_ERROR_CODE.test(result.code)
    ? result.code
    : "REQUEST_FAILED";
}

export async function productRequest(path: string, body: Record<string, unknown>, method = "POST") {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new ProductRequestError("WORKSPACE_REQUIRED");
  const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(body) });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.success !== true) throw new ProductRequestError(responseErrorCode(result), result);
  return result;
}
