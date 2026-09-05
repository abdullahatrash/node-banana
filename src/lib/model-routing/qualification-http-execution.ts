import { z } from "zod";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { readConfiguredSecret } from "@/lib/configured-secret";
import type { QualificationExecutionPort } from "./qualification-runner";
import { verifyQualificationSpendAuthorization, verifyQualificationSpendReceipt } from "./qualification-spend-receipt";

const terminal = z.enum(["succeeded", "failed", "canceled", "aborted"]);
const predictionSchema = z.object({ id: z.string().min(1), status: z.enum(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]), model: z.string().min(1).nullable().optional(), version: z.string().min(1).nullable().optional(), output: z.unknown().optional() }).passthrough();
const observerSchema = z.object({ authentic: z.literal(true), deliveryId: z.string().min(1), predictionId: z.string().min(1), version: z.string().min(1), status: terminal }).strict();
const recoveredSubmissionSchema = z.object({ predictionId: z.string().min(1), version: z.string().min(1) }).strict();
const ingestionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("media"), receiptId: z.string().min(1), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), itemCount: z.number().int().positive().max(8), items: z.array(z.object({ contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), durationSeconds: z.number().nonnegative().nullable(), fps: z.number().positive().nullable() }).strict()).min(1).max(8), width: z.number().int().positive(), height: z.number().int().positive(), durationSeconds: z.number().nonnegative().nullable(), fps: z.number().positive().nullable(), observedLanguages: z.array(z.enum(["ar", "en"])).min(1), languageEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("text"), receiptId: z.string().min(1), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), characterCount: z.number().int().positive(), observedLanguages: z.array(z.enum(["ar", "en"])).min(1), languageEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
]);
const accountSchema = z.object({ username: z.string().min(1).max(200) }).passthrough();
const versionSchema = z.object({ openapi_schema: z.object({ components: z.object({ schemas: z.object({ Input: z.object({ properties: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough() }).passthrough() }).passthrough() }).passthrough();
const officialModelSchema = z.object({ owner: z.string().min(1), name: z.string().min(1), latest_version: versionSchema }).passthrough();

type QualificationEnvironment = Readonly<Record<string, string | undefined>>;

function required(environment: QualificationEnvironment, key: string) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`QUALIFICATION_CONFIGURATION_REQUIRED:${key}`);
  return value;
}

function requiredSecret(environment: QualificationEnvironment, key: string) {
  const value = readConfiguredSecret(environment[key]);
  if (!value) throw new Error(`QUALIFICATION_CONFIGURATION_REQUIRED:${key}`);
  return value;
}

function endpoint(value: string, key: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") throw new Error(`QUALIFICATION_ENDPOINT_UNSAFE:${key}`);
  return url;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type Target = { endpoint: "versioned" | "official"; model: string; version: string };

function verifiedVersion(target: Target, prediction: z.infer<typeof predictionSchema>) {
  if (target.endpoint === "official") {
    if (prediction.model !== target.model || target.version !== target.model) throw new Error("QUALIFICATION_MODEL_IDENTITY_MISMATCH");
    return target.version;
  }
  if (prediction.version !== target.version) throw new Error("QUALIFICATION_VERSION_MISMATCH");
  return prediction.version;
}

/** Explicit operator-only network adapter. Constructing it performs no calls. */
export class ReplicateQualificationHttpExecution implements QualificationExecutionPort {
  private readonly apiToken: string;
  private readonly observerToken: string;
  private readonly apiBase: URL;
  private readonly webhookUrl: URL;
  private readonly observerUrl: URL;
  private readonly ingestionUrl: URL;
  private readonly spendObserverUrl: URL;
  private readonly spendReceiptKeys: Readonly<Record<string, string>>;

  constructor(private readonly environment: QualificationEnvironment = process.env, private readonly fetcher: typeof fetch = fetch) {
    this.apiToken = requiredSecret(environment, "REPLICATE_QUALIFICATION_API_TOKEN");
    this.observerToken = requiredSecret(environment, "QUALIFICATION_HARNESS_TOKEN");
    this.apiBase = endpoint(environment.REPLICATE_QUALIFICATION_API_BASE_URL?.trim() || "https://api.replicate.com/v1/", "REPLICATE_QUALIFICATION_API_BASE_URL");
    this.webhookUrl = endpoint(required(environment, "QUALIFICATION_WEBHOOK_URL"), "QUALIFICATION_WEBHOOK_URL");
    this.observerUrl = endpoint(required(environment, "QUALIFICATION_WEBHOOK_OBSERVER_URL"), "QUALIFICATION_WEBHOOK_OBSERVER_URL");
    this.ingestionUrl = endpoint(required(environment, "QUALIFICATION_INGESTION_URL"), "QUALIFICATION_INGESTION_URL");
    this.spendObserverUrl = endpoint(required(environment, "QUALIFICATION_SPEND_OBSERVER_URL"), "QUALIFICATION_SPEND_OBSERVER_URL");
    const parsedKeys = z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(required(environment, "QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON")));
    if (Object.keys(parsedKeys).length === 0) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON");
    this.spendReceiptKeys = parsedKeys;
  }

  async identifyAccount() {
    const response = await this.replicate("account", { method: "GET" });
    const account = accountSchema.parse(await response.json());
    return { provider: "replicate" as const, accountId: account.username, credentialFingerprint: canonicalDigest(this.apiToken) as `sha256:${string}` };
  }

  async authorizeSpend(input: Parameters<QualificationExecutionPort["authorizeSpend"]>[0]) {
    const response = await this.harness(this.spendObserverUrl, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `qualification:${input.runId}:${input.caseId}` }, body: JSON.stringify({ kind: "authorize_qualification_spend", runId: input.runId, model: input.model, version: input.version, capability: input.capability, billableQuantity: input.billableQuantity, pricingLineItems: input.pricingLineItems, maximumAmountUsd: input.maximumAmountUsd, pricingSourceDigest: input.pricingSourceDigest, caseId: input.caseId, accountId: input.account.accountId, credentialFingerprint: input.account.credentialFingerprint }) });
    if (!response.ok) throw new Error(`QUALIFICATION_SPEND_AUTHORIZATION_HTTP_${response.status}`);
    return verifyQualificationSpendAuthorization(await response.json(), this.spendReceiptKeys, input);
  }

  async inspectSchema(input: Target) {
    const [owner, name, extra] = input.model.split("/");
    if (!owner || !name || extra) throw new Error("QUALIFICATION_MODEL_ID_INVALID");
    const path = input.endpoint === "official"
      ? `models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
      : `models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(input.version)}`;
    const response = await this.replicate(path, { method: "GET" });
    const raw = await response.json();
    const body = input.endpoint === "official" ? officialModelSchema.parse(raw).latest_version : versionSchema.parse(raw);
    if (input.endpoint === "official" && `${(raw as { owner: string }).owner}/${(raw as { name: string }).name}` !== input.model) throw new Error("QUALIFICATION_MODEL_IDENTITY_MISMATCH");
    const inputSchema = body.openapi_schema.components.schemas.Input;
    return { inputSchemaDigest: canonicalDigest(inputSchema) as `sha256:${string}`, inputKeys: Object.keys(inputSchema.properties) };
  }

  async submit(input: Target & { providerInput: Record<string, unknown>; cancelAfterSeconds: number; caseId: string; submissionKey: string }) {
    const webhook = new URL(this.webhookUrl);
    webhook.searchParams.set("caseId", input.caseId);
    webhook.searchParams.set("submissionKey", input.submissionKey);
    const [owner, name] = input.model.split("/");
    const path = input.endpoint === "official"
      ? `models/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/predictions`
      : "predictions";
    const body = input.endpoint === "official"
      ? { input: input.providerInput, webhook: webhook.toString(), webhook_events_filter: ["start", "completed"] }
      : { version: input.version, input: input.providerInput, webhook: webhook.toString(), webhook_events_filter: ["start", "completed"] };
    const response = await this.replicate(path, { method: "POST", headers: { "Cancel-After": `${input.cancelAfterSeconds}s`, Prefer: "respond-async" }, body: JSON.stringify(body) });
    const prediction = predictionSchema.parse(await response.json());
    return { predictionId: prediction.id, version: verifiedVersion(input, prediction), acceptedInput: structuredClone(input.providerInput) };
  }

  async recoverSubmission(input: Target & { caseId: string; submissionKey: string }) {
    const url = new URL(this.observerUrl); url.searchParams.set("submissionKey", input.submissionKey); url.searchParams.set("caseId", input.caseId);
    url.searchParams.set("endpoint", input.endpoint); url.searchParams.set("model", input.model); url.searchParams.set("version", input.version);
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await this.harness(url, { method: "GET" });
      if (response.status === 404) { await wait(2_000); continue; }
      if (!response.ok) throw new Error(`QUALIFICATION_SUBMISSION_RECOVERY_HTTP_${response.status}`);
      const recovered = recoveredSubmissionSchema.parse(await response.json());
      if (recovered.version !== input.version) throw new Error(`QUALIFICATION_VERSION_MISMATCH:${input.caseId}`);
      return recovered;
    }
    return null;
  }

  async awaitWebhook(input: Target & { predictionId: string; caseId: string }) {
    const url = new URL(this.observerUrl); url.searchParams.set("predictionId", input.predictionId); url.searchParams.set("caseId", input.caseId);
    url.searchParams.set("endpoint", input.endpoint); url.searchParams.set("model", input.model); url.searchParams.set("version", input.version);
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await this.harness(url, { method: "GET" });
      if (response.status === 404) { await wait(2_000); continue; }
      if (!response.ok) throw new Error(`QUALIFICATION_WEBHOOK_OBSERVER_HTTP_${response.status}`);
      const observed = observerSchema.parse(await response.json());
      if (observed.predictionId !== input.predictionId || observed.version !== input.version) throw new Error("QUALIFICATION_WEBHOOK_IDENTITY_MISMATCH");
      return { authentic: observed.authentic, deliveryId: observed.deliveryId, status: observed.status };
    }
    throw new Error("QUALIFICATION_WEBHOOK_TIMEOUT");
  }

  async poll(input: Target & { predictionId: string; caseId: string }) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await this.replicate(`predictions/${encodeURIComponent(input.predictionId)}`, { method: "GET" });
      const prediction = predictionSchema.parse(await response.json());
      const version = verifiedVersion(input, prediction);
      if (prediction.status === "starting" || prediction.status === "processing") { await wait(2_000); continue; }
      return { status: prediction.status, version, output: prediction.output };
    }
    throw new Error(`QUALIFICATION_POLL_TIMEOUT:${input.caseId}`);
  }

  async cancel(input: Target & { predictionId: string; caseId: string }) {
    const response = await this.replicate(`predictions/${encodeURIComponent(input.predictionId)}/cancel`, { method: "POST" });
    const prediction = predictionSchema.parse(await response.json());
    const version = verifiedVersion(input, prediction);
    if (prediction.status !== "canceled" && prediction.status !== "aborted") throw new Error(`QUALIFICATION_CANCEL_NOT_CONFIRMED:${input.caseId}`);
    return { status: prediction.status, version };
  }

  async ingest(input: Parameters<QualificationExecutionPort["ingest"]>[0]) {
    const response = await this.harness(this.ingestionUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (response.ok && response.status !== 202) return ingestionSchema.parse(await response.json()) as Awaited<ReturnType<QualificationExecutionPort["ingest"]>>;
    if (response.status !== 202 && response.status !== 404) throw new Error(`QUALIFICATION_INGESTION_HTTP_${response.status}`);
    const url = new URL(this.ingestionUrl);
    url.searchParams.set("predictionId", input.predictionId);
    url.searchParams.set("caseId", input.caseId);
    url.searchParams.set("capability", input.capability);
    url.searchParams.set("contentLanguage", input.contentLanguage);
    for (let attempt = 0; attempt < 450; attempt++) {
      const observed = await this.harness(url, { method: "GET" });
      if (observed.status === 202 || observed.status === 404) { await wait(2_000); continue; }
      if (!observed.ok) throw new Error(`QUALIFICATION_INGESTION_HTTP_${observed.status}`);
      return ingestionSchema.parse(await observed.json()) as Awaited<ReturnType<QualificationExecutionPort["ingest"]>>;
    }
    throw new Error(`QUALIFICATION_INGESTION_REVIEW_TIMEOUT:${input.caseId}`);
  }

  async reconcile(input: Target & { predictionId: string; caseId: string }) {
    const response = await this.replicate(`predictions/${encodeURIComponent(input.predictionId)}`, { method: "GET" });
    const prediction = predictionSchema.parse(await response.json());
    if (prediction.status === "starting" || prediction.status === "processing") throw new Error(`QUALIFICATION_RECONCILIATION_NOT_TERMINAL:${input.caseId}`);
    return { status: prediction.status, version: verifiedVersion(input, prediction) };
  }

  async observeSpend(input: Parameters<QualificationExecutionPort["observeSpend"]>[0]) {
    const url = new URL(this.spendObserverUrl);
    url.searchParams.set("predictionId", input.predictionId);
    url.searchParams.set("caseId", input.caseId);
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await this.harness(url, { method: "GET" });
      if (response.status === 404) { await wait(2_000); continue; }
      if (!response.ok) throw new Error(`QUALIFICATION_SPEND_OBSERVER_HTTP_${response.status}`);
      return verifyQualificationSpendReceipt(await response.json(), this.spendReceiptKeys, input);
    }
    throw new Error(`QUALIFICATION_SPEND_RECEIPT_TIMEOUT:${input.caseId}`);
  }

  private async replicate(path: string, init: RequestInit) {
    const response = await this.fetcher(new URL(path, this.apiBase), { ...init, headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json", ...init.headers }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`QUALIFICATION_REPLICATE_HTTP_${response.status}`);
    return response;
  }

  private harness(url: URL, init: RequestInit) {
    return this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${this.observerToken}`, ...init.headers }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  }
}
