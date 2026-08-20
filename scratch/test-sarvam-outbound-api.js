// scratch/test-sarvam-outbound-api.js
import "dotenv/config";

const SARVAM_SAMVAAD_API_KEY = process.env.SARVAM_SAMVAAD_API_KEY || "sk_samvaad_xeallj0x_pflco6WOLGUHgyMFsvwAsUmz";
const ORG_ID = "019ef441-dafb-7f96-9184-64c5716c4e15";
const WORKSPACE_ID = "019ef441-daff-7ab7-aa42-48cb2b90b4f8";
const APP_ID = "Kzuno-Agent-a7d3db0c-63be";
const CONNECTION_ID = "Vobiz-Vrush-07bfec04-fbf0";
const AGENT_PHONE = "+918071578639";

export async function triggerSarvamSamvaadCall(toNumber, demoId = "test-call-1") {
  const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${ORG_ID}/workspaces/${WORKSPACE_ID}/outbounds`;

  const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.kzuno.in";

  const payload = {
    app_config: {
      app_id: APP_ID,
      app_version: 1,
      app_type: "agent",
      connection_config: {
        connection_id: CONNECTION_ID,
        agent_phone_number: AGENT_PHONE
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

  console.log("Triggering Sarvam Samvaad Outbound Call API:", url);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": SARVAM_SAMVAAD_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${text}`);

  if (!res.ok) {
    throw new Error(`Sarvam Samvaad ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// Run diagnostic test
if (process.argv[1].endsWith("test-sarvam-outbound-api.js")) {
  triggerSarvamSamvaadCall("+919821166456", "test-demo-123").catch(console.error);
}
