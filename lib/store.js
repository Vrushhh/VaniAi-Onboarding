// lib/store.js
// In-memory + disk persistent state: call records, rate limits, and structured transcripts.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const calls = new Map(); // id -> { id, to, status, createdAt, transcript: [] }
const byNumber = new Map(); // normalized number -> [timestamps]

const LIMIT = Number(process.env.DEMO_RATE_LIMIT || 10);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const TRANSCRIPT_FILE = path.resolve("./transcripts.jsonl");

// Load existing transcripts from disk on startup if file exists
try {
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
          rec.transcript.push(item);
        }
      } catch {}
    }
  }
} catch (err) {
  console.error("Failed to load transcripts from disk:", err.message);
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
  return record;
}

export function updateCallStatus(id, status, extra = {}) {
  const rec = calls.get(id);
  if (!rec) return null;
  Object.assign(rec, { status }, extra);
  return rec;
}

export function getCall(id) {
  return calls.get(id) || null;
}

export function addTranscriptEntry(callId, role, text, extra = {}) {
  const rec = calls.get(callId);
  const timestamp = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    callId,
    phone: rec?.to || null,
    role, // 'user' or 'agent'
    text,
    timestamp,
    ...extra,
  };

  if (rec) {
    if (!rec.transcript) rec.transcript = [];
    rec.transcript.push(entry);
  }

  // Persist to disk as JSONL
  try {
    fs.appendFileSync(TRANSCRIPT_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to append transcript to file:", err.message);
  }

  return entry;
}

export function getAllCalls() {
  return Array.from(calls.values()).sort((a, b) => b.createdAt - a.createdAt);
}
