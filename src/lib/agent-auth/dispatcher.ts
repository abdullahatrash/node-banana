import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { randomUUID } from "node:crypto";
import {
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
  resolve(): Promise<
    Awaited<ReturnType<AgentAuthService["resolveAgentKeyForAdmission"]>>
  >;
}

export class AgentKeySecurityContextResolver
  implements AgentSecurityContextResolver
{
  constructor(
    private readonly agentKey: string | null | undefined,
    private readonly service: AgentAuthService,
  ) {}

  resolve() {
    return this.service.resolveAgentKeyForAdmission(this.agentKey);
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
      return this.dispatcher.dispatch(invocation, {
        securityContext: { kind: "agent", ...securityContext },
      });
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
        code: "CAPABILITY_NOT_AUTHORIZED",
        category: "authorization",
        message: identity
          ? `Capability ${identity.name}@${identity.version} is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.`
          : "The requested capability is not authorized.",
        retryable: false,
        operatorTraceRef: `trace_${randomUUID().replaceAll("-", "")}`,
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
