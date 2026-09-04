import { z } from "zod";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { readConfiguredSecret } from "@/lib/configured-secret";
import { CURATED_MODELS } from "./catalog";

const inputSchema = z.object({
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    default: z.unknown().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minItems: z.number().int().optional(),
    maxItems: z.number().int().optional(),
  }).passthrough()),
}).passthrough();

const officialModel = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  latest_version: z.object({
    id: z.string().min(1).nullable().optional(),
    openapi_schema: z.object({
      components: z.object({
        schemas: z.object({ Input: inputSchema }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

type InspectorEnvironment = Readonly<Record<string, string | undefined>>;

function apiBase(environment: InspectorEnvironment) {
  const url = new URL(environment.REPLICATE_QUALIFICATION_API_BASE_URL?.trim() || "https://api.replicate.com/v1/");
  if (url.protocol !== "https:") throw new Error("QUALIFICATION_REPLICATE_API_BASE_UNSAFE");
  return url;
}

function schemaType(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join("|") : value ?? "unknown";
}

/**
 * Performs one authenticated Official Model metadata GET. It never creates a
 * prediction and never sends prompts, Brand data, media, or Workspace secrets.
 */
export async function inspectReplicateQualificationContract(input: {
  model: string;
  environment?: InspectorEnvironment;
  fetcher?: typeof fetch;
  at?: Date;
}) {
  const environment = input.environment ?? process.env;
  const fetcher = input.fetcher ?? fetch;
  const at = input.at ?? new Date();
  const token = readConfiguredSecret(environment.REPLICATE_QUALIFICATION_API_TOKEN);
  if (!token) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:REPLICATE_QUALIFICATION_API_TOKEN");
  const curated = CURATED_MODELS.find((candidate) => candidate.provider === "replicate" && candidate.model === input.model);
  if (!curated) throw new Error("QUALIFICATION_MODEL_NOT_CURATED");
  const [owner, name, extra] = input.model.split("/");
  if (!owner || !name || extra) throw new Error("QUALIFICATION_MODEL_ID_INVALID");

  const url = new URL(`models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, apiBase(environment));
  const response = await fetcher(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`QUALIFICATION_REPLICATE_HTTP_${response.status}`);
  const model = officialModel.parse(await response.json());
  if (`${model.owner}/${model.name}` !== input.model) throw new Error("QUALIFICATION_MODEL_IDENTITY_MISMATCH");
  const schema = model.latest_version.openapi_schema.components.schemas.Input;
  const required = new Set(schema.required ?? []);

  return {
    schema: "replicate-qualification-contract-inspection/v1" as const,
    inspectedAt: at.toISOString(),
    paidCallsMade: false as const,
    request: { method: "GET" as const, resource: `models/${owner}/${name}` },
    target: { endpoint: "official" as const, model: input.model, version: input.model },
    curatedCapabilities: [...curated.capabilities],
    inputSchemaDigest: canonicalDigest(schema) as `sha256:${string}`,
    requiredInputKeys: [...required].sort(),
    inputs: Object.entries(schema.properties).sort(([left], [right]) => left.localeCompare(right)).map(([key, property]) => ({
      key,
      required: required.has(key),
      type: schemaType(property.type),
      ...(property.format ? { format: property.format } : {}),
      ...(property.enum ? { enum: property.enum } : {}),
      ...(Object.hasOwn(property, "default") ? { default: property.default } : {}),
      ...(property.minimum !== undefined ? { minimum: property.minimum } : {}),
      ...(property.maximum !== undefined ? { maximum: property.maximum } : {}),
      ...(property.minItems !== undefined ? { minItems: property.minItems } : {}),
      ...(property.maxItems !== undefined ? { maxItems: property.maxItems } : {}),
    })),
    reviewRequired: [
      "Confirm the exact prompt, aspect-ratio, quantity, media, and safety mappings.",
      "Capture current commercial/derivative-use license evidence and its SHA-256 digest.",
      "Capture current pricing evidence and its SHA-256 digest; catalog estimates are not qualification evidence.",
      "Run the bilingual, Arabic-variety, Brand-reference, 9:16, ingestion, webhook, cancellation, and spend-controlled qualification matrix.",
    ],
  };
}
