import { describe, expect, it, vi } from "vitest";
import type { OperationRecord } from "@/lib/agent-runtime/operation-status/types";
import { GenerationOperationControlAdapter } from "../operation-control";

const at = new Date("2026-09-04T00:00:00.000Z");
const operation = (state: OperationRecord["state"]): OperationRecord => ({
  schema: "operation-status/v1", id: "operation", workspaceId: "workspace", kind: "generation", resourceId: "intent", state, stage: state === "running" ? "provider.submit" : null,
  revision: state === "queued" ? 1 : 2, actor: { type: "human", userId: "user" }, metadata: { quoteAmountUsd: 0.05, quoteQuantity: 8 }, retryOfOperationId: null, createdAt: at, updatedAt: at,
});

describe("GenerationOperationControlAdapter", () => {
  it.each(["queued", "admitted"] as const)("settles %s cancellation as proven pre-start without provider contact", async (state) => {
    const settle = vi.fn(async () => undefined);
    const adapter = new GenerationOperationControlAdapter(() => ({}) as never, settle);
    expect(await adapter.cancel(operation(state))).toEqual({ kind: "confirmed_cancelled" });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace", intentId: "intent", outcome: { kind: "pre_start_cancelled" }, quotedAmountUsd: 0.4 }));
  });
});
