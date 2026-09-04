import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  ensureWorkspaceFreePlanInTransaction,
  FREE_PLAN_CREDIT_UNITS,
  FREE_PLAN_ID,
  FREE_PLAN_VERSION,
} from "../free-plan";

describe("Free plan provisioning", () => {
  it("pins the public Free catalog identity and allowance", () => {
    expect({
      planId: FREE_PLAN_ID,
      planVersion: FREE_PLAN_VERSION,
      creditUnits: FREE_PLAN_CREDIT_UNITS,
    }).toEqual({ planId: "free", planVersion: 1, creditUnits: 10 });
  });

  it("delegates provisioning to the transactional database boundary", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-04T12:00:00.000Z");

    await ensureWorkspaceFreePlanInTransaction(
      { execute } as never,
      { workspaceId: "ws_new", now },
    );

    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects malformed activation inputs before touching storage", async () => {
    const execute = vi.fn();

    await expect(
      ensureWorkspaceFreePlanInTransaction(
        { execute } as never,
        { workspaceId: " ", now: new Date("2026-09-04T12:00:00.000Z") },
      ),
    ).rejects.toThrow("FREE_PLAN_ACTIVATION_INPUT_INVALID");
    expect(execute).not.toHaveBeenCalled();
  });

  it("backfills and renews Free without overwriting another subscription", () => {
    const sql = readFileSync(
      "drizzle/0118_workspace_free_plan_activation.sql",
      "utf8",
    );

    expect(sql).toContain("ensure_workspace_free_plan_v1");
    expect(sql).toContain('AND w."deleted_at" IS NULL');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("FREE_PLAN_V1_CATALOG_INVALID");
    expect(sql).toContain("RETURN 'existing_non_free'");
    expect(sql).toContain('v_subscription."current_period_ends_at" <= p_now');
    expect(sql).toContain("'plan.free.renewed'");
    expect(sql).toContain("'system:commercial-free-plan'");
    expect(sql).toContain("'plan:free:1:subscription-revision:'");
    expect(sql).toContain("FREE_PLAN_ALLOWANCE_CONFLICT");
    expect(sql).toContain("FREE_PLAN_LEDGER_CONFLICT");
    expect(sql).toContain(
      'PERFORM public.ensure_workspace_free_plan_v1(v_workspace."id", clock_timestamp())',
    );
  });

  it("wires both production onboarding and lazy workspace repair", () => {
    const onboarding = readFileSync(
      "src/lib/onboarding/postgres-repository.ts",
      "utf8",
    );
    const studio = readFileSync("src/lib/studio/repository.ts", "utf8");

    expect(onboarding).toContain(
      "await ensureWorkspaceFreePlanInTransaction(tx, { workspaceId, now })",
    );
    expect(studio.match(/await ensureWorkspaceFreePlan\(/g)).toHaveLength(3);
  });
});
