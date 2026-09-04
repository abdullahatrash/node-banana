import { NextResponse, type NextRequest } from "next/server";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { CHANNEL_ONBOARDING } from "@/lib/channel-onboarding/production";
import { internalChannelOnboardingCommandSchema } from "@/lib/channel-onboarding/schemas";
import { ChannelOnboardingError } from "@/lib/channel-onboarding/repository";

export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const parsed = internalChannelOnboardingCommandSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_CHANNEL_ONBOARDING_COMMAND" }, { status: 400 });
  const command = parsed.data;
  try {
    if (command.action === "publish_offer") { const { action: _action, effectiveAt, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.publishOffer({ ...input, status: "active", effectiveAt: new Date(effectiveAt), retiredAt: null, createdAt: new Date() }) }); }
    if (command.action === "publish_partner") { const { action: _action, partnerId, effectiveAt, expiresAt, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.publishPartner({ ...input, id: partnerId, status: "vetted", effectiveAt: new Date(effectiveAt), expiresAt: new Date(expiresAt), revokedAt: null, createdAt: new Date() }) }); }
    if (command.action === "confirm_payment") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.confirmPayment(input) }); }
    if (command.action === "assign_partner") { const { action: _action, expiresAt, taskDueAt, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.assignPartner({ ...input, expiresAt: new Date(expiresAt), taskDueAt: taskDueAt ? new Date(taskDueAt) : null }) }); }
    if (command.action === "create_customer_task") { const { action: _action, taskDueAt, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.createTask({ ...input, actorKind: "customer", actorRef: "system:channel-onboarding", taskDueAt: taskDueAt ? new Date(taskDueAt) : null }) }); }
    if (command.action === "complete_partner_task") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.completeTask({ ...input, actorKind: "partner", actorRef: `partner-assignment:${input.assignmentId}` }) }); }
    if (command.action === "readiness_review") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.readinessReview(input) }); }
    if (command.action === "record_refund") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.recordRefund(input) }); }
    const { action: _action, state, ...input } = command; return NextResponse.json({ success: true, result: await CHANNEL_ONBOARDING.setState({ ...input, state, actorRef: "system:channel-onboarding" }) });
  } catch (error) { if (error instanceof ChannelOnboardingError) return NextResponse.json({ success: false, code: error.code }, { status: ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409 : 422 }); throw error; }
}
