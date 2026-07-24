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
  CAPABILITY_REGISTRY,
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

function traceRef(requestDigest: string): string {
  // Discovery performs no operational side effect, so a request-bound opaque
  // reference is sufficient and remains identical across thin transports.
  return `trace_${requestDigest.slice(7, 31)}`;
}

function toError(options: {
  capability: CapabilityIdentity | null;
  requestDigest: string;
  failure: CapabilityFailure;
  operatorTraceRef?: string;
}): CapabilityError {
  const response: CapabilityError = {
    type: "capability_error",
    capability: options.capability,
    requestDigest: options.requestDigest,
    code: options.failure.code,
    category: options.failure.category,
    message: options.failure.message,
    retryable: options.failure.retryable,
    operatorTraceRef:
      options.operatorTraceRef ?? traceRef(options.requestDigest),
  };
  if (options.failure.details) response.details = options.failure.details;
  if (options.failure.remediation) {
    response.remediation = options.failure.remediation;
  }
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
  ) {}

  async dispatch(
    invocation: CapabilityInvocation,
    context: CapabilityDispatchContext = {},
  ): Promise<CapabilityResponse> {
    const rawInput = invocation.input ?? {};
    const requestDigest = safeRequestDigest(invocation.capability, rawInput);
    const identity =
      typeof invocation.capability === "string"
        ? parseCapabilityIdentity(invocation.capability)
        : parseCapabilityIdentity(formatCapabilityIdentity(invocation.capability));

    if (!identity) {
      return toError({
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
      return toError({
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
      return toError({
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
      return toError({
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
      return toError({
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
      return toError({
        capability: identity,
        requestDigest,
        failure: new CapabilityFailure({
          code: "AGENT_AUTHENTICATION_FAILED",
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
        capability: identity,
        authorizationContractDigest: authorizationContractDigestFor(
          identity,
          registration.authorization,
        ),
        resources: extractedResources.resources,
        resourceExtractionValid: extractedResources.valid,
      });
    } catch {
      return toError({
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
      return toError({
        capability: identity,
        requestDigest: safeAuthorizationDigest,
        operatorTraceRef: admission.operatorTraceRef,
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
      });
      return {
        type: "capability_result",
        capability: identity,
        requestDigest,
        status: "completed",
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
      return toError({ capability: identity, requestDigest, failure });
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
