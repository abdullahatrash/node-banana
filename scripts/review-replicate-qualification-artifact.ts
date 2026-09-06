import "./_load-env";

import { z } from "zod";

import { readConfiguredSecret } from "@/lib/configured-secret";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function reviewUrl() {
  const configured = process.env.QUALIFICATION_INGESTION_URL?.trim();
  if (!configured) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:QUALIFICATION_INGESTION_URL");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw new Error("QUALIFICATION_ENDPOINT_UNSAFE:QUALIFICATION_INGESTION_URL");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/reviews`;
  url.search = "";
  return url;
}

async function request(url: URL, init: RequestInit = {}) {
  const token = readConfiguredSecret(process.env.QUALIFICATION_HARNESS_TOKEN);
  if (!token || token.length < 32) throw new Error("QUALIFICATION_CONFIGURATION_REQUIRED:QUALIFICATION_HARNESS_TOKEN");
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({ success: false, code: "QUALIFICATION_REVIEW_RESPONSE_INVALID" }));
  if (!response.ok) throw new Error(`${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function run() {
  if (process.argv.includes("--execute-paid-smoke")) throw new Error("This review command never executes provider predictions.");
  const url = reviewUrl();
  if (process.argv.includes("--list")) {
    const limit = argument("--limit") ?? "25";
    url.searchParams.set("limit", limit);
    process.stdout.write(`${JSON.stringify(await request(url), null, 2)}\n`);
    return;
  }
  const parsed = z.object({
    receiptId: z.string().regex(/^qai_[a-f0-9]{32}$/),
    reviewedContentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    decision: z.enum(["accepted", "rejected"]),
    reviewerId: z.string().min(3).max(200),
    method: z.enum(["operator_visual_review", "operator_playback_review"]),
    observedLanguages: z.array(z.enum(["ar", "en"])).min(1).max(2),
    notes: z.string().min(3).max(2_000),
  }).strict().parse({
    receiptId: argument("--receipt"),
    reviewedContentDigest: argument("--digest"),
    decision: argument("--decision"),
    reviewerId: argument("--reviewer"),
    method: argument("--method"),
    observedLanguages: (argument("--languages") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    notes: argument("--notes"),
  });
  process.stdout.write(`${JSON.stringify(await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) }), null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Qualification artifact review failed."}\n`);
  process.exitCode = 1;
});
