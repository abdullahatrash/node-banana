import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { trustedReleaseGateEndpoint, verifyGateTransport, verifyPromotionResponse } from "./verify-release-promotion.mjs";

const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
const secret = "release-readiness-test-secret-at-least-32-bytes"; const keyId = "release-key-1"; const now = new Date("2026-09-04T00:00:00.000Z");
function response() { const readiness = { schema: "release-readiness-decision/v1", buildId: "commit-abc", evaluatedAt: now.toISOString(), releasable: true, parityClaimAllowed: true, parityMatrix: { requiredCells: 12, passingCells: 12 }, blockers: [] }; const signature = `hmac-sha256:${createHmac("sha256", secret).update(canonical({ keyId, decision: readiness })).digest("hex")}`; return { success: true, readiness, attestation: { schema: "release-readiness-attestation/v1", keyId, buildId: readiness.buildId, evaluatedAt: readiness.evaluatedAt, signature } }; }

test("accepts a fresh signed decision for the exact immutable build", () => assert.equal(verifyPromotionResponse(response(), { expectedBuildId: "commit-abc", signingSecret: secret, keyId }, now).buildId, "commit-abc"));
test("rejects tampered or mismatched readiness", () => { const tampered = response(); tampered.readiness.parityMatrix.passingCells = 11; assert.throws(() => verifyPromotionResponse(tampered, { expectedBuildId: "commit-abc", signingSecret: secret, keyId }, now), /signature/); assert.throws(() => verifyPromotionResponse(response(), { expectedBuildId: "commit-other", signingSecret: secret, keyId }, now), /requested build/); });
test("constructs the endpoint only from an allowlisted bare HTTPS origin", () => {
  assert.equal(trustedReleaseGateEndpoint("https://app.example.com/", "app.example.com,status.example.com", "workspace-1").href, "https://app.example.com/api/studio/internal/release-readiness?workspaceId=workspace-1");
  for (const origin of ["http://app.example.com/", "https://app.example.com.evil.test/", "https://user@app.example.com/", "https://app.example.com/path", "https://app.example.com/?next=evil", "https://app.example.com:8443/"]) assert.throws(() => trustedReleaseGateEndpoint(origin, "app.example.com", "workspace-1"));
});
test("rejects redirected or origin-changing transports", () => {
  const endpoint = trustedReleaseGateEndpoint("https://app.example.com/", "app.example.com", "workspace-1");
  assert.throws(() => verifyGateTransport({ redirected: true, url: "https://evil.test/steal" }, endpoint), /changed origin/);
  assert.throws(() => verifyGateTransport({ redirected: false, url: "https://evil.test/api/studio/internal/release-readiness" }, endpoint), /changed origin/);
  assert.doesNotThrow(() => verifyGateTransport({ redirected: false, url: endpoint.href }, endpoint));
});
