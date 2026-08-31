import { NextRequest } from "next/server";
import { z } from "zod";
import {
  CredentialVaultError,
} from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { CREDENTIAL_SLOT_PROVIDERS } from "@/types";

type Context = { params: Promise<{ profileId: string }> };
const schema = z
  .object({
    provider: z.enum(CREDENTIAL_SLOT_PROVIDERS),
    slotName: z.string().trim().min(1).max(120),
    secret: z.string().min(8).max(10_000),
  })
  .strict();

export const POST = withStudioAuth<Context>(
  { route: "/api/studio/credentials/[profileId]/reprovision", action: "write" },
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
      return noStoreJson(
        { success: false, error: "Invalid Credential Profile reprovision handoff." },
        { status: 400 },
      );
    }
    try {
      const { profileId } = await context.params;
      const profile = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.profiles.reprovision@1",
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
                : 404,
        },
      );
    }
  },
);
