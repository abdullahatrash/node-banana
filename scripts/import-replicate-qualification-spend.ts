import "./_load-env";

import { z } from "zod";

import { readConfiguredSecret } from "@/lib/configured-secret";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function receiptsUrl() {
  const configured = process.env.QUALIFICATION_SPEND_OBSERVER_URL?.trim();
  if (!configured) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:QUALIFICATION_SPEND_OBSERVER_URL");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw new Error("QUALIFICATION_ENDPOINT_UNSAFE:QUALIFICATION_SPEND_OBSERVER_URL");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/receipts`;
  url.search = "";
  return url;
}

async function request(url: URL, init: RequestInit = {}) {
  const token = readConfiguredSecret(process.env.QUALIFICATION_HARNESS_TOKEN);
  if (!token || token.length < 32) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:QUALIFICATION_HARNESS_TOKEN");
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({ success: false, code: "QUALIFICATION_SPEND_RESPONSE_INVALID" }));
  if (!response.ok) throw new Error(`${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function run() {
  if (process.argv.includes("--execute-paid-smoke")) throw new Error("This evidence command never executes provider predictions.");
  if (process.argv.includes("--list")) {
    const url = receiptsUrl();
    url.searchParams.set("limit", argument("--limit") ?? "25");
    process.stdout.write(`${JSON.stringify(await request(url), null, 2)}\n`);
    return;
  }
  if (!process.argv.includes("--confirm-exact-prediction-charge")) {
    throw new Error("Refusing import: add --confirm-exact-prediction-charge only after the evidence identifies this exact prediction and charge.");
  }
  const url = receiptsUrl();
  const parsed = z.object({
    runId: z.string().min(3).max(200),
    caseId: z.string().min(3).max(100),
    predictionId: z.string().min(1).max(200),
    amountUsd: z.coerce.number().nonnegative().lt(0.4),
    providerObservedAt: z.string().datetime({ offset: true }),
    providerEvidenceKind: z.enum(["replicate_account_usage_export", "replicate_invoice", "replicate_account_screenshot"]),
    providerEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    importedBy: z.string().min(3).max(200),
    notes: z.string().min(3).max(2_000),
    exactPredictionChargeConfirmed: z.literal(true),
  }).strict().parse({
    runId: argument("--run"),
    caseId: argument("--case"),
    predictionId: argument("--prediction"),
    amountUsd: argument("--amount"),
    providerObservedAt: argument("--observed-at"),
    providerEvidenceKind: argument("--evidence-kind"),
    providerEvidenceDigest: argument("--evidence-digest"),
    importedBy: argument("--reviewer"),
    notes: argument("--notes"),
    exactPredictionChargeConfirmed: true,
  });
  process.stdout.write(`${JSON.stringify(await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) }), null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Qualification spend evidence import failed."}\n`);
  process.exitCode = 1;
});
