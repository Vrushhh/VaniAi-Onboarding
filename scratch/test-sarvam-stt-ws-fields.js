// scratch/test-sarvam-stt-ws-fields.js
// Manual test script to verify exact audio message fields expected by Sarvam STT.

import WebSocket from "ws";

const SARVAM_API_KEY = "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

function testWs() {
  console.log("Connecting to Sarvam STT WebSocket with query parameters...");
  const ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=hi-IN", {
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
  });

  ws.on("open", () => {
    console.log("SUCCESS! Connection established successfully.");
    
    // Send a silent audio chunk with all expected metadata fields
    const silentB64 = Buffer.alloc(320).toString("base64");
    ws.send(JSON.stringify({
      audio: {
        data: silentB64,
        encoding: "linear16",
        sample_rate: 8000
      }
    }));
    
    console.log("Sent audio chunk with fields. Waiting 3 seconds...");
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
