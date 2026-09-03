import { z } from "zod";
import type { ReplicateClientPort, ReplicatePrediction } from "./replicate-contract";

const responseSchema = z.object({ id: z.string().min(1), status: z.enum(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]), output: z.unknown().optional(), error: z.string().nullable().optional() });
type FetchPort = typeof fetch;

/** Network implementation only; construction and tests make no provider calls. */
export class ReplicateHttpClient implements ReplicateClientPort {
  constructor(
    private readonly token: () => string | null = () => process.env.REPLICATE_API_TOKEN?.trim() || process.env.REPLICATE_API_KEY?.trim() || null,
    private readonly fetcher: FetchPort = fetch,
    private readonly baseUrl = "https://api.replicate.com/v1",
  ) {}
  create(input: { endpoint: "versioned" | "official_model"; model: string; version: string; input: Record<string, unknown> }) {
    if (input.endpoint === "official_model") {
      const [owner, name, ...extra] = input.model.split("/");
      if (!owner || !name || extra.length) throw new Error("REPLICATE_MODEL_ID_INVALID");
      return this.call(`/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`, { method: "POST", body: JSON.stringify({ input: input.input }) });
    }
    return this.call("/predictions", { method: "POST", body: JSON.stringify({ version: input.version, input: input.input }) });
  }
  get(id: string) { return this.call(`/predictions/${encodeURIComponent(id)}`, { method: "GET" }); }
  cancel(id: string) { return this.call(`/predictions/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
  private async call(path: string, init: RequestInit): Promise<ReplicatePrediction> {
    const token = this.token(); if (!token) throw new Error("REPLICATE_CREDENTIAL_UNAVAILABLE");
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!response.ok) throw new Error(`REPLICATE_HTTP_${response.status}`);
    return responseSchema.parse(await response.json());
  }
}
