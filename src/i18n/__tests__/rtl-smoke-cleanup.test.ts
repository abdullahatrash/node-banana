import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import { terminateChild } from "../../../scripts/child-process-cleanup.mjs";

describe("RTL smoke child-process cleanup", () => {
  it("waits for delayed SIGTERM cleanup before resolving", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),75));process.stdout.write('ready');setInterval(()=>{},1000)",
    ]);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
    });

    const startedAt = Date.now();
    await terminateChild(child);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
    expect(child.exitCode === 0 || child.signalCode === "SIGTERM").toBe(true);
  });

  it("escalates to SIGKILL after the grace period", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
    ]);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
    });

    await terminateChild(child, { graceMs: 25 });

    expect(child.signalCode).toBe("SIGKILL");
  });
});
