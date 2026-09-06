import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { ReviewGuestClient } from "../ReviewGuestClient";

function success(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ReviewGuestClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reuses the exact decision idempotency key after transport loss", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(success({
        sessionId: "session-1",
        sessionToken: "secret-session-token",
        purpose: "approve_publishing",
        resourceKind: "plan_revision",
        resourceId: "plan-revision-1",
        revisionDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAt: "2026-09-04T12:00:00.000Z",
      }))
      .mockResolvedValueOnce(success({ presentationDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", renderProof: null, planRevision: null }))
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(success({ decisionId: "decision-1" }));

    const user = userEvent.setup();
    render(<I18nTestProvider locale="en"><ReviewGuestClient reviewToken="review-token" /></I18nTestProvider>);

    await user.type(screen.getByLabelText("Six-digit verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and inspect" }));
    const reject = await screen.findByRole("button", { name: "Reject" });
    await user.click(reject);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await user.click(reject);
    await screen.findByText("Decision recorded");

    const firstDecision = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as { idempotencyKey: string };
    const retriedDecision = JSON.parse(String(fetchMock.mock.calls[3][1]?.body)) as { idempotencyKey: string };
    expect(firstDecision.idempotencyKey).toBeTruthy();
    expect(retriedDecision.idempotencyKey).toBe(firstDecision.idempotencyKey);
  });
});
