import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CredentialVaultError,
} from "@/lib/credential-vault";
import { CREDENTIAL_HUMAN_CAPABILITIES } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { CREDENTIAL_SLOT_PROVIDERS } from "@/types";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    provider: z.enum(CREDENTIAL_SLOT_PROVIDERS),
    slotName: z.string().trim().min(1).max(120),
    secret: z.string().min(8).max(10_000),
  })
  .strict();

function manager(role: string): NextResponse | null {
  return role === "owner" || role === "admin"
    ? null
    : noStoreJson(
        { success: false, error: "Only Workspace owners and admins can manage credentials." },
        { status: 403 },
      );
}

function errorResponse(error: unknown): NextResponse {
  if (!(error instanceof CredentialVaultError)) throw error;
  const status =
    error.code === "CONFLICT"
      ? 409
      : error.code === "FORBIDDEN"
        ? 403
        : 400;
  return noStoreJson({ success: false, error: error.message }, { status });
}

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/credentials", action: "read" },
  async (request, authz) => {
    const human = credentialHumanContext(request, authz);
    if (!human) return manager("member")!;
    try {
      const output = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.profiles.list@1",
        {},
        human,
      );
      return noStoreJson({
        success: true,
        ...(output as { profiles: unknown[] }),
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/credentials", action: "write" },
  async (request: NextRequest, authz) => {
    const human = credentialHumanContext(request, authz);
    if (!human) return manager("member")!;
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid Credential Profile handoff." },
        { status: 400 },
      );
    }
    try {
      const profile = await CREDENTIAL_HUMAN_CAPABILITIES.invoke(
        "credentials.profiles.create@1",
        parsed.data,
        human,
      );
      return noStoreJson({ success: true, profile }, { status: 201 });
    } catch (error) {
      return errorResponse(error);
    }
  },
);
