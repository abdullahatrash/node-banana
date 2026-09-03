import type { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_GOVERNANCE_REPOSITORY } from "./production";
import { RepositoryGovernanceStepUpVerifier, type GovernanceHighRiskPurpose } from "./step-up";

const verifier = new RepositoryGovernanceStepUpVerifier(PRODUCTION_GOVERNANCE_REPOSITORY);

export async function requireGovernanceStepUp(input: { request: NextRequest; workspaceId: string; userId: string; purpose: GovernanceHighRiskPurpose; resourceId: string | null }): Promise<NextResponse | null> {
  const token = input.request.headers.get("x-step-up-token")?.trim() ?? "";
  const evidence = await verifier.verify({ ...input, token, evaluatedAt: new Date() });
  return evidence ? null : noStoreJson({ success: false, error: "Fresh exact-scope step-up authentication is required.", code: "GOVERNANCE_STEP_UP_REQUIRED", purpose: input.purpose, resourceId: input.resourceId }, { status: 403 });
}
