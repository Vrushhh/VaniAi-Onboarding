// scratch/test-sarvam-stt-ws-wav.js
// Manual test script to verify that prepending a WAV header to PCM16 works on Sarvam STT.

import WebSocket from "ws";

const SARVAM_API_KEY = "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

function getWavHeader(numBytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + numBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(8000, 24); // 8000Hz
  header.writeUInt32LE(16000, 28); // Byte rate
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // 16 bits
  header.write("data", 36);
  header.writeUInt32LE(numBytes, 40);
  return header;
}

function testWs() {
  console.log("Connecting to Sarvam STT WebSocket with query parameters...");
  const ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=hi-IN", {
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
  });

  ws.on("open", () => {
    console.log("SUCCESS! Connection established successfully.");
    
    // Create raw silent PCM buffer and prepend WAV header
    const pcm = Buffer.alloc(3200); // 1.6 seconds of silence (3200 bytes)
    const header = getWavHeader(pcm.length);
    const wavFile = Buffer.concat([header, pcm]);
    
    ws.send(JSON.stringify({
      audio: {
        data: wavFile.toString("base64"),
        encoding: "audio/wav",
        sample_rate: 8000
      }
    }));
    
    console.log("Sent WAV audio chunk. Waiting 3 seconds...");
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
