import { getDb } from "@/lib/db";
import { AgentAuthorizationService } from "@/lib/agent-authorization/service";
import { DrizzleAgentAuthorizationRepository } from "@/lib/agent-authorization/repository";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  CREDENTIAL_PROFILE_GET_IDENTITY,
  authorizationContractDigestFor,
  createAgentIdentityRegistrations,
  createCapabilityRegistry,
  createCredentialProfileRegistrations,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import {
  CREDENTIAL_VAULT_SERVICE,
  CredentialVaultError,
  createCredentialHumanRegistrations,
} from "@/lib/credential-vault";
import {
  CredentialEffectExecutor,
} from "@/lib/credential-vault/service";
import { credentialSecretCipher } from "@/lib/credential-vault/crypto";
import { DrizzleCredentialVaultRepository } from "@/lib/credential-vault/repository";
import type {
  CapabilityDispatchContext,
  CapabilityInvocation,
  CapabilityResponse,
} from "@/types/capabilities";
import {
  CompositeCapabilityAuthorizer,
  HumanCapabilityAuthorizer,
} from "./composite-authorizer";
import {
  PRODUCTION_ARTIFACT_SERVICE,
  createArtifactRegistrations,
} from "./artifacts";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  PRODUCTION_WORKFLOW_REVISION_SERVICE,
  createWorkflowRegistrations,
} from "./workflows";

export const PRODUCTION_AGENT_AUTHORIZER = new AgentAuthorizationService(
  new DrizzleAgentAuthorizationRepository(getDb),
);
export const PRODUCTION_CAPABILITY_AUTHORIZER =
  new CompositeCapabilityAuthorizer(
    PRODUCTION_AGENT_AUTHORIZER,
    new HumanCapabilityAuthorizer(getDb),
  );

/**
 * No legacy browser header/provider adapter is registered here. Credential
 * Slots fail closed until a server-owned adapter explicitly implements
 * idempotent provider effects at this seam.
 */
export const CREDENTIAL_EFFECT_EXECUTOR = new CredentialEffectExecutor(
  new DrizzleCredentialVaultRepository(getDb),
  credentialSecretCipher,
  PRODUCTION_AGENT_AUTHORIZER,
  {
    capability: CREDENTIAL_PROFILE_GET_IDENTITY,
    authorizationContractDigest: authorizationContractDigestFor(
      CREDENTIAL_PROFILE_GET_IDENTITY,
      {
        resources: [
          {
            kind: "credential_profile",
            inputPath: "credentialProfileId",
          },
        ],
      },
    ),
  },
  [],
);

export const PRODUCTION_CAPABILITY_REGISTRY = createCapabilityRegistry([
  ...createDiscoveryRegistrations(),
  ...createAgentIdentityRegistrations(),
  ...createCredentialProfileRegistrations(CREDENTIAL_VAULT_SERVICE),
  ...createCredentialHumanRegistrations(CREDENTIAL_VAULT_SERVICE),
  ...createArtifactRegistrations(PRODUCTION_ARTIFACT_SERVICE),
  ...createWorkflowRegistrations(
    PRODUCTION_WORKFLOW_REVISION_SERVICE,
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  ),
]);

export const CAPABILITY_DISPATCHER = new CapabilityDispatcher(
  PRODUCTION_CAPABILITY_REGISTRY,
  PRODUCTION_CAPABILITY_AUTHORIZER,
);

export function dispatchCapability(
  invocation: CapabilityInvocation,
  context?: CapabilityDispatchContext,
): Promise<CapabilityResponse> {
  return CAPABILITY_DISPATCHER.dispatch(invocation, context);
}

export async function invokeHumanCapability(
  capability: string,
  input: unknown,
  humanContext: Extract<
    NonNullable<CapabilityDispatchContext["securityContext"]>,
    { kind: "human" }
  >,
): Promise<unknown> {
  const response = await dispatchCapability(
    { capability, input },
    { securityContext: humanContext },
  );
  if (response.type === "capability_error") {
    if (
      [
        "FORBIDDEN",
        "CONFLICT",
        "CREDENTIAL_UNAVAILABLE",
        "SPEND_NOT_AUTHORIZED",
        "INVALID_INPUT",
      ].includes(response.code)
    ) {
      throw new CredentialVaultError(
        response.code as
          | "FORBIDDEN"
          | "CONFLICT"
          | "CREDENTIAL_UNAVAILABLE"
          | "SPEND_NOT_AUTHORIZED"
          | "INVALID_INPUT",
        response.message,
      );
    }
    if (
      response.code === "CAPABILITY_NOT_AUTHORIZED" ||
      response.code === "HUMAN_CAPABILITY_NOT_AUTHORIZED"
    ) {
      throw new CredentialVaultError("FORBIDDEN", response.message);
    }
    if (
      response.code === "IDEMPOTENCY_KEY_REQUIRED" ||
      response.code === "VALIDATION_FAILED"
    ) {
      throw new CredentialVaultError("INVALID_INPUT", response.message);
    }
    const error = new Error(response.message);
    error.name = response.code;
    throw error;
  }
  return response.output;
}

/** Thin REST façade over the one canonical registry/dispatcher. */
export const CREDENTIAL_HUMAN_CAPABILITIES = {
  invoke: invokeHumanCapability,
} as const;
