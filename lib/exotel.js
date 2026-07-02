// lib/exotel.js
// Places the outbound call via Exotel's Connect Voice AI API.
// Exotel dials the user; when they answer, Exotel opens a bidirectional
// WebSocket ("AgentStream") to our /exotel-media endpoint, which we bridge
// to the xAI Grok Voice Agent.
//
// Docs: https://developer.exotel.com/docs/agentstream/developer-guide

const {
  EXOTEL_SID,
  EXOTEL_API_KEY,
  EXOTEL_API_TOKEN,
  EXOTEL_SUBDOMAIN = "api.exotel.com",
  EXOPHONE,
  PUBLIC_BASE_URL,
} = process.env;

export function assertExotelConfigured() {
  const missing = [
    ["EXOTEL_SID", EXOTEL_SID],
    ["EXOTEL_API_KEY", EXOTEL_API_KEY],
    ["EXOTEL_API_TOKEN", EXOTEL_API_TOKEN],
    ["EXOPHONE", EXOPHONE],
    ["PUBLIC_BASE_URL", PUBLIC_BASE_URL],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Exotel not configured. Missing env: ${missing.join(", ")}`);
  }
}

/**
 * Ring the user's phone; on answer, Exotel streams call audio to our
 * WebSocket bridge which runs the Grok voice agent.
 * @param {string} toNumber E.164, e.g. +9198XXXXXXXX
 * @param {string} demoId our internal call record id (passed back on the stream URL)
 * @returns {Promise<string>} Exotel Call SID
 */
export async function startDemoCall(toNumber, demoId) {
  assertExotelConfigured();

  const wsBase = PUBLIC_BASE_URL.replace(/^http/, "ws"); // https:// → wss://
  const streamUrl = `${wsBase}/exotel-media?demo_id=${encodeURIComponent(demoId)}`;

  const url = `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;
  const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");

  const form = new URLSearchParams({
    From: toNumber,
    CallerId: EXOPHONE,
    StreamUrl: streamUrl,
    StreamType: "bidirectional",
    StatusCallback: `${PUBLIC_BASE_URL}/webhooks/exotel-status?demo_id=${encodeURIComponent(demoId)}`,
    "StatusCallbackEvents[0]": "terminal",
    "StatusCallbackEvents[1]": "answered",
    StatusCallbackContentType: "application/json",
    TimeLimit: "180", // hard cap: 3-minute demo
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Exotel ${res.status}: ${text.slice(0, 300)}`);
  }

  let sid = null;
  try {
    const data = JSON.parse(text);
    sid = data?.Call?.Sid || data?.call?.sid || null;
  } catch {
    /* some responses are XML; sid stays null, not fatal */
  }
  return sid;
}
