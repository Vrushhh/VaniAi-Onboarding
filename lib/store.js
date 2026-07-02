// lib/store.js
// Minimal in-memory state: call records + a per-number rate limit.
// Swap for Redis/Supabase in production.

import crypto from "node:crypto";

const calls = new Map(); // id -> { id, to, status, twilioSid, createdAt }
const byNumber = new Map(); // normalized number -> [timestamps]

const LIMIT = Number(process.env.DEMO_RATE_LIMIT || 3);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function normalizeIndianNumber(input) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  // Accept: 10-digit mobile, 91XXXXXXXXXX, 0XXXXXXXXXX
  let ten = null;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1);
  if (!ten || !/^[6-9]\d{9}$/.test(ten)) return null; // Indian mobiles start 6–9
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
  const record = { id, to, status: "queued", twilioSid: null, createdAt: Date.now() };
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

// Best-effort match: most recent non-final call to a number (used when the
// xAI webhook only gives us SIP From/To headers).
export function getPendingCall(fromHeaderValue) {
  const digits = String(fromHeaderValue || "").replace(/[^\d]/g, "");
  let newest = null;
  for (const rec of calls.values()) {
    if (["completed", "failed"].includes(rec.status)) continue;
    if (digits && rec.to.replace(/[^\d]/g, "").endsWith(digits.slice(-10))) {
      if (!newest || rec.createdAt > newest.createdAt) newest = rec;
    }
  }
  return newest;
}
