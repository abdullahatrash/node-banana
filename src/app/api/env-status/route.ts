import { NextResponse } from "next/server";
import { isCloudMode } from "@/lib/storage";
import { hasConfiguredSecret } from "@/lib/configured-secret";

export interface EnvStatusResponse {
  gemini: boolean;
  openai: boolean;
  anthropic: boolean;
  replicate: boolean;
  fal: boolean;
  kie: boolean;
  wavespeed: boolean;
  cloudMode: boolean;
}

export async function GET() {
  // Check which API keys are configured via environment variables
  const status: EnvStatusResponse = {
    gemini: hasConfiguredSecret(process.env.GEMINI_API_KEY),
    openai: hasConfiguredSecret(process.env.OPENAI_API_KEY),
    anthropic: hasConfiguredSecret(process.env.ANTHROPIC_API_KEY),
    replicate: hasConfiguredSecret(process.env.REPLICATE_API_KEY),
    fal: hasConfiguredSecret(process.env.FAL_API_KEY),
    kie: hasConfiguredSecret(process.env.KIE_API_KEY),
    wavespeed: hasConfiguredSecret(process.env.WAVESPEED_API_KEY),
    cloudMode: isCloudMode(),
  };

  return NextResponse.json(status);
}
