import { NextRequest } from "next/server";
import { CredentialVaultError } from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = {
  params: Promise<{ profileId: string; version: string }>;
};

export const DELETE = withStudioAuth<Context>(
  {
    route: "/api/studio/credentials/[profileId]/versions/[version]",
    action: "delete",
    permission: "workspaces:delete",
  },
  async (request: NextRequest, authz, context) => {
    const human = credentialHumanContext(request, authz);
    if (!human) {
      return noStoreJson(
        { success: false, error: "Credential version is unavailable." },
        { status: 404 },
      );
    }
    const { profileId, version: rawVersion } = await context.params;
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      return noStoreJson(
        { success: false, error: "Credential version is unavailable." },
        { status: 404 },
      );
    }
    try {
      await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.versions.revoke@1",
        { profileId, version },
        human,
      );
      return noStoreJson({ success: true });
    } catch (error) {
      if (!(error instanceof CredentialVaultError)) throw error;
      return noStoreJson(
        { success: false, error: "Credential version is unavailable." },
        { status: 404 },
      );
    }
  },
);
