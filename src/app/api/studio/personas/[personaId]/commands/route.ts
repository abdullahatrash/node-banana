import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { personaCommandSchema } from "@/lib/creator-personas/schemas";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { CreatorPersonaError } from "@/lib/creator-personas/repository";
import { verifyPersonaAttestation } from "@/lib/creator-personas/attestation";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";

type Context = { params: Promise<{ personaId: string }> };
export const POST = withStudioAuth<Context>({ route: "/api/studio/personas/[personaId]/commands", action: "write" }, async (request, authz, context) => {
  const body = await request.json(); const parsed = personaCommandSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_PERSONA_COMMAND", issues: parsed.error.issues }, { status: 400 });
  const { personaId } = await context.params;
  try {
    let result: Record<string, unknown>;
    if (parsed.data.action === "record_consent") {
      if (!['owner', 'admin'].includes(authz.role)) return NextResponse.json({ success: false, code: "EVIDENCE_ISSUER_FORBIDDEN" }, { status: 403 });
      const { action: _action, effectiveAt, expiresAt, ...command } = parsed.data;
      result = await CREATOR_PERSONAS.recordConsent({ ...command, personaId, effectiveAt: new Date(effectiveAt), expiresAt: new Date(expiresAt), workspaceId: authz.workspaceId, userId: authz.userId });
    } else if (parsed.data.action === "add_evidence") {
      const { action: _action, issuerSignature, effectiveAt, expiresAt, ...command } = parsed.data;
      if (command.issuer === "workspace_consent_officer") {
        if (!['owner', 'admin'].includes(authz.role) || command.scope.kind !== "likeness_consent") return NextResponse.json({ success: false, code: "EVIDENCE_ISSUER_FORBIDDEN" }, { status: 403 });
      } else if (!verifyPersonaAttestation({ workspaceId: authz.workspaceId, personaId, issuer: command.issuer, subjectDigest: command.subjectDigest, evidenceDigest: command.evidenceDigest, scope: command.scope, effectiveAt, expiresAt }, issuerSignature)) {
        return NextResponse.json({ success: false, code: "EVIDENCE_ATTESTATION_INVALID" }, { status: 422 });
      }
      result = await CREATOR_PERSONAS.addEvidence({ ...command, personaId, effectiveAt: new Date(effectiveAt), expiresAt: new Date(expiresAt), workspaceId: authz.workspaceId, userId: authz.userId });
    } else if (parsed.data.action === "attach_sources") {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.attachSources({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
    } else if (parsed.data.action === "request_training") {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.requestTraining({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
      if (typeof result.operationId === "string" && typeof result.trainingJobId === "string") await PRODUCTION_OPERATION_STATUS.create({ workspaceId: authz.workspaceId, operationId: result.operationId, kind: "persona_training", resourceId: result.trainingJobId, actor: { type: "human", userId: authz.userId }, metadata: { provider: command.provider, model: command.model, version: command.modelVersion, personaId, qualificationDigest: command.qualificationDigest, nextAction: "await_provider_dispatch" }, idempotencyKey: `persona-training:${result.trainingJobId}` });
    } else if (parsed.data.action === "activate") {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.activate({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
    } else if (parsed.data.action === "suspend") {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.suspend({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
    } else if (parsed.data.action === "delete") {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.delete({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
    } else {
      const { action: _action, ...command } = parsed.data; result = await CREATOR_PERSONAS.bindUsage({ ...command, personaId, workspaceId: authz.workspaceId, userId: authz.userId });
    }
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof CreatorPersonaError) return NextResponse.json({ success: false, code: error.code }, { status: ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409 : 422 });
    throw error;
  }
});
