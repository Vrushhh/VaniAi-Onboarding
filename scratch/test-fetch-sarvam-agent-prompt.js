// scratch/test-fetch-sarvam-agent-prompt.js
import "dotenv/config";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";
const AGENT_ID = "Kzuno-Agent-a7d3db0c-63be";
const ORG_ID = "019ef441-dafb-7f96-9184-64c5716c4e15";
const WORKSPACE_ID = "019ef441-daff-7ab7-aa42-48cb2b90b4f8";

async function testEndpoints() {
  console.log("Testing Sarvam Agent API Endpoints...");

  const endpoints = [
    `https://api.sarvam.ai/voice-agents/agents/${AGENT_ID}`,
    `https://api.sarvam.ai/samvaad/agents/${AGENT_ID}`,
    `https://api.sarvam.ai/v1/voice-agents/agents/${AGENT_ID}`,
    `https://api.sarvam.ai/voice-agents/${AGENT_ID}`,
    `https://api.sarvam.ai/agents/${AGENT_ID}`,
  ];

  for (const url of endpoints) {
    try {
      console.log(`Fetching: ${url}`);
      const res = await fetch(url, {
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
          "x-org-id": ORG_ID,
          "x-workspace-id": WORKSPACE_ID,
        },
      });
      console.log(`Status: ${res.status}`);
      const body = await res.text();
      console.log(`Response snippet: ${body.slice(0, 300)}\n`);
    } catch (err) {
      console.error(`Error fetching ${url}:`, err.message);
    }
  }
}

testEndpoints();
