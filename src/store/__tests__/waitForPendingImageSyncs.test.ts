/**
 * Unit tests for waitForPendingImageSyncs
 *
 * Tests the best-effort behavior: failed image syncs should not abort
 * workflow saves — they should log a warning and let the save proceed.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { __testing } from "../workflowStore";

const { waitForPendingImageSyncs, pendingImageSyncs } = __testing;

afterEach(() => {
  pendingImageSyncs.clear();
  vi.restoreAllMocks();
});

describe("waitForPendingImageSyncs", () => {
  it("resolves immediately when map is empty", async () => {
    await expect(waitForPendingImageSyncs()).resolves.toBeUndefined();
  });

  it("resolves without warning when all syncs resolve", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    pendingImageSyncs.set("a", Promise.resolve());
    pendingImageSyncs.set("b", Promise.resolve());

    await expect(waitForPendingImageSyncs()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolves (does not reject) when one sync rejects and logs a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const err = new Error("upload failed");
    pendingImageSyncs.set("fail", Promise.reject(err));
    pendingImageSyncs.set("ok", Promise.resolve());

    // Should RESOLVE, not reject — this is the regression test
    await expect(waitForPendingImageSyncs()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    const [msg, reasons] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/1 pending image sync\(s\) failed/);
    expect(reasons).toEqual([err]);
  });

  it("resolves via timeout when a sync never settles, warning about timeout", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A promise that never resolves or rejects
    const neverSettles = new Promise<void>(() => {});
    pendingImageSyncs.set("hanging", neverSettles);

    const racePromise = waitForPendingImageSyncs(50);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(100);

    await expect(racePromise).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/timed out after 50ms/);

    vi.useRealTimers();
  });
});
