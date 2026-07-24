import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  formatCapabilityIdentity,
  parseCapabilityIdentity,
  type CapabilityDispatcher,
} from "@/lib/agent-tools/dispatcher";
import type {
  CapabilityDispatcherPort,
  CapabilityInvocation,
  CapabilityResponse,
} from "@/types/capabilities";
import { AgentAuthError, type AgentAuthService } from "./service";

export interface AgentSecurityContextResolver {
  resolve(): Promise<Awaited<ReturnType<AgentAuthService["authenticateAgentKey"]>>>;
}

export class AgentKeySecurityContextResolver
  implements AgentSecurityContextResolver
{
  constructor(
    private readonly agentKey: string | null | undefined,
    private readonly service: AgentAuthService,
  ) {}

  resolve() {
    return this.service.authenticateAgentKey(this.agentKey);
  }
}

export class AgentAuthenticatedCapabilityDispatcher
  implements CapabilityDispatcherPort
{
  constructor(
    private readonly dispatcher: CapabilityDispatcher,
    private readonly resolver: AgentSecurityContextResolver,
  ) {}

  async dispatch(
    invocation: CapabilityInvocation,
  ): Promise<CapabilityResponse> {
    try {
      const securityContext = await this.resolver.resolve();
      return this.dispatcher.dispatch(invocation, { securityContext });
    } catch (error) {
      if (!(error instanceof AgentAuthError)) throw error;
      const identity =
        typeof invocation.capability === "string"
          ? parseCapabilityIdentity(invocation.capability)
          : invocation.capability;
      const requestDigest = canonicalDigest({
        capability: invocation.capability,
        input: invocation.input ?? {},
      });
      return {
        type: "capability_error",
        capability: identity,
        requestDigest,
        code: error.code,
        category: "authorization",
        message: error.message,
        retryable: false,
        operatorTraceRef: `trace_${requestDigest.slice(7, 31)}`,
        details: identity
          ? { capability: formatCapabilityIdentity(identity) }
          : undefined,
      };
    }
  }
}

export function createAgentAuthenticatedDispatcher(
  input: {
    agentKey: string | null | undefined;
    service: AgentAuthService;
    dispatcher: CapabilityDispatcher;
  },
): CapabilityDispatcherPort {
  return new AgentAuthenticatedCapabilityDispatcher(
    input.dispatcher,
    new AgentKeySecurityContextResolver(input.agentKey, input.service),
  );
}
