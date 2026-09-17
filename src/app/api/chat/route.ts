import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitLive } from "@/lib/live-emit";

export const dynamic = "force-dynamic";

/** GET /api/chat?channelId= — channels list + messages of one channel. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");

  const channels = await db.chatChannel.findMany({ orderBy: { id: "asc" } });

  const activeId = channelId
    ? Number(channelId)
    : channels.find((c) => c.name === "thika-road")?.id ?? channels[0]?.id;

  const messages = activeId
    ? await db.chatMessage.findMany({
        where: { channelId: activeId },
        orderBy: { createdAt: "asc" },
        take: 100,
      })
    : [];

  const active = channels.find((c) => c.id === activeId);

  return NextResponse.json({
    channels,
    active: active ?? null,
    messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
}

/** POST /api/chat — post a message (optionally sharing an ERP doc card). */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.channelId || !body.content?.trim()) {
    return NextResponse.json({ ok: false, error: "Channel and message required" }, { status: 400 });
  }

  const staff = body.author ? await db.staff.findFirst({ where: { name: body.author } }) : null;
  const name = body.author ?? "Owner";
  const initials = name
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const msg = await db.chatMessage.create({
    data: {
      channelId: Number(body.channelId),
      author: name,
      initials: body.initials ?? (staff ? staff.name.split(" ").map((w) => w[0]).slice(0, 2).join("") : initials),
      content: body.content.trim(),
      docLink: body.docLink ? JSON.stringify(body.docLink) : null,
    },
  });
  // Realtime: push the message to every open Raven client.
  const chan = await db.chatChannel.findUnique({ where: { id: Number(body.channelId) } });
  emitLive("chat:new", {
    channelId: msg.channelId, channelName: chan?.name ?? "", id: msg.id,
    author: msg.author, initials: msg.initials, content: msg.content,
    docLink: msg.docLink,
    createdAt: msg.createdAt.toISOString(),
  });
  return NextResponse.json({ ok: true, message: { ...msg, createdAt: msg.createdAt.toISOString() } });
}

/** PATCH /api/chat — mark channel read. */
export async function PATCH(req: NextRequest) {
  const { channelId } = await req.json();
  await db.chatChannel.update({ where: { id: Number(channelId) }, data: { unread: 0 } });
  return NextResponse.json({ ok: true });
}
