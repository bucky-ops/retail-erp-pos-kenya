/**
 * DukaFlow Live Feed - real-time event bus
 *   • socket.io server on port 3003 (browsers connect via Caddy: io("/?XTransformPort=3003"))
 *   • plain HTTP bridge on port 3004 (Next.js backend pushes events, localhost only)
 *
 * Events broadcast:
 *   sale:new   - a POS receipt / invoice was committed (incl. offline replays)
 *   stock:low  - stock crossed its reorder point (sale, adjustment, transfer)
 *   chat:new   - a Raven message was posted (system bot or user)
 *   till:z     - a till shift was closed (Z report posted)
 *
 * Bridge endpoints (server-to-server, port 3004):
 *   POST /emit   { event, payload }        → broadcast to all clients
 *   GET  /health { ok, clients }           → monitoring
 *   GET  /recent                           last 25 events (debug)
 */

import { createServer } from "http";
import { Server } from "socket.io";

const WS_PORT = 3003; // socket.io - browser-facing via Caddy gateway
const BRIDGE_PORT = 3004; // plain HTTP - Next.js backend only (not exposed)

// Ring buffer of the last 25 events - newly connected dashboards replay it so
// the "Live Sales Feed" is never empty after a refresh.
const recent: { event: string; payload: unknown; at: string }[] = [];
let broadcastCount = 0;

function broadcast(event: string, payload: unknown) {
  recent.unshift({ event, payload, at: new Date().toISOString() });
  if (recent.length > 25) recent.length = 25;
  io.emit(event, payload);
  broadcastCount++;
  console.log(`📡 ${event} → ${io.engine.clientsCount} client(s)`);
}

// -- socket.io (browser side) ---------------------------------------
const io = new Server(WS_PORT, {
  // DO NOT change the path - Caddy forwards /?XTransformPort=3003 traffic here
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`dashboard connected: ${socket.id} (${io.engine.clientsCount} online)`);
  // Replay recent events so a freshly (re)loaded page is immediately current.
  socket.emit("recent", recent);
  socket.on("disconnect", () => {
    console.log(`dashboard left: ${socket.id} (${io.engine.clientsCount} online)`);
  });
});

// -- HTTP bridge (Next.js backend side) -----------------------------
const bridge = createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount, broadcast: broadcastCount }));
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/recent")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(recent));
    return;
  }
  if (req.method === "POST" && req.url?.startsWith("/emit")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { event, payload } = JSON.parse(body || "{}");
        if (!event) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "event is required" }));
          return;
        }
        broadcast(event, payload);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

bridge.listen(BRIDGE_PORT, () => {
  console.log(`DukaFlow live feed bridge on :${BRIDGE_PORT} (emit/health/recent)`);
});
console.log(`DukaFlow live feed socket.io on :${WS_PORT}`);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
