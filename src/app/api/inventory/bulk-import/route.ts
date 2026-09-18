import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/**
 * DukaFlow - bulk stock import (opening stock, delivery notes, spreadsheet paste).
 *
 * POST /api/inventory/bulk-import
 *   body: { storeId, mode: "set" | "add", dryRun: boolean,
 *           rows: [{ code, qty }] }   // code = barcode OR sku
 *
 * Two-phase by design: the UI always runs dryRun first and shows a diff
 * preview (current → new, green/red chips, error rows), then applies. The
 * server re-validates everything on apply, so a stale preview can never
 * write stale numbers.
 *
 * Apply runs in ONE transaction: every resolved StockLevel updates, inbound
 * lines get a fresh receivedAt (Stock Aging stays truthful), a single digest
 * lands in #stock-alerts (never per-line spam), and any item left at/below
 * its reorder point emits stock:low.
 */

interface ImportRow {
  code: string;
  qty: number;
}

interface ResolvedRow {
  code: string;
  qty: number;
  ok: boolean;
  error?: string;
  productId?: number;
  productName?: string;
  emoji?: string;
  unit?: string;
  currentQty?: number;
  newQty?: number;
  delta?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      storeId: number;
      mode?: "set" | "add";
      dryRun?: boolean;
      rows: ImportRow[];
    };

    const storeId = Number(body.storeId);
    const mode = body.mode === "add" ? "add" : "set";
    const dryRun = body.dryRun !== false; // default to the safe phase
    const rows = (body.rows ?? []).filter((r) => r.code && r.code.trim() !== "");

    if (!storeId || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "storeId and at least one row are required" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ ok: false, error: "Max 500 rows per import" }, { status: 400 });
    }

    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store) return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });

    // Resolve every code (barcode first, then SKU) against the catalog.
    const products = await db.product.findMany();
    const byCode = new Map<string, typeof products[number]>();
    for (const p of products) {
      if (p.barcode) byCode.set(p.barcode.toLowerCase(), p);
      if (p.sku) byCode.set(p.sku.toLowerCase(), p);
    }

    const levels = await db.stockLevel.findMany({ where: { storeId } });
    const levelByProduct = new Map(levels.map((l) => [l.productId, l]));

    // Duplicate codes within the file are rejected (ambiguous intent).
    const seen = new Map<string, number>(); // normalized code → first row index
    const resolved: ResolvedRow[] = [];

    for (const row of rows) {
      const code = row.code.trim().toLowerCase();
      const qty = Number(row.qty);
      const idx = seen.get(code);
      if (idx !== undefined) {
        resolved.push({ code: row.code, qty, ok: false, error: `Duplicate of row ${idx + 1}` });
        continue;
      }
      seen.set(code, resolved.length);

      if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
        resolved.push({ code: row.code, qty, ok: false, error: "Quantity must be a whole number ≥ 0" });
        continue;
      }

      const product = byCode.get(code);
      if (!product) {
        resolved.push({ code: row.code, qty, ok: false, error: "Unknown barcode / SKU" });
        continue;
      }

      const level = levelByProduct.get(product.id);
      const currentQty = level?.qty ?? 0;
      const newQty = mode === "set" ? qty : currentQty + qty;
      const delta = newQty - currentQty;

      if (newQty < 0) {
        resolved.push({
          code: row.code, qty, ok: false, productId: product.id, productName: product.name,
          emoji: product.emoji, unit: product.unit, currentQty,
          error: `Would go negative (current ${currentQty}, add ${qty})`,
        });
        continue;
      }

      resolved.push({
        code: row.code, qty, ok: true, productId: product.id, productName: product.name,
        emoji: product.emoji, unit: product.unit, currentQty, newQty, delta,
      });
    }

    const valid = resolved.filter((r) => r.ok && r.productId != null);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        storeName: store.name,
        mode,
        total: resolved.length,
        valid: valid.length,
        errors: resolved.length - valid.length,
        rows: resolved,
      });
    }

    // ── Apply phase (server re-validates against live stock) ────────────────
    if (valid.length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing valid to apply" }, { status: 400 });
    }

    const applied: { name: string; emoji: string; delta: number; newQty: number }[] = [];
    const lowStock: { name: string; emoji: string; qty: number; reorderPoint: number }[] = [];

    await db.$transaction(async (tx) => {
      for (const row of valid) {
        const productId = row.productId!;
        const level = await tx.stockLevel.findUnique({
          where: { productId_storeId: { productId, storeId } },
        });
        const currentQty = level?.qty ?? 0;
        const newQty = mode === "set" ? row.qty : currentQty + row.qty;
        if (newQty < 0) continue; // guard against races between preview and apply

        const reorderPoint = level?.reorderPoint ?? 0;
        const saved = await tx.stockLevel.upsert({
          where: { productId_storeId: { productId, storeId } },
          create: { productId, storeId, qty: newQty, receivedAt: new Date() },
          update: {
            qty: newQty,
            // Inbound stock resets the batch age for the Stock Aging report.
            ...(newQty > currentQty ? { receivedAt: new Date() } : {}),
          },
        });
        applied.push({ name: row.productName!, emoji: row.emoji!, delta: saved.qty - currentQty, newQty: saved.qty });
        if (saved.qty <= reorderPoint && row.productName) {
          lowStock.push({ name: row.productName, emoji: row.emoji!, qty: saved.qty, reorderPoint });
        }
      }
    });

    // One digest line for the whole import (no per-row chat spam).
    const ups = applied.filter((a) => a.delta > 0).length;
    const downs = applied.filter((a) => a.delta < 0).length;
    const channel = await db.chatChannel.findFirst({ where: { name: "stock-alerts" } });
    if (channel && applied.length > 0) {
      const note = `📥 Bulk stock import at ${store.name}: ${applied.length} line${applied.length === 1 ? "" : "s"} (${mode === "set" ? "set" : "add"} mode) - ${ups} up, ${downs} down, ${applied.length - ups - downs} unchanged. Applied by spreadsheet import.`;
      await db.chatMessage.create({
        data: { channelId: channel.id, author: "System Bot", initials: "SB", content: note },
      });
      await db.chatChannel.update({ where: { id: channel.id }, data: { unread: { increment: 1 } } });
      emitLive("chat:new", {
        channelId: channel.id, channelName: channel.name, id: 0,
        author: "System Bot", initials: "SB", content: note,
        createdAt: new Date().toISOString(),
      });
    }
    for (const low of lowStock) {
      emitLive("stock:low", {
        productName: low.name, emoji: low.emoji, storeName: store.name,
        qty: low.qty, reorderPoint: low.reorderPoint,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      storeName: store.name,
      applied: applied.length,
      ups,
      downs,
      skippedErrors: resolved.length - valid.length,
      rows: applied,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Bulk import failed" },
      { status: 500 }
    );
  }
}
