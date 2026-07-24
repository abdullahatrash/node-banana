export {
  AgentAuthError,
  AgentAuthService,
  AgentValidationError,
  AGENT_AUTH_SERVICE,
  loadAgentKeyPepperConfig,
} from "./service";
export { InMemoryAgentAuthRepository } from "./memory-repository";
export { DrizzleAgentAuthRepository } from "./repository";
export {
  AgentAuthenticatedCapabilityDispatcher,
  AgentKeySecurityContextResolver,
  createAgentAuthenticatedDispatcher,
} from "./dispatcher";
export type {
  AgentAuthenticationRecord,
  AgentAuthRepository,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentPrincipalStatus,
  AgentPrincipalSummary,
  AgentSecurityContext,
  PairingChallengeRecord,
  PairingRateLimitAction,
} from "./types";
