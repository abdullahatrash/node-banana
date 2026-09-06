import { NextResponse, type NextRequest } from "next/server";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { createProductionPersonaTrainingDispatcher } from "@/lib/creator-personas/training-production";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  try {
    await CREATOR_PERSONAS.materializeExpiredConsents({ at: new Date(), limit: 100 });
    return NextResponse.json({ success: true, result: await createProductionPersonaTrainingDispatcher().dispatchOne() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PERSONA_TRAINING_DISPATCH_FAILED";
    if (code.startsWith("PERSONA_TRAINING_CONFIGURATION_REQUIRED:") || code === "PERSONA_TRAINING_GATEWAY_UNSAFE") return NextResponse.json({ success: false, code }, { status: 503 });
    throw error;
  }
}
export const GET = handle;
export const POST = handle;
