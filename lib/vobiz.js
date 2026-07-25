// lib/vobiz.js
// Places outbound calls using the Vobiz REST API.
// Vobiz dials the user; on answer, Vobiz fetches the XML instructions from
// our webhook, which instructs Vobiz to bridge the call to the xAI SIP endpoint.

const VOBIZ_AUTH_ID = process.env.VOBIZ_AUTH_ID || "MA_299I2U8T";
const VOBIZ_AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN || "xJXGUcpM2mSc8TRqO3S2XJ5WSTuVhFatnOJiB5EVRO9CTTeOfnh3gJz8V4OilRkO";
const VOBIZ_NUMBER = process.env.VOBIZ_NUMBER || "+918071578639";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";

export function assertVobizConfigured() {
  if (!VOBIZ_AUTH_ID || !VOBIZ_AUTH_TOKEN) {
    throw new Error("Vobiz API credentials missing.");
  }
}

/**
 * Triggers an outbound call using the Vobiz API.
 * @param {string} toNumber E.164, e.g. +91XXXXXXXXXX
 * @param {string} demoId our internal call record id
 * @returns {Promise<string>} Vobiz Call SID/ID
 */
export async function startVobizCall(toNumber, demoId) {
  assertVobizConfigured();

  const url = `https://api.vobiz.ai/api/v1/Account/${VOBIZ_AUTH_ID}/Call/`;

  const payload = {
    from: VOBIZ_NUMBER,
    to: toNumber,
    answer_url: `${PUBLIC_BASE_URL}/webhooks/vobiz-answer?demo_id=${encodeURIComponent(demoId)}&to_number=${encodeURIComponent(toNumber)}`,
    hangup_url: `${PUBLIC_BASE_URL}/webhooks/vobiz-hangup?demo_id=${encodeURIComponent(demoId)}`,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": VOBIZ_AUTH_ID,
      "X-Auth-Token": VOBIZ_AUTH_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vobiz ${res.status}: ${text.slice(0, 300)}`);
  }

  let callId = null;
  try {
    const data = JSON.parse(text);
    callId = data?.id || data?.callId || null;
  } catch {
    // Ignore JSON parsing issues if response is not JSON
  }
  return callId;
}
