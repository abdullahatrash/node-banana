import { NextResponse, type NextRequest } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";
import { CHANNEL_ONBOARDING } from "@/lib/channel-onboarding/production";
import { publicChannelOnboardingCommandSchema } from "@/lib/channel-onboarding/schemas";
import { ChannelOnboardingError } from "@/lib/channel-onboarding/repository";

const denied = () => NextResponse.json({ success: false, code: "CHANNEL_ONBOARDING_ADMIN_REQUIRED" }, { status: 403 });
const failure = (error: unknown) => { if (!(error instanceof ChannelOnboardingError)) throw error; return NextResponse.json({ success: false, code: error.code }, { status: ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409 : 422 }); };

export const GET = withStudioAuth<undefined>({ route: "/api/studio/channel-onboarding", action: "read", permission: "social:view" }, async (_request, authz) => NextResponse.json({ success: true, data: await CHANNEL_ONBOARDING.summary(authz.workspaceId) }));

export const POST = withStudioAuth<undefined>({ route: "/api/studio/channel-onboarding", action: "write", permission: "social:manage" }, async (request: NextRequest, authz) => {
  if (!["owner", "admin"].includes(authz.role)) return denied();
  const parsed = publicChannelOnboardingCommandSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_CHANNEL_ONBOARDING_COMMAND" }, { status: 400 });
  const command = parsed.data;
  try {
    if (command.action === "create_order") return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.createOrder({ ...command, workspaceId: authz.workspaceId, userId: authz.userId }) }, { status: 201 });
    if (command.action === "accept_quote") return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.acceptQuote({ ...command, workspaceId: authz.workspaceId, userId: authz.userId }) });
    if (command.action === "bind_credential") { const deniedStepUp = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "credential.create", resourceId: command.orderId }); if (deniedStepUp) return deniedStepUp; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.bindCredential({ ...command, workspaceId: authz.workspaceId, userId: authz.userId }) }); }
    if (command.action === "complete_customer_task") return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.completeTask({ ...command, workspaceId: authz.workspaceId, actorRef: `human:${authz.userId}`, actorKind: "customer" }) });
    if (command.action === "connect_channel") return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.connect({ ...command, workspaceId: authz.workspaceId, userId: authz.userId }) });
    return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.cancel({ ...command, workspaceId: authz.workspaceId, userId: authz.userId }) });
  } catch (error) { return failure(error); }
});
