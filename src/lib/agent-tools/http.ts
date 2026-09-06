import { NextResponse } from "next/server";

import { toStructuredError, type ToolErrorCode } from "./errors";

const STATUS_BY_CODE: Record<ToolErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_output: 500,
  // A workflow references a node type the server runner does not support yet.
  unsupported_node: 422,
  // No provider key was supplied (header pass-through) for a node that needs one.
  byok_key_missing: 400,
  unavailable: 503,
  internal: 500,
};

/**
 * Map any error thrown by `runTool` to an HTTP response for the public API v1
 * wrappers. The structured `{ code, message, fix }` body is preserved verbatim
 * so REST, MCP, and CLI callers all see the same actionable error contract.
 */
export function toolErrorResponse(
  error: unknown,
): NextResponse<{ success: false; error: ReturnType<typeof toStructuredError> }> {
  const structured = toStructuredError(error);
  return NextResponse.json(
    { success: false, error: structured },
    { status: STATUS_BY_CODE[structured.code] },
  );
}
