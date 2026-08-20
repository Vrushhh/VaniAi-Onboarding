// scratch/test-fetch-sarvam-agent-2.js
import "dotenv/config";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";
const AGENT_ID = "Kzuno-Agent-a7d3db0c-63be";
const ORG_ID = "019ef441-dafb-7f96-9184-64c5716c4e15";
const WORKSPACE_ID = "019ef441-daff-7ab7-aa42-48cb2b90b4f8";

async function probe() {
  const urls = [
    `https://indus.sarvam.ai/api/samvaad/agents/${AGENT_ID}`,
    `https://indus.sarvam.ai/api/v1/agents/${AGENT_ID}`,
    `https://api.sarvam.ai/voice-agents`,
    `https://api.sarvam.ai/samvaad/agents`,
    `https://api.sarvam.ai/v1/agents/${AGENT_ID}`,
    `https://api.sarvam.ai/voice-agent/session/start`,
    `https://api.sarvam.ai/samvaad/session/start`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: url.includes("session/start") ? "POST" : "GET",
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
          "Authorization": `Bearer ${SARVAM_API_KEY}`,
          "Content-Type": "application/json",
          "x-org-id": ORG_ID,
          "x-workspace-id": WORKSPACE_ID,
        },
        body: url.includes("session/start") ? JSON.stringify({
          org_id: ORG_ID,
          workspace_id: WORKSPACE_ID,
          app_id: AGENT_ID,
        }) : undefined,
      });
      console.log(`URL: ${url} | Status: ${res.status}`);
      const body = await res.text();
      console.log(`Body: ${body.slice(0, 300)}\n`);
    } catch (e) {
      console.log(`Err ${url}: ${e.message}`);
    }
  }
}

probe();
