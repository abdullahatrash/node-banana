import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { ReplicateQualificationHttpExecution } from "../qualification-http-execution";

const environment = {
  REPLICATE_QUALIFICATION_API_TOKEN: "r8_qualification_test",
  QUALIFICATION_HARNESS_TOKEN: "qualification-harness-test",
  REPLICATE_QUALIFICATION_API_BASE_URL: "https://replicate.invalid/v1/",
  QUALIFICATION_WEBHOOK_URL: "https://qualification.invalid/webhook",
  QUALIFICATION_WEBHOOK_OBSERVER_URL: "https://qualification.invalid/observer",
  QUALIFICATION_INGESTION_URL: "https://qualification.invalid/ingestion",
  QUALIFICATION_SPEND_OBSERVER_URL: "https://qualification.invalid/spend",
  QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({ test: "test-public-key" }),
};

const inputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    aspect_ratio: { type: "string" },
  },
};

describe("Replicate qualification HTTP execution", () => {
  it("keeps community models pinned to their immutable version endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      openapi_schema: { components: { schemas: { Input: inputSchema } } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const execution = new ReplicateQualificationHttpExecution(environment, fetcher);
    await expect(execution.inspectSchema({ endpoint: "versioned", model: "owner/community-model", version: "immutable-version-123" })).resolves.toMatchObject({
      inputSchemaDigest: canonicalDigest(inputSchema),
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://replicate.invalid/v1/models/owner/community-model/versions/immutable-version-123");
  });

  it("inspects the current schema of an official stable model target", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      owner: "prunaai",
      name: "p-video",
      latest_version: { openapi_schema: { components: { schemas: { Input: inputSchema } } } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const execution = new ReplicateQualificationHttpExecution(environment, fetcher);
    await expect(execution.inspectSchema({ endpoint: "official", model: "prunaai/p-video", version: "prunaai/p-video" })).resolves.toEqual({
      inputSchemaDigest: canonicalDigest(inputSchema),
      inputKeys: ["prompt", "aspect_ratio"],
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://replicate.invalid/v1/models/prunaai/p-video");
  });

  it("submits an official model by owner/name and normalizes Replicate's hidden version", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "prediction-official",
      model: "prunaai/p-video",
      version: "hidden",
      status: "starting",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const execution = new ReplicateQualificationHttpExecution(environment, fetcher);
    await expect(execution.submit({
      endpoint: "official",
      model: "prunaai/p-video",
      version: "prunaai/p-video",
      providerInput: { prompt: "Arabic Brand film" },
      cancelAfterSeconds: 120,
      caseId: "official-case",
      submissionKey: "official-submission",
    })).resolves.toMatchObject({ predictionId: "prediction-official", version: "prunaai/p-video" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://replicate.invalid/v1/models/prunaai/p-video/predictions");
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      input: { prompt: "Arabic Brand film" },
      webhook: "https://qualification.invalid/webhook?caseId=official-case&submissionKey=official-submission",
      webhook_events_filter: ["start", "completed"],
    });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Idempotency-Key")).toBe(false);
  });

  it("fails closed when an official prediction reports another model identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "prediction-other",
      model: "other/model",
      version: "hidden",
      status: "starting",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const execution = new ReplicateQualificationHttpExecution(environment, fetcher);
    await expect(execution.submit({
      endpoint: "official",
      model: "prunaai/p-video",
      version: "prunaai/p-video",
      providerInput: { prompt: "Brand film" },
      cancelAfterSeconds: 120,
      caseId: "wrong-model",
      submissionKey: "wrong-model-submission",
    })).rejects.toThrow("QUALIFICATION_MODEL_IDENTITY_MISMATCH");
  });

  it("sends content language to the trusted artifact inspector and accepts multi-output evidence", async () => {
    const item = { contentDigest: `sha256:${"a".repeat(64)}`, width: 1080, height: 1920, durationSeconds: null, fps: null };
    const receipt = { kind: "media", receiptId: "qai_receipt", contentDigest: `sha256:${"b".repeat(64)}`, itemCount: 1, items: [item], width: 1080, height: 1920, durationSeconds: null, fps: null, observedLanguages: ["ar"], languageEvidenceDigest: `sha256:${"c".repeat(64)}` };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(receipt));
    const execution = new ReplicateQualificationHttpExecution(environment, fetcher);
    await expect(execution.ingest({ predictionId: "prediction-1", caseId: "arabic-case", capability: "text_to_image", contentLanguage: "ar", output: "https://replicate.delivery/output.png" })).resolves.toEqual(receipt);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ contentLanguage: "ar", predictionId: "prediction-1" });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer qualification-harness-test");
  });
});
