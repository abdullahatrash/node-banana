import { NextResponse, type NextRequest } from "next/server";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { resolvePersonaTrainingSchema } from "@/lib/creator-personas/schemas";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { synchronizeOperationProjections } from "@/lib/agent-runtime/operation-status/projection-sync";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";

const bodySchema = resolvePersonaTrainingSchema.extend({ workspaceId: resolvePersonaTrainingSchema.shape.trainingJobId, personaId: resolvePersonaTrainingSchema.shape.trainingJobId, actorUserId: resolvePersonaTrainingSchema.shape.trainingJobId });
export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_PERSONA_TRAINING_OUTCOME" }, { status: 400 });
  const { action: _action, workspaceId, personaId, actorUserId, ...command } = parsed.data;
  const result = await CREATOR_PERSONAS.resolveTraining({ ...command, workspaceId, personaId, userId: actorUserId });
  if (typeof result.trainingJobId === "string") await synchronizeOperationProjections(PRODUCTION_OPERATION_STATUS, [{ adapterId: "creator-persona-training/v1", kind: "persona_training", workspaceId, resourceId: result.trainingJobId, state: command.outcome, stage: null, updatedAt: new Date(), metadata: { reasonCode: command.failureCode, nextAction: command.outcome === "succeeded" ? "review_persona" : "inspect_persona_training" } }]);
  return NextResponse.json({ success: true, result });
}
