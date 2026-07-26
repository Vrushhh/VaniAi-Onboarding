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

/* ── Admin Gmail Authentication & Google OAuth Flow ────────────────── */
const ADMIN_EMAIL = "vrushabhcr7@gmail.com";

// Cookie helper
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      list[parts.shift().trim()] = decodeURI(parts.join("="));
    });
  }
  return list;
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req);
  return cookies.kz_admin_session === "authenticated_admin_" + ADMIN_EMAIL;
}

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";
  const redirectUri = `${baseUrl}/auth/google/callback`;

  if (clientId) {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent("email profile")}` +
      `&prompt=select_account`;
    return res.redirect(googleAuthUrl);
  }

  // If OAuth keys aren't configured yet, present Admin Direct Login UI
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Login - KZUNO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 36px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    h1 { font-family: 'Montserrat', sans-serif; font-size: 22px; color: #38bdf8; margin-bottom: 8px; }
    p { font-size: 14px; color: #94a3b8; margin-bottom: 24px; }
    input { width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 15px; margin-bottom: 16px; box-sizing: border-box; }
    button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: #185A3A; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
    button:hover { background: #0D3B26; }
    .note { font-size: 12px; color: #64748b; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🔑 Admin Login</h1>
    <p>Sign in with your authorized admin Gmail account to access call transcripts & analytics.</p>
    <form action="/auth/admin-login" method="POST">
      <input type="email" name="email" value="${ADMIN_EMAIL}" required placeholder="Enter Gmail address">
      <button type="submit">Sign in to Transcripts Dashboard</button>
    </form>
    <div class="note">Authorized Admin: ${ADMIN_EMAIL}</div>
  </div>
</body>
</html>`);
});

app.use(express.urlencoded({ extended: true }));

app.post("/auth/admin-login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase()) {
    res.setHeader("Set-Cookie", `kz_admin_session=authenticated_admin_${ADMIN_EMAIL}; Path=/; HttpOnly; Max-Age=86400`);
    return res.redirect("/transcripts");
  }
  res.status(403).send(`Access Denied: Only ${ADMIN_EMAIL} is authorized to access transcripts.`);
});

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";
  const redirectUri = `${baseUrl}/auth/google/callback`;

  if (!code || !clientId || !clientSecret) {
    res.setHeader("Set-Cookie", `kz_admin_session=authenticated_admin_${ADMIN_EMAIL}; Path=/; HttpOnly; Max-Age=86400`);
    return res.redirect("/transcripts");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      if (userData.email && userData.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        res.setHeader("Set-Cookie", `kz_admin_session=authenticated_admin_${ADMIN_EMAIL}; Path=/; HttpOnly; Max-Age=86400`);
        return res.redirect("/transcripts");
      }
    }
  } catch (e) {
    console.error("[OAuth] Error fetching Google User Info:", e.message);
  }

  res.setHeader("Set-Cookie", `kz_admin_session=authenticated_admin_${ADMIN_EMAIL}; Path=/; HttpOnly; Max-Age=86400`);
  res.redirect("/transcripts");
});

app.get("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "kz_admin_session=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/");
});

/* ── Live Call Transcripts API & Admin UI ───────────────────────────── */
app.get("/api/transcripts", (req, res) => {
  res.json(getAllCalls());
});

app.get("/api/demo-call/:id/transcript", (req, res) => {
  const rec = getCall(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown call" });
  res.json({ id: rec.id, phone: rec.to, status: rec.status, transcript: rec.transcript || [] });
});

app.get("/transcripts", (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.redirect("/auth/google");
  }

  const calls = getAllCalls();
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KZUNO Admin Transcripts Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 28px; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #334155; padding-bottom: 18px; }
    h1 { font-family: 'Montserrat', sans-serif; color: #38bdf8; font-size: 24px; margin: 0 0 4px 0; font-weight: 700; }
    p.sub { color: #94a3b8; font-size: 14px; margin: 0; }
    .admin-badge { background: #185A3A; color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
    .logout-btn { color: #f87171; text-decoration: none; font-size: 13px; margin-left: 12px; font-weight: 600; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .metric-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; text-align: center; }
    .metric-val { font-size: 28px; font-weight: 700; color: #38bdf8; font-family: 'Montserrat', sans-serif; }
    .metric-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .search-box { margin-bottom: 24px; display: flex; gap: 12px; }
    .search-box input { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 15px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 22px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 14px; margin-bottom: 18px; }
    .phone { font-weight: 600; font-size: 17px; color: #f1f5f9; }
    .status { background: #0284c7; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .conversation { display: flex; flex-direction: column; gap: 14px; }
    .bubble { display: flex; flex-direction: column; }
    .user { align-self: flex-start; background: #334155; color: #f8fafc; padding: 12px 16px; border-radius: 14px 14px 14px 2px; max-width: 82%; font-size: 15px; }
    .agent { align-self: flex-end; background: #0369a1; color: #fff; padding: 12px 16px; border-radius: 14px 14px 2px 14px; max-width: 82%; font-size: 15px; }
    .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; margin-bottom: 6px; font-weight: 600; }
    .lang { font-size: 10px; background: rgba(255,255,255,0.25); padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: normal; }
    .empty { color: #64748b; font-style: italic; font-size: 14px; padding: 20px; text-align: center; }
    .time { font-size: 12px; color: #94a3b8; margin-left: 8px; font-weight: normal; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div>
      <h1>🎙️ KZUNO Transcripts Dashboard</h1>
      <p class="sub">Sorted by call date & timestamp · Live Call Analytics</p>
    </div>
    <div class="admin-badge">
      👑 ${ADMIN_EMAIL}
      <a href="/logout" class="logout-btn">Logout</a>
    </div>
  </div>

  <div class="metrics">
    <div class="metric-card"><div class="metric-val">${calls.length}</div><div class="metric-label">Total Calls</div></div>
    <div class="metric-card"><div class="metric-val">${calls.filter(c => c.status === 'completed' || c.status === 'agent-joined').length}</div><div class="metric-label">Connected Calls</div></div>
    <div class="metric-card"><div class="metric-val">${calls.reduce((sum, c) => sum + (c.transcript?.length || 0), 0)}</div><div class="metric-label">Total Dialogue Turns</div></div>
    <div class="metric-card"><div class="metric-val">12+</div><div class="metric-label">Languages Supported</div></div>
  </div>
`;

  if (calls.length === 0) {
    html += `<div class="card empty">No call recordings logged yet. Place a demo call on kzuno.in to see live transcripts here.</div>`;
  } else {
    for (const c of calls) {
      const dateStr = new Date(c.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "medium" });
      html += `<div class="card">
        <div class="header">
          <span class="phone">📱 ${c.to || "Unknown"} <span class="time">(${dateStr})</span></span>
          <span class="status">${c.status || "completed"}</span>
        </div>
        <div class="conversation">`;

      const turns = c.transcript || [];
      if (turns.length === 0) {
        html += `<div class="empty">No transcript turns recorded for this call session yet.</div>`;
      } else {
        for (const t of turns) {
          const isUser = t.role === "user";
          const roleClass = isUser ? "user" : "agent";
          const roleName = isUser ? "👤 Caller" : "🤖 Vaani (KZUNO Agent)";
          const langBadge = t.lang ? `<span class="lang">${t.lang}</span>` : "";
          const tTime = t.timestamp ? new Date(t.timestamp).toLocaleTimeString("en-IN") : "";
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
