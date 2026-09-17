"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check, FileText, Hash, Loader2, Paperclip, Search, Send, Slash, Users, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { ChatChannelDto, ChatMessageDto } from "@/types";
import { TableSkeleton } from "@/components/df/shared";
import { useApp } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* ── contracts ─────────────────────────────────────────────── */

interface ChatPayload {
  channels: ChatChannelDto[];
  active: ChatChannelDto | null;
  messages: ChatMessageDto[];
}

interface DocLink {
  title: string;
  sub: string;
  kind: string;
}

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/* ── static config ─────────────────────────────────────────── */

const AVATAR_COLORS = ["#0052CC", "#00C853", "#FF5630", "#FFAB00", "#78909C"];

const ERP_DOCS: DocLink[] = [
  { title: "Sales Invoice INV-2847", sub: "KES 12,944 • John Kamau • Verified", kind: "invoice" },
  { title: "Stock Transfer STK-0012", sub: "20× Bamburi Cement • Kiambu → Thika", kind: "stock" },
  { title: "Debt Plan — John Kamau", sub: "KES 2,000 • 4 weekly installments", kind: "debt" },
];

const THREAD_SEED: { author: string; initials: string; text: string; mine?: boolean }[] = [
  { author: "Mary Wanjiku", initials: "MW", text: "We need to update price for Bamburi? Buying 1100, selling 1250 margin low." },
  { author: "James Otieno", initials: "JO", text: "Margin 13% — keep for Gold discount 10% still profit.", mine: true },
];

const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const parseDoc = (raw: string | null): DocLink | null => {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<DocLink>;
    return d && typeof d.title === "string" ? { title: d.title, sub: d.sub ?? "", kind: d.kind ?? "doc" } : null;
  } catch {
    return null;
  }
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Renders @mentions in brand blue. */
function Content({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} className="font-semibold text-[#0052CC]">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/* ── screen ────────────────────────────────────────────────── */

export default function ChatScreen() {
  const user = useApp((s) => s.user);

  const [channels, setChannels] = useState<ChatChannelDto[]>([]);
  const [active, setActive] = useState<ChatChannelDto | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [pendingDoc, setPendingDoc] = useState<DocLink | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [threadReplies, setThreadReplies] = useState<string[]>([]);
  const [threadDraft, setThreadDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (id: number | null) => {
    try {
      const d = await api.get<ChatPayload>(`/api/chat${id ? `?channelId=${id}` : ""}`);
      setChannels(d.channels);
      setActive(d.active);
      setMessages(d.messages);
      if (d.active && d.active.id !== id) setSelectedId(d.active.id);
    } catch (e) {
      toast({ title: "Could not load chat", description: err(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedId);
  }, [load]);

  /* auto-scroll to newest message */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const openChannel = async (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setLoading(true);
    await load(id);
    const target = channels.find((c) => c.id === id);
    if (target && target.unread > 0) {
      setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
      api.patch("/api/chat", { channelId: id }).catch(() => {});
    }
  };

  const pickSlashDoc = (raw: string): { doc: DocLink | null; content: string } | null => {
    const cmd = raw.toLowerCase();
    if (/invoice/.test(cmd)) return { doc: ERP_DOCS[0], content: "Sharing the latest sales invoice 📄" };
    if (/stock|transfer/.test(cmd)) return { doc: ERP_DOCS[1], content: "Stock transfer doc attached 📦" };
    if (/debt|plan/.test(cmd)) return { doc: ERP_DOCS[2], content: "Debt plan attached 💰" };
    return null;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !active || sending) return;
    let content = text;
    let doc = pendingDoc;
    if (text.startsWith("/")) {
      const hit = pickSlashDoc(text);
      if (hit) {
        doc = hit.doc;
        content = hit.content;
      }
    }
    setSending(true);
    try {
      const res = await api.post<{ ok: boolean; message: ChatMessageDto }>("/api/chat", {
        channelId: active.id,
        content,
        author: user?.name ?? "Owner",
        docLink: doc ?? undefined,
      });
      setMessages((ms) => [...ms, res.message]);
      setDraft("");
      setPendingDoc(null);
    } catch (e) {
      toast({ title: "Could not post message", description: err(e) });
    } finally {
      setSending(false);
    }
  };

  const postThreadReply = () => {
    const t = threadDraft.trim();
    if (!t) return;
    setThreadReplies((r) => [...r, t]);
    setThreadDraft("");
    toast({ title: "Reply posted to thread", description: `#${active?.name ?? "channel"} • Cement transfer` });
  };

  const shownChannels = channels.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  return (
    <div className="grid grid-cols-12 gap-0 overflow-hidden rounded-2xl border border-[#DFE1E6] bg-white shadow-sm">
      {/* Pane 1 — channel rail */}
      <div className="col-span-12 flex max-h-[660px] flex-col border-[#DFE1E6] md:col-span-3 md:border-r">
        <div className="border-b border-[#DFE1E6] p-3">
          <div className="flex items-center gap-2">
            <span className="font-display text-[14px] font-bold text-[#172B4D]">Raven</span>
            <span className="rounded-full bg-[#E9F2FF] px-2 py-0.5 text-[10px] font-bold text-[#0052CC]">
              In-house Chat
            </span>
          </div>
          <div className="relative mt-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B778C]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels…"
              className="h-8 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] pl-7 text-[12px]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <TableSkeleton rows={5} cols={1} />
          ) : (
            shownChannels.map((c) => {
              const isActive = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void openChannel(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                    isActive ? "bg-[#E9F2FF] text-[#0052CC]" : "text-[#172B4D] hover:bg-[#F4F5F7]"
                  )}
                >
                  <Hash size={13} className={isActive ? "text-[#0052CC]" : "text-[#6B778C]"} />
                  <span className="truncate">{c.name}</span>
                  {c.unread > 0 && (
                    <span className="ml-auto rounded-full bg-[#FF5630] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.unread}
                    </span>
                  )}
                  {c.unread === 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[#6B778C]">
                      <Users size={10} /> {c.members}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-[#DFE1E6] p-3">
          <div className="rounded-xl border border-dashed border-[#0052CC]/40 bg-[#E9F2FF] p-3">
            <div className="flex items-center gap-2 text-[12px] font-bold text-[#0052CC]">
              <Slash size={12} /> ERP sharing
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[#6B778C]">
              Type <span className="font-mono font-semibold text-[#0052CC]">/invoice</span>,{" "}
              <span className="font-mono font-semibold text-[#0052CC]">/stock</span> or{" "}
              <span className="font-mono font-semibold text-[#0052CC]">/debt</span> to share an ERP doc card.
            </p>
          </div>
        </div>
      </div>

      {/* Pane 2 — conversation */}
      <div className="col-span-12 flex max-h-[660px] flex-col md:col-span-6">
        <div className="flex items-center justify-between border-b border-[#DFE1E6] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-[14px] font-bold text-[#172B4D]">
              # {active?.name ?? "general"}
            </p>
            <p className="text-[11px] text-[#6B778C]">
              {active?.members ?? 0} members{active?.description ? ` • ${active.description}` : ""}
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[10px] font-bold text-[#6B778C] sm:block">
            {messages.length} messages
          </span>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[#FAFBFC] p-4">
          <div className="flex justify-center">
            <span className="rounded-full border border-[#DFE1E6] bg-white px-3 py-1 text-[11px] font-semibold text-[#6B778C]">
              Today • {today}
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={4} cols={2} />
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[#6B778C]">
              No messages yet — say karibu to kick things off.
            </div>
          ) : (
            messages.map((m) => {
              const doc = parseDoc(m.docLink);
              return (
                <div key={m.id} className="flex gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: colorFor(m.initials || m.author) }}
                  >
                    {m.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[#172B4D]">{m.author}</span>
                      <span className="text-[11px] text-[#6B778C]">{fmtTime(m.createdAt)}</span>
                    </p>
                    <div className="mt-1 max-w-[520px] rounded-xl rounded-tl-sm border border-[#DFE1E6] bg-white p-3 text-[14px] leading-snug text-[#172B4D]">
                      <Content text={m.content} />
                    </div>
                    {doc && (
                      <button
                        type="button"
                        onClick={() => toast({ title: `Opening ${doc.title} in ERP`, description: doc.sub })}
                        className="mt-2 flex w-fit max-w-[360px] items-center gap-3 rounded-xl border-2 border-[#0052CC]/30 bg-[#E9F2FF] p-3 text-left transition-colors hover:border-[#0052CC]/60"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0052CC] text-white">
                          <FileText size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-bold text-[#0052CC]">{doc.title}</span>
                          <span className="block truncate text-[11px] text-[#6B778C]">{doc.sub}</span>
                        </span>
                        <span className="ml-2 shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0052CC] shadow-sm">
                          View
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* composer */}
        <div className="border-t border-[#DFE1E6] p-3">
          {pendingDoc && (
            <div className="mb-2 flex w-fit items-center gap-2 rounded-xl border border-[#0052CC]/30 bg-[#E9F2FF] px-3 py-1.5">
              <FileText size={13} className="text-[#0052CC]" />
              <span className="text-[11px] font-bold text-[#0052CC]">{pendingDoc.title}</span>
              <button type="button" onClick={() => setPendingDoc(null)} className="text-[#6B778C] hover:text-[#FF5630]">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <Popover open={attachOpen} onOpenChange={setAttachOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-xl border-[#DFE1E6]">
                  <Paperclip size={15} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 rounded-xl p-1.5">
                <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6B778C]">
                  Share ERP doc
                </p>
                {ERP_DOCS.map((d) => (
                  <button
                    key={d.kind}
                    type="button"
                    onClick={() => {
                      setPendingDoc(d);
                      setAttachOpen(false);
                      toast({ title: `${d.title} attached`, description: "It will be shared with your message." });
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-[#F4F5F7]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E9F2FF] text-[#0052CC]">
                      <FileText size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#172B4D]">{d.title}</span>
                      <span className="block truncate text-[11px] text-[#6B778C]">{d.sub}</span>
                    </span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message # ${active?.name ?? "general"}…  Use @ to mention, / to share ERP doc`}
              className="h-10 flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[13px]"
            />
            <Button
              onClick={send}
              disabled={sending || !draft.trim() || !active}
              className="h-10 shrink-0 rounded-xl bg-[#0052CC] px-4 text-[13px] font-bold text-white hover:bg-[#0041A8]"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-[#6B778C]">
            @mentions highlight in blue • <span className="font-mono">/invoice</span>,{" "}
            <span className="font-mono">/stock</span>, <span className="font-mono">/debt</span> attach ERP docs instantly
          </p>
        </div>
      </div>

      {/* Pane 3 — thread rail */}
      <div className="col-span-12 hidden max-h-[660px] flex-col border-[#DFE1E6] lg:col-span-3 lg:flex lg:border-l">
        <div className="border-b border-[#DFE1E6] px-4 py-3">
          <p className="font-display text-[14px] font-bold text-[#172B4D]">Thread</p>
          <p className="mt-0.5 text-[11px] text-[#6B778C]">Cement transfer • {2 + threadReplies.length} replies</p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {THREAD_SEED.map((t, i) => (
            <div key={i} className="flex gap-2">
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: colorFor(t.initials) }}
              >
                {t.initials}
              </div>
              <div
                className={cn(
                  "rounded-xl p-3 text-[12px] leading-snug text-[#172B4D]",
                  t.mine ? "border border-[#DFE1E6] bg-white" : "bg-[#F4F5F7]"
                )}
              >
                <p className="mb-0.5 text-[10px] font-bold text-[#6B778C]">{t.author}</p>
                {t.text}
              </div>
            </div>
          ))}
          {threadReplies.map((t, i) => (
            <div key={`r${i}`} className="flex gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0052CC] text-[9px] font-bold text-white">
                {(user?.name ?? "OW")
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="rounded-xl border border-[#0052CC]/25 bg-[#E9F2FF] p-3 text-[12px] leading-snug text-[#172B4D]">
                <p className="mb-0.5 text-[10px] font-bold text-[#0052CC]">{user?.name ?? "Owner"}</p>
                {t}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#DFE1E6] p-3">
          <div className="flex gap-2">
            <Input
              value={threadDraft}
              onChange={(e) => setThreadDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  postThreadReply();
                }
              }}
              placeholder="Reply in thread…"
              className="h-9 flex-1 rounded-xl border-[#DFE1E6] bg-[#FAFBFC] text-[12px]"
            />
            <Button
              onClick={postThreadReply}
              disabled={!threadDraft.trim()}
              className="h-9 rounded-xl bg-[#0052CC] px-3 text-[12px] font-bold text-white hover:bg-[#0041A8]"
            >
              <Send size={13} />
            </Button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#6B778C]">
            <Check size={10} className="text-[#00C853]" /> Thread replies notify # {active?.name ?? "general"}
          </p>
        </div>
      </div>
    </div>
  );
}
