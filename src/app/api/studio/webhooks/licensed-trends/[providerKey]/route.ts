import { NextRequest } from "next/server";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import {
  PRODUCTION_LICENSED_TREND_PROVIDER_INBOX,
  LicensedTrendProviderInboxError,
} from "@/lib/product-surfaces/licensed-trend-provider-inbox";
import {
  LicensedTrendProviderRequestError,
  verifyLicensedTrendProviderRequest,
} from "@/lib/product-surfaces/licensed-trend-provider-contract";

const MAX_BODY_BYTES = 1_048_576;
type Context = { params: Promise<{ providerKey: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isDatabaseConfigured()) {
    return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return noStoreJson({ success: false, code: "LICENSED_TREND_PROVIDER_BODY_TOO_LARGE" }, { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return noStoreJson({ success: false, code: "LICENSED_TREND_PROVIDER_BODY_TOO_LARGE" }, { status: 413 });
  }
  const { providerKey } = await context.params;
  try {
    const verified = verifyLicensedTrendProviderRequest({
      providerKey,
      body,
      eventId: request.headers.get("x-trend-event-id"),
      sequence: request.headers.get("x-trend-sequence"),
      occurredAt: request.headers.get("x-trend-occurred-at"),
      keyId: request.headers.get("x-trend-key-id"),
      signature: request.headers.get("x-trend-signature"),
    });
    const result = await PRODUCTION_LICENSED_TREND_PROVIDER_INBOX.receive(verified);
    return noStoreJson({ success: true, result: { kind: result.kind, state: result.event.state } }, { status: result.kind === "accepted" ? 202 : 200 });
  } catch (error) {
    if (error instanceof LicensedTrendProviderRequestError) {
      return noStoreJson({ success: false, code: error.code }, { status: error.status });
    }
    if (error instanceof LicensedTrendProviderInboxError) {
      return noStoreJson({ success: false, code: error.code }, { status: 409 });
    }
    return noStoreJson({ success: false, code: "LICENSED_TREND_PROVIDER_WEBHOOK_UNAVAILABLE" }, { status: 500 });
  }
}
