import { createHash } from "node:crypto";
import type { GovernanceRepository } from "./types";

export const GOVERNANCE_HIGH_RISK_PURPOSES = [
  "auth.factor.change",
  "credential.create",
  "credential.replace",
  "agent.principal.create",
  "agent.key.create",
  "agent.authority.provision",
  "spend.unbounded",
] as const;

export type GovernanceHighRiskPurpose = (typeof GOVERNANCE_HIGH_RISK_PURPOSES)[number];

function tokenDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface GovernanceStepUpEvidence {
  schema: "governance-step-up-evidence/v1";
  workspaceId: string;
  userId: string;
  sessionId: string;
  purpose: string;
  resourceId: string | null;
  expiresAt: string;
}

export class RepositoryGovernanceStepUpVerifier {
  constructor(private readonly repository: GovernanceRepository) {}

  async verify(input: { workspaceId: string; userId: string; purpose: string; resourceId: string | null; token: string; evaluatedAt: Date }): Promise<GovernanceStepUpEvidence | null> {
    if (!input.token || input.token.length > 200) return null;
    const sessions = await this.repository.listResources<{ tokenDigest: string; userId: string; purpose: string; resourceId: string | null; expiresAt: string }>({ workspaceId: input.workspaceId, kinds: ["step_up_session"], status: "active" });
    const match = sessions.find((session) =>
      session.body.userId === input.userId &&
      session.body.purpose === input.purpose &&
      session.body.resourceId === input.resourceId &&
      session.body.tokenDigest === tokenDigest(input.token) &&
      new Date(session.body.expiresAt) > input.evaluatedAt,
    );
    return match ? { schema: "governance-step-up-evidence/v1", workspaceId: input.workspaceId, userId: input.userId, sessionId: match.id, purpose: input.purpose, resourceId: input.resourceId, expiresAt: match.body.expiresAt } : null;
  }
}
