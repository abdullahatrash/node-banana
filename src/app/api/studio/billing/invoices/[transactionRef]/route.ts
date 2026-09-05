import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { merchantBillingTransactions } from "@/lib/db/schema";
import { MERCHANT_OF_RECORD } from "@/lib/commercial/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ transactionRef: string }> };
const transactionRefSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/);

export const POST = withStudioAuth<Context>({ route: "/api/studio/billing/invoices/:transactionRef", action: "read", permission: "product:billing:read" }, async (_request: NextRequest, authz, context) => {
  const parsed = transactionRefSchema.safeParse((await context.params).transactionRef);
  if (!parsed.success) return NextResponse.json({ success: false, code: "BILLING_DOCUMENT_REFERENCE_INVALID" }, { status: 400 });
  const transactionRef = parsed.data;
  const [transaction] = await getDb().select({ transactionRef: merchantBillingTransactions.transactionRef }).from(merchantBillingTransactions).where(and(eq(merchantBillingTransactions.workspaceId, authz.workspaceId), eq(merchantBillingTransactions.transactionRef, transactionRef))).limit(1);
  if (!transaction) return NextResponse.json({ success: false, code: "BILLING_DOCUMENT_NOT_FOUND" }, { status: 404 });
  const invoice = await MERCHANT_OF_RECORD.createInvoiceLink({ workspaceId: authz.workspaceId, transactionRef: transaction.transactionRef });
  if (invoice.kind !== "ready") return NextResponse.json({ success: false, code: "BILLING_DOCUMENT_UNAVAILABLE" }, { status: 503 });
  const url = new URL(invoice.url);
  if (url.protocol !== "https:") return NextResponse.json({ success: false, code: "BILLING_DOCUMENT_UNSAFE" }, { status: 502 });
  return NextResponse.json({ success: true, invoice: { url: url.toString(), expiresAt: invoice.expiresAt.toISOString() } });
});
