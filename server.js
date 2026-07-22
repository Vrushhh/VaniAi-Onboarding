// server.js
// KZUNO demo-call app (Vobiz + Sarvam Voice Agent):
//
//   POST /api/demo-call            { phone, consent } → Vobiz rings the user
//   GET  /api/demo-call/:id        poll status for the UI stepper
//   WS   /vobiz-media              Vobiz bidirectional stream ↔ Sarvam bridge (lib/bridge.js)
//   POST /webhooks/vobiz-answer    Vobiz answer callback
//   POST /webhooks/vobiz-hangup    Vobiz hangup callback

import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startVobizCall, assertVobizConfigured } from "./lib/vobiz.js";
import { attachBridge } from "./lib/bridge.js";
import {
  normalizeIndianNumber,
  rateLimitOk,
  createCall,
  updateCallStatus,
  getCall,
} from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.get("/debug-logs", (req, res) => {
  res.type("text/plain");
  res.send((global.debugLogs || []).join("\n"));
});

app.use(express.static(path.join(__dirname, "public")));

/* ── Trigger a demo call ─────────────────────────────────────────────── */
app.post("/api/demo-call", express.json(), async (req, res) => {
  try {
    assertVobizConfigured();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const phone = normalizeIndianNumber(req.body?.phone);
  if (!phone) {
    return res.status(400).json({ error: "Please enter a valid Indian mobile number (+91)." });
  }
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: "Please confirm this is your number and you consent to receive the call." });
  }
  if (!rateLimitOk(phone)) {
    return res.status(429).json({ error: "Demo limit reached for this number. Try again in an hour." });
  }

  const record = createCall(phone);
  try {
    const sid = await startVobizCall(phone, record.id);
    updateCallStatus(record.id, "dialing", { vobizCallId: sid });
    return res.json({ id: record.id, status: "dialing" });
  } catch (err) {
    console.error("[api] demo-call failed:", err.message);
    updateCallStatus(record.id, "failed");
    return res.status(502).json({ error: "Couldn't place the call. Please try again shortly." });
  }
});

/* ── Poll call status ────────────────────────────────────────────────── */
app.get("/api/demo-call/:id", (req, res) => {
  const rec = getCall(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown call" });
  res.json({ id: rec.id, status: rec.status });
});

/* ── Vobiz status callbacks (answer / hangup) ────────────────────────── */
app.post(
  "/webhooks/vobiz-answer",
  (req, res) => {
    const demoId = req.query.demo_id;
    console.log(`[vobiz] answer callback: demo=${demoId}`);
    if (demoId && getCall(demoId)) {
      updateCallStatus(demoId, "connected");
    }

    const wsUrl = `${process.env.PUBLIC_BASE_URL.replace(/^http/, "ws")}/vobiz-media?demo_id=${encodeURIComponent(demoId)}`;

    res.set("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${wsUrl}</Stream>
    <Wait length="600" />
</Response>`);
  }
);

app.post(
  "/webhooks/vobiz-hangup",
  (req, res) => {
    const demoId = req.query.demo_id;
    console.log(`[vobiz] hangup callback: demo=${demoId}`);
    if (demoId && getCall(demoId)) {
      updateCallStatus(demoId, "completed");
    }
    res.status(200).json({ ok: true });
  }
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

/* ── HTTP + WebSocket on one port ────────────────────────────────────── */
const server = http.createServer(app);
attachBridge(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`KZUNO demo app on http://localhost:${PORT}`);
  console.log(`Vobiz stream endpoint: ${(process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT).replace(/^http/, "ws")}/vobiz-media`);
});
