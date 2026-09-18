"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cake, CheckCheck, HandCoins, Loader2, Megaphone, MessageSquare, Phone, Radio,
  Send, ShoppingBag, Sparkles, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { KES, SmsLogDto } from "@/types";
import { EmptyState, Panel, ScreenHeader, TableSkeleton } from "@/components/df/shared";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/* -- contracts ----------------------------------------------- */

interface MessagesPayload {
  logs: SmsLogDto[];
  audiences: { all: number; gold: number; hasDebt: number; birthdayToday: number; boughtLast7: number };
  stats: {
    totalSent: number;
    totalCost: number;
    byType: { type: string; count: number; cost: number; last: string }[];
  };
}

type Audience = "all" | "gold" | "hasDebt" | "birthdayToday" | "boughtLast7";
type Channel = "SMS" | "WhatsApp";
type TemplateKey = "DebtReminder" | "Birthday" | "Promo" | "Receipt";
type LogFilter = "All" | "SMS" | "WhatsApp";

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/* -- static config ------------------------------------------- */

const AUDIENCES: { id: Audience; label: string; icon: typeof Users }[] = [
  { id: "all", label: "All Customers", icon: Users },
  { id: "gold", label: "Gold Tier", icon: Sparkles },
  { id: "hasDebt", label: "Has Debt", icon: HandCoins },
  { id: "birthdayToday", label: "Birthday Today", icon: Cake },
  { id: "boughtLast7", label: "Bought Last 7 Days", icon: ShoppingBag },
];

const TEMPLATES: { key: TemplateKey; label: string; body: string }[] = [
  {
    key: "DebtReminder",
    label: "Debt Reminder",
    body:
      "Hi {customer_name}, a friendly reminder - your account has an outstanding balance of KES {debt_balance}. " +
      "Pay via M-Pesa Paybill 123456 or visit {shop_name} Thika Road. Asante!",
  },
  {
    key: "Birthday",
    label: "Birthday Offer",
    body:
      "Happy Birthday {customer_name}! 🎉 Enjoy 10% off everything today at {shop_name} - a {tier} tier gift from us. Karibu!",
  },
  {
    key: "Promo",
    label: "Promo",
    body:
      "Hi {customer_name}! Bamburi Cement offer this week at {shop_name} - {tier} members save 10%. " +
      "You have {points_balance} points. Pop in today!",
  },
  {
    key: "Receipt",
    label: "Receipt",
    body: "Asante {customer_name}! Your receipt from {shop_name} is confirmed. Points balance: {points_balance}. Karibu tena!",
  },
];

const MERGE_TAGS = ["{customer_name}", "{points_balance}", "{debt_balance}", "{tier}", "{shop_name}"];

/** Sample customer used in the iPhone preview. */
const SAMPLE_TAGS: Record<string, string> = {
  "{customer_name}": "John",
  "{points_balance}": "420",
  "{debt_balance}": "2,000",
  "{tier}": "Gold",
  "{shop_name}": "DukaFlow",
};

const TYPE_META: Record<string, { label: string; cls: string }> = {
  Receipt: { label: "Receipt", cls: "bg-[#E3F2FD] text-[#0D47A1]" },
  DebtReminder: { label: "Debt Reminder", cls: "bg-[#FFEBEE] text-[#C62828]" },
  Birthday: { label: "Birthday", cls: "bg-[#FFF8E1] text-[#8B6D00]" },
  Promo: { label: "Promo", cls: "bg-[#E8F5E9] text-[#2E7D32]" },
};

const rel = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "-";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/* -- screen -------------------------------------------------- */

export default function MessagesScreen() {
  const [data, setData] = useState<MessagesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [audience, setAudience] = useState<Audience>("all");
  const [channel, setChannel] = useState<Channel>("SMS");
  const [template, setTemplate] = useState<TemplateKey | "none">("none");
  const [body, setBody] = useState(TEMPLATES[2].body);
  const [filter, setFilter] = useState<LogFilter>("All");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<MessagesPayload>("/api/messages");
      setData(d);
    } catch (e) {
      toast({ title: "Could not load messaging", description: err(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // async boundary: the loader touches state, so never call it synchronously here
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const audienceCount = data ? data.audiences[audience] : 0;
  const chars = body.length;
  const segments = Math.max(1, Math.ceil(chars / 160));
  const costEst = segments * audienceCount;

  const previewText = useMemo(() => {
    let t = body.trim() || "Type a message to see the customer preview…";
    for (const [tag, val] of Object.entries(SAMPLE_TAGS)) t = t.replaceAll(tag, val);
    return t;
  }, [body]);

  const appendTag = (tag: string) => {
    const el = taRef.current;
    const pos = el ? (el.selectionStart ?? el.value.length) : body.length;
    setBody((b) => b.slice(0, pos) + tag + b.slice(pos));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + tag.length, pos + tag.length);
    });
  };

  const send = async () => {
    if (!body.trim() || audienceCount === 0) return;
    setSending(true);
    try {
      const res = await api.post<{ ok: boolean; sent: number; cost: number; channel: string }>(
        "/api/messages/send",
        { audience, channel, body: body.trim(), label: template === "none" ? "Promo" : template }
      );
      toast({
        title: `Blast sent to ${res.sent} customers - cost KES ${res.cost.toLocaleString()}`,
        description: `Via ${res.channel} • Africa's Talking gateway`,
      });
      setBody("");
      setTemplate("none");
      await load();
    } catch (e) {
      toast({ title: "Blast failed", description: err(e) });
    } finally {
      setSending(false);
    }
  };

  const logs = data?.logs ?? [];
  const shownLogs = filter === "All" ? logs : logs.filter((l) => l.channel === filter);

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Client Messaging"
        subtitle="Africa's Talking SMS + WhatsApp Cloud API"
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#172B4D]">
              <span className="h-2 w-2 rounded-full bg-[#00C853] shadow-[0_0_0_3px_rgba(0,200,83,0.15)]" />
              SMS Provider: Connected
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DFE1E6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#172B4D]">
              <span className="h-2 w-2 rounded-full bg-[#00C853] shadow-[0_0_0_3px_rgba(0,200,83,0.15)]" />
              WhatsApp: Connected
            </span>
          </>
        }
      />

      {/* Campaign stats */}
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @6xl:grid-cols-4">
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E9F2FF] text-[#0052CC]">
              <Megaphone size={16} />
            </div>
            <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[10px] font-bold text-[#6B778C]">ALL TIME</span>
          </div>
          {loading ? (
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-[#F4F5F7]" />
          ) : (
            <p className="font-display mt-3 text-xl font-bold text-[#172B4D]">{data?.stats.totalSent ?? 0} sent</p>
          )}
          <p className="mt-0.5 text-[12px] text-[#6B778C]">Total spend {KES(data?.stats.totalCost ?? 0)}</p>
        </Panel>

        {(data?.stats.byType ?? []).slice(0, 3).map((t) => {
          const meta = TYPE_META[t.type] ?? { label: t.type, cls: "bg-[#F4F5F7] text-[#6B778C]" };
          return (
            <Panel key={t.type} className="p-4">
              <div className="flex items-center justify-between">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", meta.cls)}>{meta.label}</span>
                <span className="text-[11px] text-[#6B778C]">{rel(t.last)}</span>
              </div>
              <p className="font-display mt-3 text-xl font-bold text-[#172B4D]">{t.count} sent</p>
              <p className="mt-0.5 text-[12px] text-[#6B778C]">Cost {KES(t.cost)}</p>
            </Panel>
          );
        })}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* LEFT - compose */}
        <Panel className="col-span-12 @4xl:col-span-7">
          <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Compose Blast</h3>
          <p className="mt-0.5 text-[12px] text-[#6B778C]">Merge tags personalise every message per customer.</p>

          {/* audience chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {AUDIENCES.map(({ id, label, icon: Icon }) => {
              const activeAud = audience === id;
              const count = data?.audiences[id] ?? 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAudience(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    activeAud
                      ? "border-[#0052CC] bg-[#0052CC] text-white"
                      : "border-[#DFE1E6] bg-white text-[#172B4D] hover:border-[#0052CC]/40"
                  )}
                >
                  <Icon size={13} className={activeAud ? "text-white" : "text-[#0052CC]"} />
                  {label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold",
                      activeAud ? "bg-white/20 text-white" : "bg-[#F4F5F7] text-[#6B778C]"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* channel toggle + template */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-[#DFE1E6] p-1">
              <button
                type="button"
                onClick={() => setChannel("SMS")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors",
                  channel === "SMS" ? "bg-[#0052CC] text-white" : "text-[#6B778C] hover:text-[#172B4D]"
                )}
              >
                <MessageSquare size={13} /> SMS
              </button>
              <button
                type="button"
                onClick={() => setChannel("WhatsApp")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors",
                  channel === "WhatsApp" ? "bg-[#00C853] text-white" : "text-[#6B778C] hover:text-[#172B4D]"
                )}
              >
                <Phone size={13} /> WhatsApp
              </button>
            </div>

            <Select
              value={template}
              onValueChange={(v) => {
                const key = v as TemplateKey | "none";
                setTemplate(key);
                if (key !== "none") setBody(TEMPLATES.find((t) => t.key === key)?.body ?? "");
              }}
            >
              <SelectTrigger className="h-9 w-[190px] rounded-xl text-[13px]">
                <SelectValue placeholder="Template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Blank message</SelectItem>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    Template: {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 grid grid-cols-12 gap-4">
            {/* editor */}
            <div className="col-span-12 @2xl:col-span-7">
              <Textarea
                ref={taRef}
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hi {customer_name}, …"
                className="resize-none rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px] focus-visible:ring-[#0052CC]/30"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => appendTag(tag)}
                    className="rounded-full border border-dashed border-[#0052CC]/40 bg-[#E9F2FF] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#0052CC] transition-colors hover:bg-[#0052CC] hover:text-white"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-[#6B778C]">
                <span>
                  <span className={cn("font-bold", chars > 160 ? "text-[#FF5630]" : "text-[#172B4D]")}>{chars}</span>
                  /160 chars • {segments} segment{segments > 1 ? "s" : ""}
                </span>
                <span className="font-semibold text-[#172B4D]">Cost est {KES(costEst)}</span>
              </div>

              <Button
                onClick={send}
                disabled={sending || !body.trim() || audienceCount === 0}
                className="mt-4 h-10 w-full rounded-xl bg-[#0052CC] text-[13px] font-bold text-white hover:bg-[#0041A8]"
              >
                {sending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                {sending ? "Sending blast…" : `Send to ${audienceCount.toLocaleString()} customers`}
              </Button>
            </div>

            {/* iPhone preview */}
            <div className="col-span-12 @2xl:col-span-5">
              <div className="mx-auto w-[300px] max-w-full rounded-[36px] border-4 border-[#172B4D] bg-white p-3 shadow-xl">
                <div className="overflow-hidden rounded-[24px] border border-[#DFE1E6]">
                  <div className="flex items-center gap-2 bg-[#00C853] px-3 py-2 text-white">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25 text-[9px] font-extrabold">
                      DF
                    </div>
                    <div className="leading-tight">
                      <p className="text-[11px] font-bold">DUKAFLOW</p>
                      <p className="text-[9px] text-white/85">online</p>
                    </div>
                    <Radio size={11} className="ml-auto text-white/80" />
                  </div>
                  <div className="min-h-[160px] space-y-2 bg-[#ECE5DD] p-3">
                    <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-white p-2.5 text-[12px] leading-snug text-[#172B4D] shadow-sm">
                      {previewText}
                      <div className="mt-1.5 flex items-center justify-end gap-1 text-[9px] font-medium text-[#6B778C]">
                        Delivered • now
                        <CheckCheck size={12} className="text-[#4FC3F7]" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-[#DFE1E6] bg-white px-3 py-2">
                    <div className="h-6 flex-1 rounded-full bg-[#F4F5F7]" />
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#00C853]">
                      <Send size={11} className="text-white" />
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-widest text-[#6B778C]">
                  Preview • John Kamau (Gold)
                </p>
              </div>
            </div>
          </div>
        </Panel>

        {/* RIGHT - recent messages */}
        <Panel className="col-span-12 @4xl:col-span-5" padding={false}>
          <div className="flex items-center justify-between border-b border-[#DFE1E6] p-4">
            <h3 className="font-display text-[15px] font-bold text-[#172B4D]">Recent Messages</h3>
            <div className="flex rounded-full bg-[#F4F5F7] p-0.5">
              {(["All", "SMS", "WhatsApp"] as LogFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-bold transition-colors",
                    filter === f ? "bg-white text-[#0052CC] shadow-sm" : "text-[#6B778C]"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto p-3">
            {loading ? (
              <TableSkeleton rows={6} cols={2} />
            ) : shownLogs.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={20} />}
                title="No messages yet"
                sub="Blasts you send will appear here with delivery status and cost."
              />
            ) : (
              <div className="space-y-2">
                {shownLogs.map((l) => {
                  const isWa = l.channel === "WhatsApp";
                  const meta = TYPE_META[l.type] ?? { label: l.type, cls: "bg-[#F4F5F7] text-[#6B778C]" };
                  return (
                    <div
                      key={l.id}
                      className="rounded-xl border border-[#DFE1E6] bg-white p-3 transition-colors hover:bg-[#FAFBFC]"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                            isWa ? "bg-[#E8F5E9] text-[#00C853]" : "bg-[#E3F2FD] text-[#0052CC]"
                          )}
                        >
                          {isWa ? <Phone size={13} /> : <MessageSquare size={13} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-[#172B4D]">{l.phone}</span>
                            <span className="shrink-0 text-[10px] text-[#6B778C]">{rel(l.createdAt)} • {fmtTime(l.createdAt)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[#172B4D]">{l.message}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", meta.cls)}>{meta.label}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#1B7A2E]">
                              <CheckCheck size={10} /> {l.status}
                            </span>
                            <span className="ml-auto text-[10px] font-semibold text-[#6B778C]">{KES(l.cost)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
