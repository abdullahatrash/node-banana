import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PairAgentClient from "../PairAgentClient";

describe("PairAgentClient", () => {
  it("starts blank and offers only owner/admin Workspaces", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            workspaces: [
              { id: "member-ws", name: "Member", role: "member" },
              { id: "owner-ws", name: "Owner", role: "owner" },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            challenge: {
              agentName: "Publisher",
              keyName: "Laptop",
              requestedAccess: ["content.read"],
              expiresAt: "2026-07-24T13:05:00.000Z",
            },
          }),
          { status: 200 },
        ),
      );

    render(<PairAgentClient confirmationId="display-code-1" />);
    const selector = screen.getByLabelText("Workspace");
    expect(selector).toHaveValue("");
    expect(screen.getByRole("button", { name: "Approve pairing" })).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Owner (owner)" })).toBeVisible(),
    );
    expect(screen.queryByRole("option", { name: "Member (member)" })).toBeNull();

    await userEvent.selectOptions(selector, "owner-ws");
    await screen.findByText("content.read");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agents/pairing/display-code-1",
      { headers: { "x-workspace-id": "owner-ws" } },
    );
  });
});
