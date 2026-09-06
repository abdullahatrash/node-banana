import { NextRequest } from "next/server";
import { z } from "zod";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
} from "@/lib/agent-auth/http";
import {
  noStoreJson,
  parseAgentJson,
  requireAgentMutationRequest,
} from "@/lib/agent-auth/http-request";
import {
  authorizationContractDigestFor,
  parseCapabilityIdentity,
} from "@/lib/agent-tools";
import { PRODUCTION_CAPABILITY_REGISTRY } from "@/lib/agent-runtime/server-dispatcher";
import { AGENT_RESOURCE_DESCRIPTORS } from "@/lib/agent-authorization/resource-constraints";
import type {
  AgentCapabilityGrant,
  AgentResourceConstraints,
} from "@/types";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ principalId: string }> };
const resources = z
  .object({
    channelIds: z.array(z.string().trim().min(1).max(200)).max(256),
    credentialProfileIds: z.array(z.string().trim().min(1).max(200)).max(256),
    workflowIds: z.array(z.string().trim().min(1).max(200)).max(256),
    automationIds: z.array(z.string().trim().min(1).max(200)).max(256),
    artifactIds: z
      .array(z.string().trim().min(1).max(200))
      .max(256)
      .default([]),
  })
  .strict();
const exactCapability =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]*$/;
const grant = z
  .object({
    capability: z.string().regex(exactCapability),
    resources,
  })
  .strict();
const schema = z
  .object({
    grantSetId: z.string().min(1).optional(),
    expectedGrantRevision: z.number().int().positive().optional(),
    grantSetName: z.string().trim().min(1).max(120).default("Primary"),
    expectedPolicyRevision: z.number().int().nonnegative(),
    policyGrants: z.array(grant).max(64),
    grants: z.array(grant).max(64),
    key: z
      .object({
        name: z.string().trim().min(1).max(120),
        expiresAt: z.string().datetime({ offset: true }).optional(),
        authorizationScopes: z
          .array(
            z
              .object({
                capability: z.string().regex(exactCapability),
                resources,
              })
              .strict(),
          )
          .max(64),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.grantSetId) === Boolean(value.expectedGrantRevision),
    "grantSetId and expectedGrantRevision must be supplied together.",
  );

class AuthorityContractError extends Error {}

function resolveAuthorityContracts(
  values: Array<{ capability: string; resources: AgentResourceConstraints }>,
): AgentCapabilityGrant[] {
  return values.map((value) => {
    const identity = parseCapabilityIdentity(value.capability);
    const registration = identity
      ? PRODUCTION_CAPABILITY_REGISTRY.getRegistration(identity)
      : undefined;
    if (!identity || !registration || registration.lifecycle.status === "retired") {
      throw new AuthorityContractError(
        `Capability ${value.capability} is unavailable for authority provisioning.`,
      );
    }
    const supportedKinds = new Set(
      registration.authorization.resources.map((selector) => selector.kind),
    );
    for (const { constraintKey, kind } of AGENT_RESOURCE_DESCRIPTORS) {
      if (
        (value.resources[constraintKey] ?? []).length > 0 &&
        !supportedKinds.has(kind)
      ) {
        throw new AuthorityContractError(
          `Capability ${value.capability} does not authorize ${kind} resources.`,
        );
      }
    }
    return {
      capability: value.capability,
      authorizationContractDigest: authorizationContractDigestFor(
        identity,
        registration.authorization,
      ),
      resources: value.resources,
    };
  });
}

export const POST = withStudioAuth<Context>(
  { route: "/api/agents/[principalId]/authority", action: "write", permission: "workspaces:write" },
  async (request: NextRequest, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const requestError = requireAgentMutationRequest(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    const parsed = await parseAgentJson(request, schema);
    if (!parsed.success) return parsed.response;
    const requestId = request.headers.get("x-request-id")?.trim();
    if (!requestId || requestId.length > 200) {
      return noStoreJson(
        {
          success: false,
          error:
            "A stable x-request-id is required for retry-safe authority provisioning.",
        },
        { status: 400 },
      );
    }
    const { principalId } = await context.params;
    const stepUpDenied = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "agent.authority.provision", resourceId: principalId });
    if (stepUpDenied) return stepUpDenied;
    try {
      const grants = resolveAuthorityContracts(parsed.data.grants);
      const policyGrants = resolveAuthorityContracts(parsed.data.policyGrants);
      const authorizationScopes = resolveAuthorityContracts(
        parsed.data.key.authorizationScopes,
      );
      const issued = await AGENT_AUTH_SERVICE.provisionAuthority({
        requestId,
        workspaceId: authz.workspaceId,
        principalId,
        actorUserId: authz.userId,
        grantSetId: parsed.data.grantSetId,
        grantSetName: parsed.data.grantSetName,
        expectedGrantRevision: parsed.data.expectedGrantRevision,
        expectedPolicyRevision: parsed.data.expectedPolicyRevision,
        grants,
        policyGrants,
        key: {
          name: parsed.data.key.name,
          expiresAt: parsed.data.key.expiresAt
            ? new Date(parsed.data.key.expiresAt)
            : undefined,
          authorizationScopes,
        },
      });
      return noStoreJson({
        success: true,
        agentKey: issued.agentKey,
        key: {
          id: issued.key.id,
          principalId: issued.key.principalId,
          name: issued.key.name,
          lookupPrefix: issued.key.lookupPrefix,
          authorizationScopes: issued.key.authorizationScopes,
          expiresAt: issued.key.expiresAt?.toISOString() ?? null,
          createdAt: issued.key.createdAt.toISOString(),
        },
        grantSetId: issued.grantSetId,
        grantRevisionId: issued.grantRevisionId,
        grantRevision: issued.grantRevision,
        policyRevisionId: issued.policyRevisionId,
        policyRevision: issued.policyRevision,
      });
    } catch (error) {
      if (error instanceof AuthorityContractError) {
        return noStoreJson(
          { success: false, error: error.message },
          { status: 400 },
        );
      }
      return agentAuthErrorResponse(error);
    }
  },
);
