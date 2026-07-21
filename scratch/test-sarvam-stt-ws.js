// scratch/test-sarvam-stt-ws.js
// Manual test script to connect to Sarvam STT WebSocket and verify authentication.

import WebSocket from "ws";

const SARVAM_API_KEY = "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

function testWs() {
  console.log("Connecting to Sarvam STT WebSocket...");
  const ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws", {
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
  });

  ws.on("open", () => {
    console.log("SUCCESS! Connection established successfully.");
    ws.send(JSON.stringify({
      config: {
        model: "saaras:v3",
        language_code: "hi-IN",
        sample_rate: 8000
      }
    }));
    console.log("Sent config. Waiting 3 seconds...");
    setTimeout(() => {
      ws.close();
    }, 3000);
  });

  ws.on("message", (data) => {
    console.log("Message received:", data.toString());
  });

  ws.on("close", (code, reason) => {
    console.log("Connection closed. Code:", code, "Reason:", reason.toString());
  });

  ws.on("error", (err) => {
    console.error("Connection Error:", err);
  });
}

testWs();
