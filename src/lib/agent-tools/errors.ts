/**
 * Structured, agent-friendly errors for the tool registry.
 *
 * Every failure an agent can hit is one of these codes and always carries a
 * `fix` — a plain-language next step — so an LLM harness can self-correct
 * instead of guessing. The same shape is surfaced across all three registry
 * surfaces (MCP, CLI, public API), so agents learn one error contract.
 */
export type ToolErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_output"
  | "internal";

export interface StructuredToolError {
  code: ToolErrorCode;
  message: string;
  /** What the caller should do next to succeed. */
  fix: string;
}

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly fix: string;

  constructor(args: { code: ToolErrorCode; message: string; fix: string }) {
    super(args.message);
    this.name = "ToolError";
    this.code = args.code;
    this.fix = args.fix;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, ToolError.prototype);
  }

  toStructured(): StructuredToolError {
    return { code: this.code, message: this.message, fix: this.fix };
  }
}

/** Narrow an unknown thrown value to its structured form for transport. */
export function toStructuredError(error: unknown): StructuredToolError {
  if (error instanceof ToolError) {
    return error.toStructured();
  }

  return {
    code: "internal",
    message: error instanceof Error ? error.message : "Unexpected tool failure.",
    fix: "Retry the request; if it persists, the server may be unavailable.",
  };
}
