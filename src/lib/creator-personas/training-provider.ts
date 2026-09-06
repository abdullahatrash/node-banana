import { z } from "zod";
import type { PersonaReusableModelRef } from "./types";

export type PersonaTrainingProviderState =
  | { state: "queued" | "running"; providerJobRef: string }
  | { state: "succeeded"; providerJobRef: string; model: PersonaReusableModelRef }
  | { state: "failed_known" | "cancelled"; providerJobRef: string | null; failureCode: string }
  | { state: "outcome_unknown"; providerJobRef: string | null; failureCode: string };

export interface PersonaTrainingProviderPort {
  submit(input: { idempotencyKey: string; model: string; modelVersion: string; qualificationDigest: string; sources: Array<{ assetId: string; checksum: string; url: string }> }): Promise<PersonaTrainingProviderState>;
  recover(input: { idempotencyKey: string; providerJobRef: string | null }): Promise<PersonaTrainingProviderState>;
}

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const resultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["queued", "running"]), providerJobRef: z.string().min(1).max(500) }).strict(),
  z.object({ state: z.literal("succeeded"), providerJobRef: z.string().min(1).max(500), model: z.object({ schema: z.literal("creator-persona-model/v1"), provider: z.literal("replicate"), model: z.string().min(1).max(200), version: z.string().min(1).max(200), inputSchemaDigest: digest, qualificationDigest: digest, trainingJobId: z.string().min(1).max(200) }).strict() }).strict(),
  z.object({ state: z.enum(["failed_known", "cancelled"]), providerJobRef: z.string().min(1).max(500).nullable(), failureCode: z.string().min(1).max(100) }).strict(),
  z.object({ state: z.literal("outcome_unknown"), providerJobRef: z.string().min(1).max(500).nullable(), failureCode: z.string().min(1).max(100) }).strict(),
]);

type Environment = Readonly<Record<string, string | undefined>>;
function required(environment: Environment, key: string) { const value = environment[key]?.trim(); if (!value) throw new Error(`PERSONA_TRAINING_CONFIGURATION_REQUIRED:${key}`); return value; }
function safeEndpoint(value: string) { const url = new URL(value); if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("PERSONA_TRAINING_GATEWAY_UNSAFE"); return url; }

/**
 * Fail-closed production boundary for an idempotent Replicate training gateway.
 * The gateway owns provider secrets and must support lookup by our stable job id,
 * so a timeout after provider acceptance remains durably recoverable.
 */
export class ReplicatePersonaTrainingGateway implements PersonaTrainingProviderPort {
  private readonly endpoint: URL;
  private readonly token: string;
  constructor(environment: Environment = process.env, private readonly fetcher: typeof fetch = fetch) {
    this.endpoint = safeEndpoint(required(environment, "REPLICATE_PERSONA_TRAINING_GATEWAY_URL"));
    this.token = required(environment, "REPLICATE_PERSONA_TRAINING_GATEWAY_TOKEN");
  }
  submit(input: Parameters<PersonaTrainingProviderPort["submit"]>[0]) { return this.call("trainings", { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) }); }
  recover(input: Parameters<PersonaTrainingProviderPort["recover"]>[0]) {
    const url = new URL(`trainings/by-idempotency-key/${encodeURIComponent(input.idempotencyKey)}`, this.endpoint);
    if (input.providerJobRef) url.searchParams.set("providerJobRef", input.providerJobRef);
    return this.call(url, { method: "GET" });
  }
  private async call(path: string | URL, init: RequestInit) {
    const response = await this.fetcher(path instanceof URL ? path : new URL(path, this.endpoint), { ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...init.headers }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`PERSONA_TRAINING_GATEWAY_HTTP_${response.status}`);
    return resultSchema.parse(await response.json());
  }
}
