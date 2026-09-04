import { describe, expect, it, vi } from "vitest";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { inspectReplicateQualificationContract } from "../qualification-contract-inspector";

const environment = {
  REPLICATE_QUALIFICATION_API_TOKEN: "r8_dedicated_qualification_token",
  REPLICATE_QUALIFICATION_API_BASE_URL: "https://api.replicate.test/v1/",
};

function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    owner: "prunaai",
    name: "p-image",
    latest_version: {
      id: "hidden",
      openapi_schema: {
        components: {
          schemas: {
            Input: {
              type: "object",
              required: ["prompt"],
              properties: {
                prompt: { type: "string" },
                aspect_ratio: { type: "string", enum: ["9:16", "1:1"], default: "1:1" },
                disable_safety_checker: { type: "boolean", default: false },
              },
            },
          },
        },
      },
    },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Replicate qualification contract inspector", () => {
  it("pins an Official Model schema with one GET and makes no paid call", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    const report = await inspectReplicateQualificationContract({
      model: "prunaai/p-image",
      environment,
      fetcher,
      at: new Date("2026-09-05T00:00:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.replicate.test/v1/models/prunaai/p-image"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(report).toMatchObject({
      paidCallsMade: false,
      target: { endpoint: "official", model: "prunaai/p-image", version: "prunaai/p-image" },
      requiredInputKeys: ["prompt"],
      curatedCapabilities: ["text_to_image"],
    });
    expect(report.inputSchemaDigest).toBe(canonicalDigest({
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        aspect_ratio: { type: "string", enum: ["9:16", "1:1"], default: "1:1" },
        disable_safety_checker: { type: "boolean", default: false },
      },
    }));
    expect(report.inputs).toContainEqual({ key: "disable_safety_checker", required: false, type: "boolean", default: false });
    expect(JSON.stringify(report)).not.toContain(environment.REPLICATE_QUALIFICATION_API_TOKEN);
  });

  it("rejects missing or placeholder qualification credentials before fetch", async () => {
    const fetcher = vi.fn();
    await expect(inspectReplicateQualificationContract({ model: "prunaai/p-image", environment: {}, fetcher })).rejects.toThrow("REPLICATE_QUALIFICATION_API_TOKEN");
    await expect(inspectReplicateQualificationContract({ model: "prunaai/p-image", environment: { REPLICATE_QUALIFICATION_API_TOKEN: "your_replicate_api_key_here" }, fetcher })).rejects.toThrow("REPLICATE_QUALIFICATION_API_TOKEN");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-curated and mismatched model identities", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ name: "other" }));
    await expect(inspectReplicateQualificationContract({ model: "unknown/model", environment, fetcher })).rejects.toThrow("QUALIFICATION_MODEL_NOT_CURATED");
    await expect(inspectReplicateQualificationContract({ model: "prunaai/p-image", environment, fetcher })).rejects.toThrow("QUALIFICATION_MODEL_IDENTITY_MISMATCH");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects non-HTTPS API roots before fetch", async () => {
    const fetcher = vi.fn();
    await expect(inspectReplicateQualificationContract({ model: "prunaai/p-image", environment: { ...environment, REPLICATE_QUALIFICATION_API_BASE_URL: "http://localhost:9999" }, fetcher })).rejects.toThrow("QUALIFICATION_REPLICATE_API_BASE_UNSAFE");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
