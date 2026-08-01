import { describe, expect, it } from "vitest";
import { AesGcmObservabilityCursorCodec, observabilityCursorKeysFromEnvironment } from "../cursor";

const oldKey = new Uint8Array(32).fill(1);
const nextKey = new Uint8Array(32).fill(2);
const payload = { scope: "operational_metrics/v1" as const, workspaceId: "workspace_1", recordedAt: "2026-08-01T12:00:00.000Z", id: "oma_1" };

describe("AesGcmObservabilityCursorCodec", () => {
  it("encrypts workspace-bound cursor contents and supports key rotation", async () => { const old = new AesGcmObservabilityCursorCodec(() => ({ active: { id: "old", key: oldKey }, all: [{ id: "old", key: oldKey }] })); const token = await old.encode(payload); expect(token).not.toContain("workspace_1"); const rotated = new AesGcmObservabilityCursorCodec(() => ({ active: { id: "next", key: nextKey }, all: [{ id: "next", key: nextKey }, { id: "old", key: oldKey }] })); await expect(rotated.decode(token)).resolves.toEqual(payload); });
  it("rejects tampering and unknown keys", async () => { const codec = new AesGcmObservabilityCursorCodec(() => ({ active: { id: "old", key: oldKey }, all: [{ id: "old", key: oldKey }] })); const token = await codec.encode(payload); await expect(codec.decode(`${token.slice(0, -1)}x`)).resolves.toBeNull(); const unknown = new AesGcmObservabilityCursorCodec(() => ({ active: { id: "next", key: nextKey }, all: [{ id: "next", key: nextKey }] })); await expect(unknown.decode(token)).resolves.toBeNull(); });
  it("parses production rotation keys and rejects malformed configuration", () => { const prior = process.env.OBSERVABILITY_CURSOR_KEYS; try { process.env.OBSERVABILITY_CURSOR_KEYS = `active:${Buffer.from(nextKey).toString("base64url")},old:${Buffer.from(oldKey).toString("base64url")}`; expect(observabilityCursorKeysFromEnvironment()).toMatchObject({ active: { id: "active" }, all: [{ id: "active" }, { id: "old" }] }); process.env.OBSERVABILITY_CURSOR_KEYS = "broken"; expect(() => observabilityCursorKeysFromEnvironment()).toThrow("OBSERVABILITY_CURSOR_KEYS is invalid"); } finally { if (prior === undefined) delete process.env.OBSERVABILITY_CURSOR_KEYS; else process.env.OBSERVABILITY_CURSOR_KEYS = prior; } });
});
