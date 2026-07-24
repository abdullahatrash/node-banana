import { getDb } from "@/lib/db";
import { AgentAuthorizationService } from "@/lib/agent-authorization/service";
import { DrizzleAgentAuthorizationRepository } from "@/lib/agent-authorization/repository";
import {
  CapabilityDispatcher,
} from "@/lib/agent-tools/dispatcher";
import { CAPABILITY_REGISTRY } from "@/lib/agent-tools/registry";
import type {
  CapabilityDispatchContext,
  CapabilityInvocation,
  CapabilityResponse,
} from "@/types/capabilities";

const PRODUCTION_CAPABILITY_AUTHORIZER = new AgentAuthorizationService(
  new DrizzleAgentAuthorizationRepository(getDb),
);

export const CAPABILITY_DISPATCHER = new CapabilityDispatcher(
  CAPABILITY_REGISTRY,
  PRODUCTION_CAPABILITY_AUTHORIZER,
);

export function dispatchCapability(
  invocation: CapabilityInvocation,
  context?: CapabilityDispatchContext,
): Promise<CapabilityResponse> {
  return CAPABILITY_DISPATCHER.dispatch(invocation, context);
}
