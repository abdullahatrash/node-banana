import { describe, expect, it, vi } from "vitest";
import { ReplicateHttpClient } from "../replicate-http-client";

describe("ReplicateHttpClient", () => {
  it("uses the pinned version and bearer credential without a live call", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: "prediction", status: "starting" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    const client = new ReplicateHttpClient(
      () => "test-token", fetcher, "https://replicate.invalid/v1",
    );
    expect(await client.create({
      version: "exact-version", input: { aspect_ratio: "9:16" },
    })).toMatchObject({ id: "prediction", status: "starting" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://replicate.invalid/v1/predictions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          version: "exact-version", input: { aspect_ratio: "9:16" },
        }),
      }),
    );
    const headers = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("fails closed without a credential", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ReplicateHttpClient(() => null, fetcher).get("prediction"))
      .rejects.toThrow("REPLICATE_CREDENTIAL_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
