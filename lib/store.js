// lib/store.js
// Persistent Database & State Management: Call records, rate limits, and structured transcripts.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const calls = new Map(); // id -> { id, to, status, createdAt, transcript: [] }
const byNumber = new Map(); // normalized number -> [timestamps]

const LIMIT = Number(process.env.DEMO_RATE_LIMIT || 10);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const TRANSCRIPT_FILE = path.resolve("./transcripts.jsonl");
const DB_FILE = path.resolve("./calls_db.json");

// Helper to save state to disk asynchronously/safely
function persistDb() {
  try {
    const data = Array.from(calls.values());
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[store] Failed to persist DB to disk:", err.message);
  }
}

// Load existing database from disk on startup
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && item.id) {
          calls.set(item.id, {
            id: item.id,
            to: item.to || "Unknown",
            status: item.status || "completed",
            createdAt: item.createdAt || Date.now(),
            transcript: item.transcript || [],
          });
        }
      }
    }
  }

  // Also read any legacy transcripts.jsonl entries to guarantee complete history
  if (fs.existsSync(TRANSCRIPT_FILE)) {
    const lines = fs.readFileSync(TRANSCRIPT_FILE, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.callId) {
          let rec = calls.get(item.callId);
          if (!rec) {
            rec = {
              id: item.callId,
              to: item.phone || "Unknown",
              status: "completed",
              createdAt: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
              transcript: [],
            };
            calls.set(item.callId, rec);
          }
          if (!rec.transcript) rec.transcript = [];
          // Avoid duplicate entries if already loaded from DB_FILE
          const exists = rec.transcript.some(t => t.id === item.id || (t.text === item.text && t.timestamp === item.timestamp));
          if (!exists) {
            rec.transcript.push(item);
          }
        }
      } catch {}
    }
  }
  console.log(`[store] Database loaded: ${calls.size} call records active.`);
} catch (err) {
  console.error("[store] Failed to load DB from disk:", err.message);
}

export function normalizeIndianNumber(input) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  let ten = null;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1);
  if (!ten || !/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91${ten}`;
}

export function rateLimitOk(e164) {
  const now = Date.now();
  const hits = (byNumber.get(e164) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMIT) return false;
  hits.push(now);
  byNumber.set(e164, hits);
  return true;
}

export function createCall(to) {
  const id = crypto.randomUUID();
  const record = { id, to, status: "queued", createdAt: Date.now(), transcript: [] };
  calls.set(id, record);
  persistDb();
  return record;
}

export function updateCallStatus(id, status, extra = {}) {
  const rec = calls.get(id);
  if (!rec) return null;
  Object.assign(rec, { status }, extra);
  persistDb();
  return rec;
}

export function getCall(id) {
  return calls.get(id) || null;
}

export function addTranscriptEntry(callId, role, text, extra = {}) {
  const safeCallId = callId || "live-call-" + Date.now();
  let rec = calls.get(safeCallId);
  if (!rec) {
    rec = {
      id: safeCallId,
      to: extra.phone || "Live Call",
      status: "in-progress",
      createdAt: Date.now(),
      transcript: [],
    };
    calls.set(safeCallId, rec);
  }

  const timestamp = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    callId: safeCallId,
    phone: rec.to,
    role, // 'user' or 'agent'
    text,
    timestamp,
    ...extra,
  };

  if (!rec.transcript) rec.transcript = [];
  rec.transcript.push(entry);

  // Persist to disk as JSONL and update database JSON
  try {
    fs.appendFileSync(TRANSCRIPT_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[store] Failed to append transcript:", err.message);
  }
  persistDb();

  return entry;
}

export function getAllCalls() {
  return Array.from(calls.values()).sort((a, b) => b.createdAt - a.createdAt);
}
