import { createHmac, timingSafeEqual } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function verifyPromotionResponse(body, input, now = new Date()) {
  if (!body || body.success !== true || body.readiness?.releasable !== true || body.readiness?.parityClaimAllowed !== true) throw new Error("Release readiness did not pass.");
  if (body.readiness.buildId !== input.expectedBuildId || body.attestation?.buildId !== input.expectedBuildId) throw new Error("Readiness is not bound to the requested build.");
  if (body.attestation?.schema !== "release-readiness-attestation/v1" || body.attestation?.keyId !== input.keyId || body.attestation?.evaluatedAt !== body.readiness.evaluatedAt) throw new Error("Readiness attestation metadata is invalid.");
  const evaluatedAt = new Date(body.attestation.evaluatedAt); if (!Number.isFinite(evaluatedAt.getTime()) || evaluatedAt > now || evaluatedAt.getTime() < now.getTime() - 5 * 60_000) throw new Error("Readiness attestation is stale.");
  const payload = { keyId: input.keyId, decision: body.readiness }; const expected = `hmac-sha256:${createHmac("sha256", input.signingSecret).update(canonical(payload)).digest("hex")}`;
  const actual = String(body.attestation.signature || ""); const a = Buffer.from(expected); const b = Buffer.from(actual); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Readiness signature is invalid.");
  return body.readiness;
}

async function main() {
  const gateUrl = process.env.RELEASE_GATE_URL; const workspaceId = process.env.RELEASE_GATE_WORKSPACE_ID; const bearer = process.env.RELEASE_DEPLOYMENT_GATE_SECRET; const signingSecret = process.env.RELEASE_READINESS_SIGNING_SECRET; const keyId = process.env.RELEASE_READINESS_SIGNING_KEY_ID; const expectedBuildId = process.env.RELEASE_EXPECTED_BUILD_ID;
  if (!gateUrl || !workspaceId || !bearer || bearer.length < 32 || !signingSecret || signingSecret.length < 32 || !keyId || !expectedBuildId) throw new Error("Release promotion gate configuration is incomplete.");
  const url = new URL("/api/studio/internal/release-readiness", gateUrl); if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Release gate must use HTTPS."); url.searchParams.set("workspaceId", workspaceId);
  const response = await fetch(url, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) }); const body = await response.json();
  if (!response.ok) throw new Error(`Release gate rejected promotion with HTTP ${response.status}.`);
  const readiness = verifyPromotionResponse(body, { expectedBuildId, signingSecret, keyId });
  process.stdout.write(`Release promotion authorized for ${readiness.buildId}; ${readiness.parityMatrix.passingCells}/${readiness.parityMatrix.requiredCells} parity cells passed.\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Release promotion failed."}\n`); process.exitCode = 1; });
