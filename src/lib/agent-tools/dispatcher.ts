import { ZodError } from "zod";
import type { AgentResourceRef } from "@/types/agentAuthorization";
import { canonicalDigest } from "./canonical";
import type {
  CapabilityAuthorizer,
  CapabilityDispatchContext,
  CapabilityError,
  CapabilityIdentity,
  CapabilityInvocation,
  CapabilityResponse,
  CapabilityWarning,
} from "./contracts";
import { CapabilityFailure } from "./errors";
import {
  authorizationContractDigestFor,
  type CapabilityRegistry,
} from "./registry";

const EXACT_IDENTITY =
  /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)@([1-9][0-9]*)$/;

export function formatCapabilityIdentity(identity: CapabilityIdentity): string {
  return `${identity.name}@${identity.version}`;
}

export function parseCapabilityIdentity(value: string): CapabilityIdentity | null {
  const match = EXACT_IDENTITY.exec(value);
  if (!match) return null;
  return { name: match[1], version: Number(match[2]) };
}

function safeRequestDigest(
  capability: CapabilityIdentity | string,
  input: unknown,
): string {
  try {
    return canonicalDigest({ capability, input });
  } catch {
    return canonicalDigest({ capability, input: "<non-canonical>" });
  }
}

export interface CapabilityDiagnosticEvent {
  workspaceId: string;
  category: "authorization" | "runtime";
  severity: "error";
  code: string;
  stage: "admission" | "execution";
  outcome: "failed" | "denied";
  providerFamily: "internal";
  httpStatus: null;
  retryable: boolean;
  durationMs: null;
  attempt: null;
  createdAt: Date;
}

export type CapabilityDiagnosticRecorder = (
  event: CapabilityDiagnosticEvent,
) => Promise<string | null>;

const SAFE_ERROR_CATEGORIES = new Set<CapabilityError["category"]>([
  "validation",
  "not_found",
  "lifecycle",
  "authorization",
  "approval",
  "conflict",
  "internal",
]);

const SAFE_ERROR_MESSAGES: Record<CapabilityError["category"], string> = {
  validation: "The capability request is invalid.",
  not_found: "The requested capability resource is unavailable.",
  lifecycle: "The requested capability version is unavailable.",
  authorization: "The capability request is not authorized.",
  approval: "The capability request requires approval.",
  conflict: "The capability request conflicts with current state.",
  internal: "The capability request could not be completed.",
};

function safeErrorMessage(
  category: CapabilityError["category"],
  capability: CapabilityIdentity | null,
): string {
  if (category === "authorization" && capability) {
    return `Capability ${formatCapabilityIdentity(capability)} is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.`;
  }
  return SAFE_ERROR_MESSAGES[category];
}

function safeRemediation(
  remediation: CapabilityFailure["remediation"],
): CapabilityError["remediation"] | undefined {
  if (
    !remediation ||
    typeof remediation.capability?.name !== "string" ||
    typeof remediation.capability?.version !== "number"
  ) return undefined;
  const capability = parseCapabilityIdentity(
    formatCapabilityIdentity(remediation.capability),
  );
  return capability ? { capability } : undefined;
}

async function toError(options: {
  capability: CapabilityIdentity | null;
  requestDigest: string;
  failure: CapabilityFailure;
  workspaceId?: string;
  stage?: "admission" | "execution";
  recorder?: CapabilityDiagnosticRecorder;
}): Promise<CapabilityError> {
  const safeCode =
    typeof options.failure.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(options.failure.code)
    ? options.failure.code
    : "CAPABILITY_FAILURE";
  const safeCategory = SAFE_ERROR_CATEGORIES.has(options.failure.category)
    ? options.failure.category
    : "internal";
  const safeRetryable =
    typeof options.failure.retryable === "boolean"
      ? options.failure.retryable
      : false;
  let operatorTraceRef: string | null = null;
  if (options.workspaceId && options.recorder) {
    try {
      const recorded = await options.recorder({
        workspaceId: options.workspaceId,
        category:
          safeCategory === "authorization"
            ? "authorization"
            : "runtime",
        severity: "error",
        code: safeCode,
        stage: options.stage ?? "admission",
        outcome:
          safeCategory === "authorization" ? "denied" : "failed",
        providerFamily: "internal",
        httpStatus: null,
        retryable: safeRetryable,
        durationMs: null,
        attempt: null,
        createdAt: new Date(),
      });
      if (recorded && /^otr_[a-f0-9]{32}$/.test(recorded)) {
        operatorTraceRef = recorded;
      }
    } catch {
      // Diagnostics are deliberately unable to replace the canonical error.
    }
  }
  const response: CapabilityError = {
    type: "capability_error",
    capability: options.capability,
    requestDigest: options.requestDigest,
    code: safeCode,
    category: safeCategory,
    message: safeErrorMessage(safeCategory, options.capability),
    retryable: safeRetryable,
    operatorTraceRef,
  };
  const remediation = safeRemediation(options.failure.remediation);
  if (remediation) response.remediation = remediation;
  return response;
}

function deprecatedWarning(
  identity: CapabilityIdentity,
  registry: CapabilityRegistry,
): CapabilityWarning[] {
  const lifecycle = registry.getDefinition(identity)?.lifecycle;
  if (lifecycle?.status !== "deprecated") return [];
  const warning: CapabilityWarning = {
    code: "CAPABILITY_VERSION_DEPRECATED",
    message: `Capability ${formatCapabilityIdentity(identity)} is deprecated.`,
  };
  if (lifecycle.replacement) warning.replacement = lifecycle.replacement;
  if (lifecycle.sunsetAt) warning.sunsetAt = lifecycle.sunsetAt;
  return [warning];
}

export class CapabilityDispatcher {
  constructor(
    readonly registry: CapabilityRegistry,
    private readonly authorizer: CapabilityAuthorizer,
    private readonly diagnosticRecorder?: CapabilityDiagnosticRecorder,
  ) {}

  async dispatch(
    invocation: CapabilityInvocation,
    context: CapabilityDispatchContext = {},
  ): Promise<CapabilityResponse> {
    const rawInput = invocation.input ?? {};
    const requestDigest = safeRequestDigest(invocation.capability, rawInput);
    const errorResponse = (
      options: Omit<
        Parameters<typeof toError>[0],
        "workspaceId" | "recorder"
      >,
    ) =>
      toError({
        ...options,
        workspaceId: context.securityContext?.workspaceId,
        recorder: this.diagnosticRecorder,
      });
    const identity =
      typeof invocation.capability === "string"
        ? parseCapabilityIdentity(invocation.capability)
        : parseCapabilityIdentity(formatCapabilityIdentity(invocation.capability));

    if (!identity) {
      return errorResponse({
        capability: null,
        requestDigest,
        failure: new CapabilityFailure({
          code: "CAPABILITY_IDENTITY_INVALID",
          category: "validation",
          message:
            "Capability invocation requires an exact identity such as capabilities.list@1; aliases such as latest are not executable.",
        }),
      });
    }

    const registration = this.registry.getRegistration(identity);
    if (!registration) {
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "CAPABILITY_NOT_FOUND",
          category: "not_found",
          message: `Capability ${formatCapabilityIdentity(identity)} is not published.`,
          details: { identity },
        }),
      });
    }

    if (registration.lifecycle.status === "retired") {
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "CAPABILITY_VERSION_RETIRED",
          category: "lifecycle",
          message: `Capability ${formatCapabilityIdentity(identity)} is retired and cannot execute.`,
          details: {
            identity,
            replacement: registration.lifecycle.replacement,
          },
          remediation: registration.lifecycle.replacement
            ? { capability: registration.lifecycle.replacement }
            : undefined,
        }),
      });
    }

    let input: unknown;
    try {
      input = registration.input.parse(rawInput);
    } catch (error) {
      const fields =
        error instanceof ZodError
          ? error.issues.map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
              message: issue.message,
            }))
          : undefined;
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "VALIDATION_FAILED",
          category: "validation",
          message: `Input for ${formatCapabilityIdentity(identity)} is invalid.`,
          details: fields ? { fields } : undefined,
        }),
      });
    }

    const definition = this.registry.getDefinition(identity);
    if (!definition) {
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "CAPABILITY_NOT_FOUND",
          category: "not_found",
          message: `Capability ${formatCapabilityIdentity(identity)} is not published.`,
        }),
      });
    }
    if (!context.securityContext) {
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
            code:
              (registration.audience ?? "agent") === "human"
                ? "HUMAN_CAPABILITY_NOT_AUTHORIZED"
                : "AGENT_AUTHENTICATION_FAILED",
          category: "authorization",
          message: "Agent authentication failed.",
        }),
      });
    }

    const extractedResources = extractAuthorizationResources(
      input,
      registration.authorization.resources,
    );
    let admission;
    try {
      admission = await this.authorizer.authorize({
        securityContext: context.securityContext,
        audience: registration.audience ?? "agent",
        capability: identity,
        authorizationContractDigest: authorizationContractDigestFor(
          identity,
          registration.authorization,
        ),
        resources: extractedResources.resources,
        resourceExtractionValid: extractedResources.valid,
        effect: registration.effect,
      });
    } catch {
      return errorResponse({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "AUTHORIZATION_ADMISSION_UNAVAILABLE",
          category: "internal",
          message:
            "Authorization admission could not be recorded. No capability effect was started.",
          retryable: true,
        }),
      });
    }
    if (!admission.allowed) {
      const safeAuthorizationDigest = canonicalDigest({
        capability: identity,
        input: "<authorization-redacted>",
      });
      return errorResponse({
        capability: identity,
        requestDigest: safeAuthorizationDigest,
        failure: new CapabilityFailure({
          code: admission.code ?? "CAPABILITY_NOT_AUTHORIZED",
          category: "authorization",
          message:
            admission.message ??
            "This Agent is not authorized to invoke the capability for the requested resources.",
        }),
      });
    }

    try {
      const output = await registration.handler(input, {
        ...context,
        registry: this.registry,
        authorizationAdmission: admission,
      });
      return {
        type: "capability_result",
        capability: identity,
        requestDigest,
        status:
          registration.effect.timing === "durable-async"
            ? "accepted"
            : "completed",
        output,
        warnings: deprecatedWarning(identity, this.registry),
      };
    } catch (error) {
      const failure =
        error instanceof CapabilityFailure
          ? error
          : new CapabilityFailure({
              code: "INTERNAL_ERROR",
              category: "internal",
              message: `Capability ${formatCapabilityIdentity(identity)} failed.`,
            });
      return errorResponse({
        capability: identity,
        requestDigest,
        failure,
        stage: "execution",
      });
    }
  }
}

function extractAuthorizationResources(
  input: unknown,
  selectors: Array<{
    kind: AgentResourceRef["kind"];
    inputPath: string;
  }>,
): { resources: AgentResourceRef[]; valid: boolean } {
  const resources: AgentResourceRef[] = [];
  let valid = true;
  for (const selector of selectors) {
    let value = input;
    for (const segment of selector.inputPath.split(".")) {
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[segment]
          : undefined;
    }
    const ids = Array.isArray(value) ? value : [value];
    if (
      ids.length === 0 ||
      ids.some((id) => typeof id !== "string" || id.trim().length === 0)
    ) {
      valid = false;
      continue;
    }
    for (const id of ids) {
      resources.push({
        kind: selector.kind,
        id: (id as string).trim(),
      });
    }
  }
  return { resources, valid };
}
