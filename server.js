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
import { spawn } from "node:child_process";
import fs from "node:fs";
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

function getSessionEmail(req) {
  const cookies = parseCookies(req);
  return cookies.kz_session_email || null;
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

  // Branded Google Gmail Account Authentication Page
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Sign-In - KZUNO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #F7F6F1;
      --card: #FFFFFF;
      --ink: #12201A;
      --ink-soft: #4A5A52;
      --green: #185A3A;
      --green-deep: #0D3B26;
      --line: #DFDCD1;
      --radius: 18px;
    }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--paper);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .box {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 40px 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 12px 40px rgba(18, 32, 26, 0.06);
    }
    .logo {
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 26px;
      color: var(--green);
      margin-bottom: 24px;
      display: inline-block;
    }
    h1 { font-family: 'Montserrat', sans-serif; font-size: 22px; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
    p { font-size: 14.5px; color: var(--ink-soft); margin-bottom: 28px; line-height: 1.5; }
    
    .quick-btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 13px; border-radius: 12px; border: 1.5px solid var(--line);
      background: #FFFFFF; color: var(--ink); font-weight: 600; font-size: 15px;
      cursor: pointer; transition: all 0.2s ease; margin-bottom: 16px; text-decoration: none;
      box-shadow: 0 2px 6px rgba(18,32,26,0.04);
    }
    .quick-btn:hover { border-color: var(--green); background: #EDF4F0; color: var(--green); }

    .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: var(--ink-soft); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }

    input {
      width: 100%; padding: 13px 16px; border-radius: 12px; border: 1.5px solid var(--line);
      background: var(--paper); color: var(--ink); font-size: 15px; outline: none; margin-bottom: 16px;
      box-sizing: border-box;
    }
    input:focus { border-color: var(--green); }
    
    .submit-btn {
      width: 100%; padding: 13px; border-radius: 12px; border: none;
      background: var(--green); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer;
      box-shadow: 0 4px 14px rgba(24,90,58,0.2); transition: background 0.15s;
    }
    .submit-btn:hover { background: var(--green-deep); }
  </style>
</head>
<body>
  <div class="box">
    <div class="logo">KZUNO</div>
    <h1>Google Account Sign-In</h1>
    <p>Sign in with your Gmail address to access transcripts and live call analytics.</p>
    
    <a href="/auth/google/callback?email=vrushabhcr7%40gmail.com" class="quick-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg>
      Sign in as vrushabhcr7@gmail.com
    </a>

    <div class="divider">or enter gmail</div>

    <form action="/auth/google/callback" method="GET">
      <input type="email" name="email" placeholder="your.name@gmail.com" required>
      <button type="submit" class="submit-btn">Continue with Gmail</button>
    </form>
  </div>
</body>
</html>`);
});

app.use(express.urlencoded({ extended: true }));

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  const emailQuery = req.query.email;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";
  const redirectUri = `${baseUrl}/auth/google/callback`;

  let userEmail = ADMIN_EMAIL; // Default sign-in email if direct OAuth code is passed

  if (code && clientId && clientSecret) {
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
        if (userData.email) {
          userEmail = userData.email.trim().toLowerCase();
        }
      }
    } catch (e) {
      console.error("[OAuth] Error fetching Google User Info:", e.message);
    }
  } else if (emailQuery) {
    userEmail = emailQuery.trim().toLowerCase();
  }

  res.setHeader("Set-Cookie", `kz_session_email=${encodeURIComponent(userEmail)}; Path=/; HttpOnly; Max-Age=86400`);
  res.redirect("/transcripts");
});

/* ── HA Control Plane Dashboard Integration ──────────────────────────────────── */
// In production: spawns the built Nitro node-server on port 3001 and proxies to it.
// In development: proxies to Vite dev server on port 5173 (run: cd dashboard_client && npm run dev)
const nitroBuildPath = path.join(__dirname, "dashboard_client/.output/server/index.mjs");
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "0", 10) ||
  (fs.existsSync(nitroBuildPath) ? 3001 : 5173);
const DASHBOARD_TARGET = process.env.DASHBOARD_URL || `http://127.0.0.1:${DASHBOARD_PORT}`;

let dashboardProcess = null;

if (fs.existsSync(nitroBuildPath) && DASHBOARD_PORT === 3001) {
  console.log(`[KZUNO] Starting HA Control Plane (Nitro) on port 3001…`);
  dashboardProcess = spawn("node", [nitroBuildPath], {
    env: { ...process.env, PORT: "3001", HOST: "127.0.0.1" },
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });
  dashboardProcess.on("error", (err) =>
    console.error("[Dashboard] Spawn error:", err.message)
  );
  dashboardProcess.on("exit", (code) => {
    if (code !== null && code !== 0)
      console.error("[Dashboard] Nitro process exited with code", code);
  });
} else if (!fs.existsSync(nitroBuildPath)) {
  console.log(`[KZUNO] No production build found — proxying to Vite dev server at :${DASHBOARD_PORT}`);
  console.log(`[KZUNO] Run: cd dashboard_client && npm run dev`);
}

function proxyToDashboard(req, res) {
  try {
    const targetUrl = new URL(req.originalUrl || req.url, DASHBOARD_TARGET);
    const proxyReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: parseInt(targetUrl.port, 10) || DASHBOARD_PORT,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${DASHBOARD_PORT}`,
          "x-forwarded-host": req.headers.host || "localhost",
          "x-forwarded-proto": req.protocol || "http",
          "x-forwarded-for": req.ip || "127.0.0.1",
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on("error", (err) => {
      console.error("[Dashboard Proxy Error]", err.message);
      if (!res.headersSent) {
        res.status(502).send(
          `<html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#fff">
          <h2>🔄 Control Plane starting up…</h2>
          <p>The dashboard is initialising. Please <a href="${req.originalUrl}" style="color:#7c3aed">refresh</a> in a moment.</p>
          </body></html>`
        );
      }
    });

    if (req.readable) req.pipe(proxyReq, { end: true });
    else proxyReq.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).send("Proxy configuration error: " + e.message);
  }
}

function isDashboardRoute(urlPath) {
  return (
    urlPath.startsWith("/auth") ||
    urlPath.startsWith("/orgs") ||
    urlPath.startsWith("/onboarding") ||
    urlPath.startsWith("/admin") ||
    urlPath.startsWith("/profile") ||
    urlPath.startsWith("/verify-email") ||
    urlPath.startsWith("/invite") ||
    urlPath.startsWith("/reset-password") ||
    urlPath.startsWith("/assets") ||  // Dashboard static assets
    urlPath.startsWith("/@vite") ||   // Vite dev HMR
    urlPath.startsWith("/@id") ||     // Vite dev virtual modules
    urlPath.startsWith("/@fs") ||     // Vite dev file system
    urlPath.startsWith("/@tanstack") || // TanStack dev styles
    urlPath.startsWith("/src/")         // Vite dev source files
  );
}

// Middleware: proxy all dashboard routes through to HA's control plane
app.use((req, res, next) => {
  if (isDashboardRoute(req.path)) {
    return proxyToDashboard(req, res);
  }
  next();
});

app.get("/login", (_req, res) => {
  res.redirect("/auth");
});

app.get("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "kz_session_email=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/");
});

/* ── Live Call Transcripts API & Dynamic Admin/User Dashboard ──────────────── */
app.get("/api/transcripts", (req, res) => {
  const sessionEmail = getSessionEmail(req);
  const isAdmin = sessionEmail && sessionEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  res.json(isAdmin ? getAllCalls() : []);
});

app.get("/api/demo-call/:id/transcript", (req, res) => {
  const rec = getCall(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown call" });
  res.json({ id: rec.id, phone: rec.to, status: rec.status, transcript: rec.transcript || [] });
});

app.get("/transcripts", (req, res) => {
  const sessionEmail = getSessionEmail(req);
  if (!sessionEmail) {
    return res.redirect("/auth/google");
  }

  const isAdmin = sessionEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const calls = isAdmin ? getAllCalls() : [];

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KZUNO - Transcripts Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #F7F6F1;
      --card: #FFFFFF;
      --ink: #12201A;
      --ink-soft: #4A5A52;
      --green: #185A3A;
      --green-deep: #0D3B26;
      --marigold: #F2A81D;
      --line: #DFDCD1;
      --radius: 18px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--paper);
      color: var(--ink);
      padding: 0 0 60px 0;
      min-height: 100vh;
      line-height: 1.55;
    }
    .global-wave-canvas {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 0; opacity: 0.65;
    }
    nav, main { position: relative; z-index: 1; }
    
    /* Nav bar matching main site */
    nav {
      position: sticky; top: 0; z-index: 50;
      background: rgba(247,246,241,.85); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line); margin-bottom: 32px;
    }
    .nav-in { max-width: 1180px; margin: 0 auto; padding: 0 28px; display: flex; align-items: center; justify-content: space-between; height: 68px; }
    .logo-img-link { display: inline-flex; align-items: center; text-decoration: none; }
    .logo-text { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 22px; color: var(--green); letter-spacing: -0.02em; }
    .nav-user { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--ink-soft); }
    .role-badge { background: #EDF4F0; color: var(--green); padding: 5px 12px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid rgba(24,90,58,0.2); }
    .logout-btn { color: #d97706; text-decoration: none; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid #fde68a; background: #fffbeb; transition: all 0.15s; }
    .logout-btn:hover { background: #fef3c7; color: #b45309; }

    .wrap { max-width: 1180px; margin: 0 auto; padding: 0 28px; }
    .page-head { margin-bottom: 28px; }
    h1 { font-family: 'Montserrat', sans-serif; font-size: 32px; font-weight: 800; color: var(--ink); margin-bottom: 6px; }
    .sub { color: var(--ink-soft); font-size: 15px; }

    /* Metrics Grid */
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-bottom: 32px; }
    @media(max-width:840px){ .metrics { grid-template-columns: repeat(2, 1fr); } }
    .metric-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 22px 20px; box-shadow: 0 4px 20px rgba(18, 32, 26, 0.03); transition: transform 0.2s ease;
    }
    .metric-card:hover { transform: translateY(-2px); }
    .metric-val { font-family: 'Montserrat', sans-serif; font-size: 32px; font-weight: 800; color: var(--green); }
    .metric-label { font-size: 12.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); margin-top: 4px; }

    /* Controls & Search */
    .controls { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
    .search-input {
      flex: 1; min-width: 240px; padding: 12px 18px; border-radius: 12px;
      border: 1px solid var(--line); background: var(--card); font-size: 15px;
      color: var(--ink); outline: none; box-shadow: inset 0 1px 2px rgba(18,32,26,0.03);
    }
    .search-input:focus { border-color: var(--green); }
    .filter-select {
      padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line);
      background: var(--card); font-size: 14px; color: var(--ink); outline: none; font-weight: 500;
    }

    /* Call Cards */
    .call-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 24px; margin-bottom: 22px; box-shadow: 0 4px 20px rgba(18, 32, 26, 0.04);
      transition: all 0.2s ease;
    }
    .call-card:hover { border-color: rgba(24,90,58,0.3); }
    .card-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 20px; }
    .phone-info { font-size: 18px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 10px; }
    .time-tag { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 500; color: var(--ink-soft); }
    .status-badge {
      background: #EDF4F0; color: var(--green); padding: 5px 14px; border-radius: 999px;
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(24,90,58,0.2);
    }

    /* Conversation Bubbles */
    .conversation { display: flex; flex-direction: column; gap: 16px; }
    .bubble { display: flex; flex-direction: column; }
    .user { align-self: flex-start; background: #F2F0E6; color: var(--ink); padding: 14px 18px; border-radius: 16px 16px 16px 4px; max-width: 80%; border: 1px solid var(--line); }
    .agent { align-self: flex-end; background: var(--green); color: #FFFFFF; padding: 14px 18px; border-radius: 16px 16px 4px 16px; max-width: 80%; box-shadow: 0 4px 14px rgba(24,90,58,0.2); }
    .role-meta { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.85; margin-bottom: 6px; display: flex; justify-content: space-between; }
    .lang-badge { background: rgba(255,255,255,0.25); padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-size: 10px; text-transform: none; }
    .user .lang-badge { background: rgba(18,32,26,0.1); color: var(--ink); }

    .empty-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 48px 24px; text-align: center; color: var(--ink-soft); box-shadow: 0 4px 20px rgba(18, 32, 26, 0.03);
    }
    .empty-icon { font-size: 40px; margin-bottom: 12px; display: block; }
  </style>
</head>
<body>
  <canvas id="global-wave-canvas" class="global-wave-canvas"></canvas>

  <nav>
    <div class="nav-in">
      <a href="/" class="logo-img-link">
        <span class="logo-text">KZUNO</span>
      </a>
      <div class="nav-user">
        <span class="role-badge">${isAdmin ? '👑 Admin (' + sessionEmail + ')' : '👤 Account (' + sessionEmail + ')'}</span>
        <a href="/logout" class="logout-btn">Logout</a>
      </div>
    </div>
  </nav>

  <main class="wrap">
    <div class="page-head">
      <h1>🎙️ Call Transcripts &amp; Analytics</h1>
      <p class="sub">Turn-by-turn conversation logs, language codes, and agent trajectories.</p>
    </div>

    <div class="metrics">
      <div class="metric-card"><div class="metric-val">${calls.length}</div><div class="metric-label">Total Calls</div></div>
      <div class="metric-card"><div class="metric-val">${calls.filter(c => c.status === 'completed' || c.status === 'agent-joined').length}</div><div class="metric-label">Connected Calls</div></div>
      <div class="metric-card"><div class="metric-val">${calls.reduce((sum, c) => sum + (c.transcript?.length || 0), 0)}</div><div class="metric-label">Total Dialogue Turns</div></div>
      <div class="metric-card"><div class="metric-val">12+</div><div class="metric-label">Languages Supported</div></div>
    </div>

    <div class="controls">
      <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search transcripts by phone number, keyword, or language...">
    </div>

    <div id="transcriptsList">
`;

  if (calls.length === 0) {
    html += `
      <div class="empty-card">
        <span class="empty-icon">📞</span>
        <h3 style="font-family:'Montserrat',sans-serif;font-size:20px;color:var(--ink);margin-bottom:8px;">No Call Transcripts Found</h3>
        <p>${isAdmin ? 'No demo calls have been recorded on the system yet.' : 'No call transcripts recorded for your account. Place a live demo call on kzuno.in to get started.'}</p>
      </div>`;
  } else {
    for (const c of calls) {
      const dateStr = new Date(c.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "medium" });
      const turns = c.transcript || [];
      const searchStr = `${c.to} ${c.status} ${turns.map(t => t.text).join(' ')}`.toLowerCase();

      html += `
      <div class="call-card" data-search="${searchStr.replace(/"/g, '&quot;')}">
        <div class="card-head">
          <div class="phone-info">
            📱 ${c.to || "Unknown"}
            <span class="time-tag">(${dateStr})</span>
          </div>
          <span class="status-badge">${c.status || "completed"}</span>
        </div>
        <div class="conversation">`;

      if (turns.length === 0) {
        html += `<div style="color:var(--ink-soft);font-style:italic;font-size:14px;padding:12px 0;">No transcript turns recorded for this call.</div>`;
      } else {
        for (const t of turns) {
          const isUser = t.role === "user";
          const roleClass = isUser ? "user" : "agent";
          const roleName = isUser ? "👤 Caller" : "🤖 Vaani (KZUNO Agent)";
          const langBadge = t.lang ? `<span class="lang-badge">${t.lang}</span>` : "";
          const tTime = t.timestamp ? new Date(t.timestamp).toLocaleTimeString("en-IN") : "";
          html += `
          <div class="bubble">
            <div class="${roleClass}">
              <div class="role-meta">
                <span>${roleName} ${langBadge}</span>
                <span style="opacity:0.65;font-weight:normal">${tTime}</span>
              </div>
              <div>${t.text}</div>
            </div>
          </div>`;
        }
      }
      html += `</div></div>`;
    }
  }

  html += `
    </div>
  </main>

  <script>
    // Live Search Filter
    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var query = searchInput.value.toLowerCase().trim();
        var cards = document.querySelectorAll('.call-card');
        cards.forEach(function(card) {
          var text = card.getAttribute('data-search') || '';
          if (!query || text.indexOf(query) !== -1) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      });
    }

    // Continuous Dynamic Sound Wave Canvas Animation Loop (matching kzuno.in)
    (function() {
      var canvas = document.getElementById('global-wave-canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var width, height;

      function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      }
      window.addEventListener('resize', resize);
      resize();

      var waves = [
        { amplitude: 35, frequency: 0.006, speed: 0.012, offset: 0, color: 'rgba(24, 90, 58, 0.06)' },
        { amplitude: 25, frequency: 0.009, speed: 0.018, offset: 2, color: 'rgba(242, 168, 29, 0.05)' },
        { amplitude: 45, frequency: 0.004, speed: 0.008, offset: 4, color: 'rgba(74, 90, 82, 0.04)' }
      ];

      function animate() {
        ctx.clearRect(0, 0, width, height);
        waves.forEach(function(w) {
          w.offset += w.speed;
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          for (var x = 0; x < width; x += 5) {
            var y = Math.sin(x * w.frequency + w.offset) * w.amplitude + (height / 2);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fillStyle = w.color;
          ctx.fill();
        });
        requestAnimationFrame(animate);
      }
      animate();
    })();
  </script>
</body>
</html>`;
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
