import { NextRequest } from "next/server";
import { z } from "zod";
import {
  CredentialVaultError,
} from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ profileId: string }> };
const schema = z
  .object({ status: z.enum(["active", "disabled"]) })
  .strict();

export const PATCH = withStudioAuth<Context>(
  { route: "/api/studio/credentials/[profileId]", action: "write", permission: "workspaces:write" },
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
      return noStoreJson({ success: false, error: "Invalid status." }, { status: 400 });
    }
    try {
      const { profileId } = await context.params;
      const profile = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.profiles.status.set@1",
        { profileId, status: parsed.data.status },
        human,
      );
      return noStoreJson({ success: true, profile });
    } catch (error) {
      if (!(error instanceof CredentialVaultError)) throw error;
      return noStoreJson(
        { success: false, error: "Credential Profile is unavailable." },
        { status: 404 },
      );
    }
  },
);
