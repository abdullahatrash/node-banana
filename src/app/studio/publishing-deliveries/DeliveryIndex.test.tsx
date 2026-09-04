import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryIndex } from "./DeliveryIndex";

function response(result: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400
    ? { success: true, result }
    : result), { status, headers: { "content-type": "application/json" } });
}

function item(id: string, state = "scheduled") {
  return {
    id,
    state,
    targetId: `target_${id}`,
    publishAt: "2026-08-09T12:00:00.000Z",
    externallyCompleted: state === "outcome_unknown" ? null : false,
  };
}

function spend(suspended = false) {
  return {
    schema: "workspace-spend-control/v2", workspaceId: "workspace_1", suspended,
    revision: suspended ? 2 : 1, reason: suspended ? "Incident containment" : "Normal operations",
    actorUserId: "owner_1", recordedAt: "2026-08-09T10:00:00.000Z",
    policyEventId: suspended ? "spend_event_2" : "spend_event_1",
    authorizationEvidenceRef: "auth_spend_1",
  };
}

describe("DeliveryIndex", () => {
  beforeEach(() => window.localStorage.setItem("node-banana-active-workspace-id", "workspace_1"));
  afterEach(() => vi.unstubAllGlobals());

  it("discovers Workspace Deliveries and continues the sealed Human cursor", async () => {
    const calls: Array<{ capability: string; input: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string; input: Record<string, unknown> };
      calls.push(body);
      if (body.capability === "spend_controls.get@2") return response(spend());
      return body.input.cursor
        ? response({ schema: "publishing-delivery-page/v1", items: [item("delivery_1"), item("delivery_2", "outcome_unknown")], nextCursor: null })
        : response({ schema: "publishing-delivery-page/v1", items: [item("delivery_1")], nextCursor: "human_cursor_1" });
    }));
    render(<DeliveryIndex />);
    expect(await screen.findByRole("link", { name: /delivery_1/ })).toHaveAttribute("href", "/studio/publishing-deliveries/delivery_1");
    const more = screen.getByRole("button", { name: "Load more deliveries" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(await screen.findByRole("link", { name: /delivery_2/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(calls).toContainEqual({ capability: "publishing_deliveries.list@2", input: { limit: 50, cursor: "human_cursor_1" } });
    expect(calls.filter((call) => call.capability === "publishing_deliveries.list@2" && call.input.cursor === "human_cursor_1")).toHaveLength(1);
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("externally completed Unknown") === true)).toBeInTheDocument();
  });

  it("reloads from the selected canonical state filter", async () => {
    const calls: Array<{ input: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: Record<string, unknown> };
      const invocation = JSON.parse(String(init?.body)) as { capability: string; input: Record<string, unknown> };
      if (invocation.capability === "spend_controls.get@2") return response(spend());
      calls.push(body);
      return response({ schema: "publishing-delivery-page/v1", items: [], nextCursor: null });
    }));
    render(<DeliveryIndex />);
    await screen.findByText("No publishing deliveries match this canonical filter.");
    fireEvent.change(screen.getByLabelText("Current state"), { target: { value: "blocked" } });
    await waitFor(() => expect(calls.some((call) => call.input.state === "blocked")).toBe(true));
  });

  it("clears discovered Delivery evidence if cursor authorization is lost", async () => {
    let listCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string };
      if (body.capability === "spend_controls.get@2") return response(spend());
      listCount += 1;
      return listCount === 1
        ? response({ schema: "publishing-delivery-page/v1", items: [item("delivery_1")], nextCursor: "human_cursor_1" })
        : response({ success: false, error: "Membership was revoked." }, 403);
    }));
    render(<DeliveryIndex />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more deliveries" }));
    expect(await screen.findByText("Authorization was lost", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("delivery_1")).not.toBeInTheDocument();
  });

  it("operates and reconstructs Workspace spend suspension with zero Deliveries", async () => {
    let current = spend(false);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string; input: Record<string, unknown> };
      calls.push(body.capability);
      if (body.capability === "publishing_deliveries.list@2") return response({ schema: "publishing-delivery-page/v1", items: [], nextCursor: null });
      if (body.capability === "spend_controls.get@2") return response(current);
      if (body.capability === "spend_controls.suspend@2") {
        current = { ...spend(true), reason: String(body.input.reason) };
        return response(current);
      }
      throw new Error(`Unhandled ${body.capability}`);
    }));
    render(<DeliveryIndex />);
    expect(await screen.findByText("No publishing deliveries match this canonical filter.")).toBeInTheDocument();
    const control = screen.getByRole("region", { name: "Workspace emergency spend suspension" });
    fireEvent.change(within(control).getByLabelText("Workspace policy reason"), { target: { value: "Incident containment" } });
    fireEvent.click(within(control).getByRole("button", { name: "Enable emergency spend suspension" }));
    expect(await within(control).findByText("Suspended")).toBeInTheDocument();
    expect(within(control).getByText("spend_event_2", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(control).getByRole("button", { name: "Reload spend control" }));
    await waitFor(() => expect(calls.filter((capability) => capability === "spend_controls.get@2").length).toBeGreaterThanOrEqual(3));
    expect(within(control).getByText("Incident containment")).toBeInTheDocument();
  });

  it("keeps an exact spend-action denial local after a successful core membership recheck", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string };
      calls.push(body.capability);
      if (body.capability === "publishing_deliveries.list@2") return response({ schema: "publishing-delivery-page/v1", items: [], nextCursor: null });
      if (body.capability === "spend_controls.get@2") return response(spend());
      if (body.capability === "spend_controls.suspend@2") return response({ success: false, error: "Emergency spend authority denied." }, 403);
      throw new Error(`Unhandled ${body.capability}`);
    }));
    render(<DeliveryIndex />);
    const control = await screen.findByRole("region", { name: "Workspace emergency spend suspension" });
    fireEvent.change(within(control).getByLabelText("Workspace policy reason"), { target: { value: "Incident" } });
    fireEvent.click(within(control).getByRole("button", { name: "Enable emergency spend suspension" }));
    expect(await within(control).findByRole("alert")).toHaveTextContent("Emergency spend authority denied");
    expect(within(control).getByText("Not suspended")).toBeInTheDocument();
    expect(calls.filter((capability) => capability === "publishing_deliveries.list@2").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a spend mutation operational failure without an unnecessary membership recheck", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string };
      calls.push(body.capability);
      if (body.capability === "publishing_deliveries.list@2") return response({ schema: "publishing-delivery-page/v1", items: [], nextCursor: null });
      if (body.capability === "spend_controls.get@2") return response(spend());
      if (body.capability === "spend_controls.suspend@2") return response({ success: false, error: "Spend-control persistence unavailable." }, 500);
      throw new Error(`Unhandled ${body.capability}`);
    }));
    render(<DeliveryIndex />);
    const control = await screen.findByRole("region", { name: "Workspace emergency spend suspension" });
    fireEvent.change(within(control).getByLabelText("Workspace policy reason"), { target: { value: "Incident" } });
    fireEvent.click(within(control).getByRole("button", { name: "Enable emergency spend suspension" }));
    expect(await within(control).findByRole("alert")).toHaveTextContent("Spend-control persistence unavailable");
    expect(calls.filter((capability) => capability === "publishing_deliveries.list@2")).toHaveLength(1);
    expect(calls.filter((capability) => capability === "spend_controls.get@2").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the action denial visible when its membership recheck is inconclusive", async () => {
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { capability: string };
      if (body.capability === "publishing_deliveries.list@2") {
        listCalls += 1;
        return listCalls === 1
          ? response({ schema: "publishing-delivery-page/v1", items: [], nextCursor: null })
          : response({ success: false, error: "Membership evidence store unavailable." }, 500);
      }
      if (body.capability === "spend_controls.get@2") return response(spend());
      if (body.capability === "spend_controls.suspend@2") return response({ success: false, error: "Emergency spend authority denied." }, 403);
      throw new Error(`Unhandled ${body.capability}`);
    }));
    render(<DeliveryIndex />);
    const control = await screen.findByRole("region", { name: "Workspace emergency spend suspension" });
    fireEvent.change(within(control).getByLabelText("Workspace policy reason"), { target: { value: "Incident" } });
    fireEvent.click(within(control).getByRole("button", { name: "Enable emergency spend suspension" }));
    const alert = await within(control).findByRole("alert");
    expect(alert).toHaveTextContent("Emergency spend authority denied");
    expect(alert).toHaveTextContent("Core membership evidence is unavailable");
    expect(within(control).getByText("Not suspended")).toBeInTheDocument();
    expect(screen.queryByText("Authorization was lost", { exact: false })).not.toBeInTheDocument();
  });

  it("prompts for Workspace selection without misclassifying it as authorization loss", async () => {
    window.localStorage.removeItem("node-banana-active-workspace-id");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DeliveryIndex />);
    expect(await screen.findByText("Select a Workspace before inspecting publishing deliveries.")).toBeInTheDocument();
    expect(screen.queryByText("Authorization was lost", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Workspace emergency spend suspension" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
