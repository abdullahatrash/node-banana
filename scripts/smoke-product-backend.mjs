import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const baseUrl = new URL(process.env.APP_BASE_URL || "http://localhost:3002");
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname)) {
  throw new Error("The product-backend smoke accepts loopback URLs only.");
}

const cookieJar = new Map();
let workspaceId = "";

function captureCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of setCookies) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers || {}) },
    redirect: init.redirect || "manual",
  });
  captureCookies(response);
  return response;
}

async function jsonResponse(path, init = {}) {
  const response = await request(path, init);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${path} returned a non-JSON response (HTTP ${response.status}).`);
  }
  return { response, body };
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSuccess(result, label) {
  requireCondition(result.response.ok, `${label} returned HTTP ${result.response.status}.`);
  requireCondition(result.body && result.body.success === true, `${label} did not return success.`);
  return result.body;
}

function sortedKeys(value) {
  return Object.keys(value).sort().join(",");
}

function assertCredentialSummariesAreSafe(keys) {
  requireCondition(Array.isArray(keys), "Provider credentials did not return a list.");
  const allowed = ["hint", "lastValidatedAt", "provider", "updatedAt"].sort().join(",");
  for (const key of keys) {
    requireCondition(key && typeof key === "object" && !Array.isArray(key), "A provider credential summary is invalid.");
    requireCondition(sortedKeys(key) === allowed, "A provider credential response exposed fields outside the safe summary contract.");
    requireCondition(typeof key.provider === "string" && typeof key.hint === "string", "A provider credential summary is incomplete.");
  }
}

function assertGenerationReadiness(value) {
  requireCondition(value?.schema === "generation-readiness/v1", "The generation-readiness projection has an unexpected schema.");
  requireCondition(Number.isInteger(value.qualifiedModelCount) && value.qualifiedModelCount >= 0, "The qualified-model count is invalid.");
  requireCondition(Array.isArray(value.qualifiedCapabilities), "The qualified-capability list is invalid.");
  const expectedGates = ["acceptedBrand", "byokCredential", "canonicalMediaStorage", "managedCredential", "managedCreditRate", "processingRegion"];
  requireCondition(sortedKeys(value.gates || {}) === expectedGates.sort().join(","), "The generation-readiness gates are incomplete.");
  for (const gate of expectedGates) requireCondition(typeof value.gates[gate] === "boolean", `Generation-readiness gate ${gate} is not boolean.`);
}

function gateSummary(gates) {
  return Object.entries(gates).map(([name, ready]) => `${name}=${ready ? "ready" : "blocked"}`).join(", ");
}

const signIn = await jsonResponse("/api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: baseUrl.origin },
  body: JSON.stringify({
    email: process.env.SMOKE_EMAIL || "alice@nodebanana.dev",
    password: process.env.SMOKE_PASSWORD || "Password123!",
  }),
});
requireCondition(signIn.response.ok && cookieHeader(), "Seeded-user sign-in failed.");

const workspaceResult = await jsonResponse("/api/studio/workspaces");
const workspaceBody = requireSuccess(workspaceResult, "Workspace list");
const requestedWorkspaceId = process.env.SMOKE_WORKSPACE_ID || "seed_ws_alice";
workspaceId = workspaceBody.workspaces?.find((workspace) => workspace.id === requestedWorkspaceId)?.id || "";
requireCondition(workspaceId, `Seeded Workspace ${requestedWorkspaceId} is not available to the signed-in user.`);
const workspaceHeaders = { "x-workspace-id": workspaceId };
console.log(`[OK] Authentication + Workspace authorization (${workspaceId})`);

const onboardingBody = requireSuccess(await jsonResponse("/api/onboarding"), "Onboarding snapshot");
requireCondition(onboardingBody.snapshot?.workspaceId === workspaceId, "Onboarding resolved a different Workspace.");
requireCondition(typeof onboardingBody.snapshot?.activeBrandProfileId === "string", "No accepted active Brand Profile is available.");
requireCondition(onboardingBody.snapshot?.activationArtifactId, "The accepted Brand Profile has no activation artifact.");
console.log("[OK] Accepted Brand memory + activation artifact");

const billingBefore = requireSuccess(await jsonResponse("/api/studio/billing", { headers: workspaceHeaders }), "Billing summary").data;
requireCondition(Array.isArray(billingBefore?.plans) && billingBefore.plans.length > 0, "No active billing plans are available.");
requireCondition(Array.isArray(billingBefore?.creditPacks) && billingBefore.creditPacks.length > 0, "No active Generation Credit packs are available.");
requireCondition(Number.isInteger(billingBefore?.credit?.availableUnits) && billingBefore.credit.availableUnits >= 0, "The Generation Credit balance is invalid.");
requireCondition(Array.isArray(billingBefore.credit.buckets), "The Generation Credit bucket list is invalid.");
console.log(`[OK] Pricing + Generation Credits (${billingBefore.plans.length} plans, ${billingBefore.creditPacks.length} packs, ${billingBefore.credit.availableUnits} available)`);

const inspirationBody = requireSuccess(await jsonResponse("/api/product-inspiration?limit=5", { headers: workspaceHeaders }), "Inspiration feed");
requireCondition(Array.isArray(inspirationBody.items), "The Inspiration feed did not return a list.");
console.log(`[OK] Brand-ranked Inspiration feed (${inspirationBody.items.length} sampled)`);

const keysBody = requireSuccess(await jsonResponse("/api/keys", { headers: workspaceHeaders }), "Provider credential summaries");
assertCredentialSummariesAreSafe(keysBody.keys);
console.log(`[OK] Workspace provider vault read contract (${keysBody.keys.length} masked summaries, no secret fields)`);

const catalogBody = requireSuccess(await jsonResponse("/api/studio/model-routing/catalog", { headers: workspaceHeaders }), "Model-routing catalog");
requireCondition(Array.isArray(catalogBody.items) && catalogBody.items.length > 0, "The curated model catalog is empty.");
assertGenerationReadiness(catalogBody.generationReadiness);
console.log(`[OK] Model catalog + execution readiness (${catalogBody.items.length} models; ${gateSummary(catalogBody.generationReadiness.gates)})`);

const noSpendAdmission = await jsonResponse("/api/studio/generations", {
  method: "POST",
  headers: {
    ...workspaceHeaders,
    "content-type": "application/json",
    "idempotency-key": `smoke-no-spend-${randomUUID()}`,
    origin: baseUrl.origin,
  },
  body: JSON.stringify({
    prompt: "No-spend admission boundary probe",
    model: {
      provider: "replicate",
      model: "node-banana/no-spend-smoke-model",
      version: "not-qualified-smoke-version",
      inputSchemaDigest: `sha256:${"0".repeat(64)}`,
    },
    capability: "text_to_image",
    contentLanguage: "en",
    arabicVariety: null,
    quantity: 1,
    sourceAssetIds: [],
    rightsBasis: "owned",
    permittedRemix: "transform",
    rightsEvidenceIds: [],
    remixBrief: { preserve: [], transform: [], avoid: [] },
    fundingMode: "managed",
    personaId: null,
    contentExecution: null,
    blitzContext: null,
  }),
});
requireCondition(noSpendAdmission.response.status === 422, `No-spend generation admission returned HTTP ${noSpendAdmission.response.status}, expected 422.`);
requireCondition(noSpendAdmission.body?.success === false && noSpendAdmission.body?.code === "MODEL_NOT_EXECUTABLE", "Generation did not fail closed at the unqualified-model gate.");

const billingAfter = requireSuccess(await jsonResponse("/api/studio/billing", { headers: workspaceHeaders }), "Post-probe billing summary").data;
requireCondition(billingAfter?.credit?.availableUnits === billingBefore.credit.availableUnits, "The fail-closed admission probe changed the Generation Credit balance.");
console.log("[OK] No-spend generation admission fails closed before provider dispatch; credits unchanged");

console.log("[OK] Product backend smoke passed without calling an AI provider");
