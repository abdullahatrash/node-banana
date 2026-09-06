import { noStoreJson } from "@/lib/agent-auth/http-request";
import { CredentialVaultError } from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ grantId: string }> };

export const DELETE = withStudioAuth<Context>(
  { route: "/api/studio/credential-spend-grants/[grantId]", action: "delete", permission: "workspaces:delete" },
  async (_request, authz, context) => {
    const human = credentialHumanContext(_request, authz);
    if (!human) {
      return noStoreJson(
        { success: false, error: "Credential Spend Grant is unavailable." },
        { status: 404 },
      );
    }
    try {
      const { grantId } = await context.params;
      await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.spend_grants.revoke@1",
        { grantId },
        human,
      );
      return noStoreJson({ success: true });
    } catch (error) {
      if (!(error instanceof CredentialVaultError)) throw error;
      return noStoreJson(
        { success: false, error: "Credential Spend Grant is unavailable." },
        { status: 404 },
      );
    }
  },
);
