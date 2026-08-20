// lib/vobiz.js
// Places outbound calls using the Vobiz REST API.
// Vobiz dials the user; on answer, Vobiz fetches the XML instructions from
// our webhook, which instructs Vobiz to bridge the call to the xAI SIP endpoint.

const VOBIZ_AUTH_ID = process.env.VOBIZ_AUTH_ID || "MA_299I2U8T";
const VOBIZ_AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN || "xJXGUcpM2mSc8TRqO3S2XJ5WSTuVhFatnOJiB5EVRO9CTTeOfnh3gJz8V4OilRkO";
const VOBIZ_NUMBER = process.env.VOBIZ_NUMBER || "+918071578639";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";

const SARVAM_SAMVAAD_API_KEY = process.env.SARVAM_SAMVAAD_API_KEY || "sk_samvaad_xeallj0x_pflco6WOLGUHgyMFsvwAsUmz";
const ORG_ID = "019ef441-dafb-7f96-9184-64c5716c4e15";
const WORKSPACE_ID = "019ef441-daff-7ab7-aa42-48cb2b90b4f8";
const APP_ID = "Kzuno-Agent-a7d3db0c-63be";
const CONNECTION_ID = "Vobiz-Vrush-07bfec04-fbf0";

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

  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";

  const payload = {
    from: VOBIZ_NUMBER,
    to: toNumber,
    answer_url: `${baseUrl}/webhooks/vobiz-answer?demo_id=${encodeURIComponent(demoId)}`,
    answer_method: "POST",
    hangup_url: `${baseUrl}/webhooks/vobiz-hangup?demo_id=${encodeURIComponent(demoId)}`,
    hangup_method: "POST",
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

/**
 * Triggers an outbound call directly using Sarvam Samvaad Managed Voice Agent Platform API.
 * Uses agent 'Kzuno-Agent-a7d3db0c-63be' on Vobiz connection 'Vobiz-Vrush-07bfec04-fbf0'.
 */
export async function triggerSarvamSamvaadCall(toNumber, demoId) {
  const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${ORG_ID}/workspaces/${WORKSPACE_ID}/outbounds`;
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";

  const payload = {
    app_config: {
      app_id: APP_ID,
      app_version: 1,
      app_type: "agent",
      connection_config: {
        connection_id: CONNECTION_ID,
        agent_phone_number: VOBIZ_NUMBER
      },
      agent_variables: {
        call_summary: "Live KZUNO Website Demo Call",
        user_name: "D2C Brand Owner"
      },
      app_overrides: {
        initial_bot_message: "Hi! I'm Vaani from Keezoono. I saw you just requested a demo call on our website. Am I speaking with a D2C brand owner or shopify business owner?"
      }
    },
    user_config: {
      user_phone_number: toNumber
    },
    webhook_config: {
      url: `${baseUrl}/api/sarvam/tools/execute`,
      metadata: {
        lead_id: demoId
      }
    }
  };

  console.log(`[Sarvam Samvaad Outbound API] Initiating call to ${toNumber} (demoId: ${demoId})`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": SARVAM_SAMVAAD_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sarvam Samvaad ${res.status}: ${text}`);
  }

  let attemptId = null;
  try {
    const data = JSON.parse(text);
    attemptId = data?.attempt_id || null;
  } catch {
    // Ignore JSON parse errors
  }
  return attemptId;
}
