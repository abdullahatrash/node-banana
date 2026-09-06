import { once } from "node:events";

export async function terminateChild(child, { graceMs = 2_000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const closed = once(child, "close").then(() => undefined);
  if (!child.killed) child.kill("SIGTERM");

  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (graceful) return;

  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await closed;
}
