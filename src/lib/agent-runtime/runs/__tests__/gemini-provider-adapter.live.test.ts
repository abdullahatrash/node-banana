import { describe, expect, it } from "vitest";
import {
  GeminiGenerateContentTransport,
  GeminiTextAdapter,
} from "@/lib/provider-adapters/gemini/generate-content";
import { executeProviderEffect } from "../provider-adapter";

const enabled =
  process.env.RUN_LIVE_GEMINI_BYOK === "1" &&
  process.env.ACK_LIVE_GEMINI_COST === "1" &&
  Boolean(process.env.GEMINI_API_KEY);
const DIGEST = `sha256:${"d".repeat(64)}`;

describe("Gemini revoked-Credential live check (explicit opt-in, max one call)", () => {
  const revokedEnabled = enabled && Boolean(process.env.GEMINI_REVOKED_API_KEY);
  (revokedEnabled ? it : it.skip)(
    "classifies a separately provisioned revoked key without exposing it",
    async () => {
      const secret = process.env.GEMINI_REVOKED_API_KEY!;
      const outcome = await executeProviderEffect(
        new GeminiTextAdapter(new GeminiGenerateContentTransport()),
        {
          effectKey: "live-effect-revoked-0001",
          intentDigest: DIGEST,
          intent: { prompt: "Health check", instruction: "Return ok." },
          credentials: {
            primary: { profileId: "live_revoked", version: 1, secret },
          },
        },
      );
      expect(outcome).toMatchObject({
        kind: "failed_known",
        failureCode: "PROVIDER_CREDENTIAL_REJECTED",
        evidence: { effectDisposition: "not_created" },
      });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    },
    60_000,
  );
});
