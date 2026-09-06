import type {
  CapabilityErrorCategory,
  CapabilityIdentity,
} from "./contracts";

export class CapabilityFailure extends Error {
  readonly code: string;
  readonly category: CapabilityErrorCategory;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly remediation?: {
    capability: CapabilityIdentity;
    input?: Record<string, unknown>;
  };

  constructor(options: {
    code: string;
    category: CapabilityErrorCategory;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
    remediation?: {
      capability: CapabilityIdentity;
      input?: Record<string, unknown>;
    };
  }) {
    super(options.message);
    this.name = "CapabilityFailure";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.remediation = options.remediation;
  }
}

export type ToolErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_output"
  | "unsupported_node"
  | "byok_key_missing"
  | "unavailable"
  | "internal";

export interface StructuredToolError {
  code: ToolErrorCode;
  message: string;
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
    Object.setPrototypeOf(this, ToolError.prototype);
  }

  toStructured(): StructuredToolError {
    return { code: this.code, message: this.message, fix: this.fix };
  }
}

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
