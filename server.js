// server.js
// KZUNO demo-call app (Exotel + xAI Grok Voice Agent):
//
//   POST /api/demo-call            { phone, consent } → Exotel rings the user
//   GET  /api/demo-call/:id        poll status for the UI stepper
//   WS   /exotel-media             Exotel AgentStream ↔ xAI bridge (lib/bridge.js)
//   POST /webhooks/exotel-status   Exotel call lifecycle (answered/terminal)

import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDemoCall, assertExotelConfigured } from "./lib/exotel.js";
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

app.use(express.static(path.join(__dirname, "public")));

/* ── Trigger a demo call ─────────────────────────────────────────────── */
app.post("/api/demo-call", express.json(), async (req, res) => {
  if (!process.env.XAI_API_KEY) {
    return res.status(503).json({ error: "Server missing XAI_API_KEY." });
  }

  const useVobiz = !!(process.env.VOBIZ_AUTH_ID && process.env.VOBIZ_AUTH_TOKEN);

  try {
    if (useVobiz) {
      assertVobizConfigured();
    } else {
      assertExotelConfigured();
    }
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
    let sid;
    if (useVobiz) {
      sid = await startVobizCall(phone, record.id);
      updateCallStatus(record.id, "dialing", { vobizCallId: sid });
    } else {
      sid = await startDemoCall(phone, record.id);
      updateCallStatus(record.id, "dialing", { exotelSid: sid });
    }
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

/* ── Exotel status callback (answered / terminal) ────────────────────── */
app.post(
  "/webhooks/exotel-status",
  express.json({ type: "*/*" }),
  express.urlencoded({ extended: false }),
  (req, res) => {
    const demoId = req.query.demo_id;
    const body = req.body || {};
    const status = (body.Status || body.CallStatus || body.status || "").toLowerCase();
    console.log(`[exotel] status callback: demo=${demoId} status=${status}`);

    if (demoId && getCall(demoId)) {
      if (["completed"].includes(status)) updateCallStatus(demoId, "completed");
      else if (["failed", "busy", "no-answer", "canceled"].includes(status)) updateCallStatus(demoId, "failed");
      else if (["in-progress", "answered"].includes(status)) {
        const rec = getCall(demoId);
        if (rec.status === "dialing") updateCallStatus(demoId, "ringing");
      }
    }
    res.status(200).json({ ok: true });
  }
);

/* ── Vobiz status callbacks (answer / hangup) ────────────────────────── */
app.post(
  "/webhooks/vobiz-answer",
  (req, res) => {
    const demoId = req.query.demo_id;
    console.log(`[vobiz] answer callback: demo=${demoId}`);
    if (demoId && getCall(demoId)) {
      updateCallStatus(demoId, "connected");
    }

    const sipUri = process.env.XAI_SIP_URI || `sip:${process.env.VOBIZ_NUMBER || "+918071578639"}@sip.voice.x.ai;transport=tls`;

    res.set("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>
        <User>${sipUri}</User>
    </Dial>
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
  console.log(`Exotel stream endpoint: ${(process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT).replace(/^http/, "ws")}/exotel-media`);
});
