import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuotaCockpit } from "./QuotaCockpit";

function resultFor(capability: string) {
  if (capability === "quota_policies.list@1") {
    return {
      schema: "quota-policy-list/v1",
      items: [{
        policy: { id: "policy_1", scope: "workspace" },
        revision: {
          hardLimit: "2",
          warningThreshold: "1",
          exhaustionBehavior: "wait",
        },
      }],
    };
  }
  if (capability === "quota_policies.get_effective@1") {
    return {
      schema: "effective-quota-capacity-list/v1",
      items: [{
        policy: { id: "policy_1", dimension: "runtime.concurrent_runs@1", unit: "count" },
        revision: { hardLimit: "2" },
        committed: "2",
        available: "0",
        blockingReservationIds: ["reservation_1"],
        warning: true,
        exhausted: true,
        evaluatedAt: "2026-08-01T12:00:00.000Z",
      }],
    };
  }
  if (capability === "quota_reservations.list@1") {
    return {
      schema: "quota-reservation-list/v1",
      items: [{
        id: "reservation_1",
        runId: "run_1",
        policyRevisionId: "revision_1",
        dimension: { kind: "concurrency", unit: "count" },
        amount: "1",
        state: "held",
      }],
    };
  }
  if (capability === "quota_waits.list@1") {
    return {
      schema: "quota-wait-list/v1",
      items: [{
        id: "wait_1",
        runId: "run_2",
        state: "waiting",
        evidence: [{
          condition: "capacity_release",
          dimension: { kind: "concurrency", unit: "count" },
          requested: "1",
          available: "0",
          policyId: "policy_1",
          policyRevisionId: "revision_1",
        }],
        eligibleAt: null,
      }, {
        id: "wait_2",
        runId: "run_3",
        state: "resumed",
        resolutionReason: "capacity_available",
        resumedBy: { kind: "system" },
        resolvedAt: "2026-08-01T12:01:00.000Z",
        evidence: [{ condition: "window_renewal" }],
      }],
    };
  }
  return {
    schema: "workspace-spend-control/v1",
    workspaceId: "workspace_1",
    suspended: false,
  };
}

describe("QuotaCockpit", () => {
  beforeEach(() => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace_1");
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-resume-1" });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { capability: string };
      return new Response(JSON.stringify({
        success: true,
        capability: request.capability,
        result: resultFor(request.capability),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  it("exposes effective capacity, reservations, waits, warnings, blocks, and resumptions", async () => {
    render(<QuotaCockpit />);
    expect(await screen.findByText("Provider effects enabled")).toBeInTheDocument();
    expect(screen.getByText(/Run run_1/)).toBeInTheDocument();
    expect(screen.getByText(/Run run_2/)).toBeInTheDocument();
    expect(screen.getByText(/Resumed: capacity_available by system/)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    fireEvent.change(screen.getByLabelText("Capacity Principal ID"), {
      target: { value: "principal_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("Warning threshold reached")).toBeInTheDocument();
    expect(screen.getByText(/Capacity exhausted · blocks reservation_1/)).toBeInTheDocument();
  });

  it("re-evaluates the same wait with a stable server-owned idempotency key", async () => {
    render(<QuotaCockpit />);
    await screen.findByText(/Run run_2/);
    fireEvent.click(screen.getByRole("button", { name: "Re-evaluate and resume" }));
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([, init]) =>
        String(init?.body).includes("quota_waits.resume@1"));
      expect(new Headers(call?.[1]?.headers).get("idempotency-key")).toBe(
        "idempotency-resume-1",
      );
      expect(String(call?.[1]?.body)).toContain('"waitId":"wait_1"');
    });
  });

  it("requires an audit reason before changing emergency spend state", async () => {
    render(<QuotaCockpit />);
    await screen.findByText("Provider effects enabled");
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Record a reason");
  });

  it("reuses the spend-control idempotency key when a failed request is retried", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("spend-suspend-key-1")
        .mockReturnValueOnce("spend-suspend-key-2"),
    });
    let suspendAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)) as { capability: string };
      if (
        request.capability === "spend_controls.suspend@1" &&
        suspendAttempts++ === 0
      ) {
        return new Response(JSON.stringify({
          success: false,
          error: "Spend control update temporarily unavailable.",
        }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        success: true,
        capability: request.capability,
        result: resultFor(request.capability),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    render(<QuotaCockpit />);
    await screen.findByText("Provider effects enabled");
    fireEvent.change(screen.getByLabelText("Spend control reason"), {
      target: { value: "Provider incident" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) =>
        String(init?.body).includes("spend_controls.suspend@1"));
      expect(calls).toHaveLength(2);
      expect(calls.map(([, init]) =>
        new Headers(init?.headers).get("idempotency-key")))
        .toEqual(["spend-suspend-key-1", "spend-suspend-key-1"]);
    });
  });
});
