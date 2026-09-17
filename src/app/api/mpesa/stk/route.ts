import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateQr } from "@/lib/etims";

export const dynamic = "force-dynamic";

/** In-memory STK push session store (Daraja simulator). */
interface StkSession {
  id: string;
  phone: string;
  amount: number;
  receiptNo: string | null;
  status: "Pending" | "Success" | "Failed";
  createdAt: number;
}
const sessions = new Map<string, StkSession>();
const RESOLVE_MS = 3500; // simulate user entering M-Pesa PIN after 3.5s

/** POST /api/mpesa/stk — initiate STK push (Daraja Simulator). */
export async function POST(req: NextRequest) {
  const { phone, amount, receiptNo } = await req.json();
  if (!phone || !amount) {
    return NextResponse.json({ ok: false, error: "Phone and amount required" }, { status: 400 });
  }

  const id = `ws_CO_${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  sessions.set(id, {
    id, phone: String(phone), amount: Number(amount),
    receiptNo: receiptNo ?? null, status: "Pending",
    createdAt: Date.now(),
  });

  // Settings touch (validate Daraja keys exist)
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (!settings?.mpesaConsumerKey) {
    return NextResponse.json({ ok: false, error: "M-Pesa Daraja keys not configured" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    checkoutRequestId: id,
    merchantRequestId: `29115-34620561-${Math.floor(Math.random() * 9)}`,
    responseDescription: "Success. Request accepted for processing",
    customerMessage: `An M-Pesa STK push has been sent to ${phone}. Enter your PIN to pay KES ${Number(amount).toLocaleString()}.`,
  });
}

/** GET /api/mpesa/stk?id= — poll STK status (C2B callback simulated). */
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const session = sessions.get(id);
  if (!session) return NextResponse.json({ ok: false, error: "Unknown checkout request" }, { status: 404 });

  if (session.status === "Pending" && Date.now() - session.createdAt > RESOLVE_MS) {
    session.status = "Success";
    // simulate C2B callback → payment record log (visible in reports reconciliation)
    console.log(`[Daraja] C2B callback: ${session.phone} paid KES ${session.amount} (${session.receiptNo ?? "no-ref"})`);
  }

  return NextResponse.json({
    ok: true,
    status: session.status,
    resultCode: session.status === "Success" ? 0 : 1,
    resultDesc:
      session.status === "Success"
        ? "The service request is processed successfully."
        : "Waiting for customer PIN.",
    mpesaReceipt: session.status === "Success" ? `SJK${Math.random().toString(36).slice(2, 7).toUpperCase()}` : null,
  });
}
