import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rows: [] as Array<{ transactionRef: string }>, createInvoice: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }) }),
}));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => mocks.authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/commercial/production", () => ({ MERCHANT_OF_RECORD: { createInvoiceLink: (...args: unknown[]) => mocks.createInvoice(...args) } }));

import { POST } from "./route";

describe("billing invoice link route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [{ transactionRef: "txn_01test" }];
    mocks.authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1" });
    mocks.createInvoice.mockResolvedValue({ kind: "ready", url: "https://paddle-invoices.example/invoice.pdf", expiresAt: new Date("2026-09-05T13:00:00.000Z") });
  });

  it("creates an expiring merchant link only after the transaction is found in the authorized workspace", async () => {
    const response = await POST(new NextRequest("http://localhost/api/studio/billing/invoices/txn_01test", { method: "POST", headers: { "x-workspace-id": "workspace-1" } }), { params: Promise.resolve({ transactionRef: "txn_01test" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, invoice: { url: "https://paddle-invoices.example/invoice.pdf" } });
    expect(mocks.createInvoice).toHaveBeenCalledWith({ workspaceId: "workspace-1", transactionRef: "txn_01test" });
  });

  it("does not ask the merchant for an unknown workspace transaction", async () => {
    mocks.rows = [];
    const response = await POST(new NextRequest("http://localhost/api/studio/billing/invoices/txn_foreign", { method: "POST", headers: { "x-workspace-id": "workspace-1" } }), { params: Promise.resolve({ transactionRef: "txn_foreign" }) });
    expect(response.status).toBe(404);
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it("rejects malformed provider references before touching the database or merchant", async () => {
    const response = await POST(new NextRequest("http://localhost/api/studio/billing/invoices/bad", { method: "POST", headers: { "x-workspace-id": "workspace-1" } }), { params: Promise.resolve({ transactionRef: "../private?token=1" }) });
    expect(response.status).toBe(400);
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });
});
