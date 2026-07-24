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
