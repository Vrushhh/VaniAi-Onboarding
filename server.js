// server.js
// KZUNO demo-call app (Vobiz + Sarvam Voice Agent):
//
//   POST /api/demo-call            { phone, consent } → Vobiz rings the user
//   GET  /api/demo-call/:id        poll status for the UI stepper
//   GET  /api/transcripts          JSON list of all call records & full transcripts
//   GET  /transcripts              HTML Live Transcript Dashboard for quality analysis
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
  getAllCalls,
} from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.get("/debug-logs", (req, res) => {
  res.type("text/plain");
  res.send((global.debugLogs || []).join("\n"));
});

/* ── Live Call Transcripts API & UI ─────────────────────────────────── */
app.get("/api/transcripts", (_req, res) => {
  res.json(getAllCalls());
});

app.get("/api/demo-call/:id/transcript", (req, res) => {
  const rec = getCall(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown call" });
  res.json({ id: rec.id, phone: rec.to, status: rec.status, transcript: rec.transcript || [] });
});

app.get("/transcripts", (_req, res) => {
  const calls = getAllCalls();
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KZUNO Call Transcripts & Analytics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { font-family: 'Montserrat', sans-serif; color: #38bdf8; font-size: 24px; margin-bottom: 4px; font-weight: 700; }
    p.sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 12px; margin-bottom: 16px; }
    .phone { font-weight: 600; font-size: 16px; color: #f1f5f9; }
    .status { background: #0284c7; color: #fff; padding: 4px 10px; border-radius: 20px; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .conversation { display: flex; flex-direction: column; gap: 12px; }
    .bubble { display: flex; flex-direction: column; }
    .user { align-self: flex-start; background: #334155; color: #f8fafc; padding: 10px 14px; border-radius: 12px 12px 12px 2px; max-width: 80%; }
    .agent { align-self: flex-end; background: #0369a1; color: #fff; padding: 10px 14px; border-radius: 12px 12px 2px 12px; max-width: 80%; }
    .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; margin-bottom: 4px; font-weight: 600; }
    .lang { font-size: 10px; background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: normal; }
    .empty { color: #64748b; font-style: italic; font-size: 13px; }
    .time { font-size: 11px; color: #64748b; margin-left: 8px; font-weight: normal; }
  </style>
</head>
<body>
  <h1>🎙️ KZUNO Call Transcripts & Analysis</h1>
  <p class="sub">Turn-by-turn conversation logs, language codes, and agent trajectories.</p>
`;

  if (calls.length === 0) {
    html += `<div class="card empty">No call recordings logged yet. Place a demo call to see live transcripts here.</div>`;
  } else {
    for (const c of calls) {
      const dateStr = new Date(c.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      html += `<div class="card">
        <div class="header">
          <span class="phone">📱 ${c.to || "Unknown"} <span class="time">(${dateStr})</span></span>
          <span class="status">${c.status || "completed"}</span>
        </div>
        <div class="conversation">`;

      const turns = c.transcript || [];
      if (turns.length === 0) {
        html += `<div class="empty">No transcript turns recorded for this call.</div>`;
      } else {
        for (const t of turns) {
          const isUser = t.role === "user";
          const roleClass = isUser ? "user" : "agent";
          const roleName = isUser ? "👤 Caller" : "🤖 Vaani (Agent)";
          const langBadge = t.lang ? `<span class="lang">${t.lang}</span>` : "";
          const tTime = t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : "";
          html += `
          <div class="bubble">
            <div class="${roleClass}">
              <div class="role">${roleName} ${langBadge} <span style="float:right; margin-left:12px; opacity:0.6">${tTime}</span></div>
              <div>${t.text}</div>
            </div>
          </div>`;
        }
      }
      html += `</div></div>`;
    }
  }

  html += `</body></html>`;
  res.send(html);
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
