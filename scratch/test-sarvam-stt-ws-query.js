// scratch/test-sarvam-stt-ws-query.js
// Manual test script to connect to Sarvam STT WebSocket with query parameters.

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
    
    // Send a tiny empty audio packet (base64 of 2 silent bytes) to see if it responds without validation errors
    const silentB64 = Buffer.alloc(320).toString("base64");
    ws.send(JSON.stringify({
      audio: {
        data: silentB64
      }
    }));
    
    console.log("Sent silent audio chunk. Waiting 3 seconds...");
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
