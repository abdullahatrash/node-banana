import { NextRequest, NextResponse } from "next/server";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";
import { listProviderCapabilities } from "@/lib/social/provider-registry";

interface ProvidersResponse {
  success: boolean;
  providers?: ProviderCapabilities[];
  error?: string;
}

export async function GET(
  _request: NextRequest,
): Promise<NextResponse<ProvidersResponse>> {
  try {
    const providers = listProviderCapabilities();
    return NextResponse.json({ success: true, providers });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list providers",
      },
      { status: 500 },
    );
  }
}
