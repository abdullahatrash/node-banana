import { z } from "zod";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import { COMMON_DISCOVERY_ERRORS, defineCapability, QUERY_EFFECT } from "@/lib/agent-tools/registry";
import type { CapabilityErrorContract, CapabilityRegistration, ResolvedSecurityContext } from "@/types/capabilities";
import type { GovernanceActor } from "./types";
import { GOVERNANCE_COMMAND_CAPABILITIES, GovernanceError, type GovernanceCommand, type GovernanceService } from "./service";

const commandTypes = Object.keys(GOVERNANCE_COMMAND_CAPABILITIES) as GovernanceCommand["type"][];
const commandSchema = z.object({ type: z.enum(commandTypes) }).passthrough();
const invocationSchema = z.object({ command: commandSchema }).strict();
const emptySchema = z.object({}).strict();
const anyObject = { type: "object", additionalProperties: true } as const;
const lifecycle = { status: "active", introducedAt: "2026-09-03T00:00:00.000Z", recommended: true } as const;
const governanceErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  { code: "GOVERNANCE_FORBIDDEN", category: "authorization", retryable: false, description: "The exact governance capability is not granted." },
  { code: "GOVERNANCE_CONFLICT", category: "conflict", retryable: false, description: "The governance resource or idempotency key changed." },
  { code: "GOVERNANCE_STEP_UP_REQUIRED", category: "authorization", retryable: false, description: "Fresh exact-scope step-up authentication is required." },
  { code: "GOVERNANCE_UNSAFE_RETRY", category: "conflict", retryable: false, description: "An ambiguous external outcome cannot be retried blindly." },
];

function actorFrom(context: ResolvedSecurityContext | undefined): GovernanceActor {
  if (!context || context.kind !== "human") {
    throw new CapabilityFailure({ code: "GOVERNANCE_FORBIDDEN", category: "authorization", retryable: false, message: "A human Workspace session is required." });
  }
  return { workspaceId: context.workspaceId, userId: context.userId, legacyRole: context.role };
}

function failure(error: unknown): never {
  if (!(error instanceof GovernanceError)) throw error;
  const category = error.code === "NOT_FOUND" ? "not_found" : error.code === "FORBIDDEN" || error.code === "STEP_UP_REQUIRED" ? "authorization" : error.code === "CONFLICT" || error.code === "UNSAFE_RETRY" ? "conflict" : "validation";
  throw new CapabilityFailure({ code: `GOVERNANCE_${error.code}`, category, retryable: false, message: error.message });
}

export function createGovernanceRegistrations(service: GovernanceService): CapabilityRegistration[] {
  const query = defineCapability({
    identity: { name: "governance.snapshot.get", version: 1 },
    audience: "shared",
    summary: "Read the authorized, redacted governance snapshot for the explicitly selected Workspace.",
    lifecycle,
    input: emptySchema,
    outputSchema: anyObject,
    effect: QUERY_EFFECT,
    approval: { mode: "none" },
    idempotency: { mode: "retry-safe" },
    errors: governanceErrors,
    authorization: { resources: [] },
    handler: async (_input, context) => {
      try { return await service.snapshot(actorFrom(context.securityContext)); } catch (error) { failure(error); }
    },
  });

  const byCapability = new Map<string, GovernanceCommand["type"][]>();
  for (const [command, capability] of Object.entries(GOVERNANCE_COMMAND_CAPABILITIES) as Array<[GovernanceCommand["type"], string]>) {
    const list = byCapability.get(capability) ?? [];
    list.push(command);
    byCapability.set(capability, list);
  }
  const mutations = [...byCapability].map(([capability, allowedCommands]) =>
    defineCapability({
      identity: { name: capability, version: 1 },
      audience: "shared",
      summary: `Execute ${capability} within one explicitly selected Workspace.`,
      lifecycle,
      input: invocationSchema,
      outputSchema: anyObject,
      effect: { mutation: "runtime-state", visibility: "private", timing: capability === "bulk.execute" || capability === "imports.manage" || capability === "exports.manage" || capability === "audit.export" ? "durable-async" : "immediate", reversibility: "conditional", maySpendProviderBudget: false },
      approval: { mode: capability === "reviews.decide_publishing" ? "manages-approval" : "none" },
      idempotency: { mode: "key-required" },
      errors: governanceErrors,
      authorization: { resources: [] },
      handler: async (input, context) => {
        const command = input.command as GovernanceCommand;
        if (!allowedCommands.includes(command.type)) {
          throw new CapabilityFailure({ code: "VALIDATION_FAILED", category: "validation", retryable: false, message: "Command does not match capability." });
        }
        const securityContext = context.securityContext;
        const actor = actorFrom(securityContext);
        const key = securityContext?.kind === "human" ? securityContext.idempotencyKey : undefined;
        if (!key) throw new CapabilityFailure({ code: "IDEMPOTENCY_KEY_REQUIRED", category: "validation", retryable: false, message: "Idempotency key required." });
        try { return await service.execute(actor, command, key); } catch (error) { failure(error); }
      },
    }),
  );
  return [query, ...mutations];
}
