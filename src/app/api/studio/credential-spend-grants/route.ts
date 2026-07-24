import { NextRequest } from "next/server";
import { z } from "zod";
import {
  CredentialVaultError,
} from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z
  .object({
    principalId: z.string().trim().min(1).max(200),
    profileId: z.string().trim().min(1).max(200),
    mode: z.enum(["bounded", "audited_unbounded"]),
    limitCents: z.number().int().positive().max(2_147_483_647).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.mode === "bounded"
        ? value.limitCents !== undefined
        : value.limitCents === undefined,
    "Bounded grants require a limit; audited unbounded grants do not accept one.",
  );

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/credential-spend-grants", action: "read" },
  async (request: NextRequest, authz) => {
    const human = credentialHumanContext(request, authz);
    if (!human) {
      return noStoreJson(
        { success: false, error: "Only Workspace owners and admins can view spend grants." },
        { status: 403 },
      );
    }
    const output = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
      "credentials.spend_grants.list@1",
      {},
      human,
    );
    return noStoreJson({
      success: true,
      ...(output as { grants: unknown[] }),
    });
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/credential-spend-grants", action: "write" },
  async (request: NextRequest, authz) => {
    const human = credentialHumanContext(request, authz);
    if (!human) {
      return noStoreJson(
        { success: false, error: "Only Workspace owners and admins can grant spend." },
        { status: 403 },
      );
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Choose bounded or audited unbounded spend explicitly." },
        { status: 400 },
      );
    }
    try {
      const grant = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.spend_grants.create@1",
        parsed.data,
        human,
      );
      return noStoreJson({ success: true, grant }, { status: 201 });
    } catch (error) {
      if (!(error instanceof CredentialVaultError)) throw error;
      return noStoreJson(
        { success: false, error: error.message },
        { status: error.code === "INVALID_INPUT" ? 400 : 403 },
      );
    }
  },
);
