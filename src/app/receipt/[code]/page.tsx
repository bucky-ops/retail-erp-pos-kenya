import ReceiptView from "./receipt-view";

export const dynamic = "force-dynamic";

/** Public digital receipt twin - the QR target printed on every DukaFlow document. */
export default async function ReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ReceiptView code={code} />;
}
