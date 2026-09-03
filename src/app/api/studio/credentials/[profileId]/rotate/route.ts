import { NextRequest } from "next/server";
import { z } from "zod";
import {
  CredentialVaultError,
} from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";

type Context = { params: Promise<{ profileId: string }> };
const schema = z
  .object({
    expectedActiveVersion: z.number().int().positive(),
    overlapSeconds: z.number().int().min(0).max(86_400).optional(),
    secret: z.string().min(8).max(10_000),
  })
  .strict();

export const POST = withStudioAuth<Context>(
  { route: "/api/studio/credentials/[profileId]/rotate", action: "write" },
  async (request: NextRequest, authz, context) => {
    const human = credentialHumanContext(request, authz);
    if (!human) {
      return noStoreJson(
        { success: false, error: "Credential Profile is unavailable." },
        { status: 404 },
      );
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return noStoreJson({ success: false, error: "Invalid rotation handoff." }, { status: 400 });
    }
    try {
      const { profileId } = await context.params;
      const stepUpDenied = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "credential.replace", resourceId: profileId });
      if (stepUpDenied) return stepUpDenied;
      const profile = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.profiles.rotate@1",
        { profileId, ...parsed.data },
        human,
      );
      return noStoreJson({ success: true, profile });
    } catch (error) {
      if (!(error instanceof CredentialVaultError)) throw error;
      return noStoreJson(
        { success: false, error: error.message },
        {
          status:
            error.code === "CONFLICT"
              ? 409
              : error.code === "INVALID_INPUT"
                ? 400
                : 403,
        },
      );
    }
  },
);
