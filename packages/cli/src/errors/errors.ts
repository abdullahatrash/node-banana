/**
 * Process exit codes, part of the CLI's contract with scripts and CI:
 *  - 0  success
 *  - 1  the API rejected the request (auth, permission, not found, server)
 *  - 2  the invocation itself was wrong (bad flag, missing arg, not logged in)
 */
export const EXIT_OK = 0;
export const EXIT_API_ERROR = 1;
export const EXIT_USAGE = 2;

/** Base for every error the CLI raises deliberately; carries its exit code. */
export abstract class CliError extends Error {
  abstract readonly exitCode: number;
}

/**
 * A misuse of the CLI itself — unknown command, bad flag, or "not logged in".
 * Distinct from an API failure so CI can tell a broken invocation (exit 2) from
 * a rejected request (exit 1).
 */
export class UsageError extends CliError {
  readonly exitCode = EXIT_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
    Object.setPrototypeOf(this, UsageError.prototype);
  }
}

/**
 * A failure returned by the public API. Wraps both error shapes the API emits:
 * the structured `{ code, message, fix }` from registry-backed routes and the
 * bare `{ error: string }` from the workspaces route (code/fix then absent).
 */
export class ApiError extends CliError {
  readonly exitCode = EXIT_API_ERROR;
  readonly code: string | undefined;
  readonly fix: string | undefined;

  constructor(fields: {
    code?: string | undefined;
    message: string;
    fix?: string | undefined;
  }) {
    super(fields.message);
    this.name = "ApiError";
    this.code = fields.code;
    this.fix = fields.fix;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Render any thrown value as a human-readable message for stderr. A structured
 * {@link ApiError} gains `code:` and `fix:` lines so an operator (or agent)
 * sees the actionable next step; everything else collapses to one line.
 */
export function renderError(error: unknown): string {
  if (error instanceof ApiError) {
    const lines = [`Error: ${error.message}`];
    if (error.code) lines.push(`  code: ${error.code}`);
    if (error.fix) lines.push(`  fix:  ${error.fix}`);
    return lines.join("\n");
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return `Error: ${String(error)}`;
}
