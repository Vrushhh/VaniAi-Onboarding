// scratch/test-sarvam-stt-ws-upsample.js
// Manual test script to verify that upsampling to 16kHz and prepending a WAV header works on Sarvam STT.

import WebSocket from "ws";

const SARVAM_API_KEY = "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

function getWavHeader(numBytes, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + numBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24); // 16000Hz
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate (16000 * 2 bytes/sample)
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // 16 bits
  header.write("data", 36);
  header.writeUInt32LE(numBytes, 40);
  return header;
}

function upsample8to16(buffer) {
  const length = buffer.length / 2;
  const upsampled = Buffer.alloc(length * 2 * 2);
  let writeOffset = 0;
  for (let i = 0; i < length; i++) {
    const sample = buffer.readInt16LE(i * 2);
    upsampled.writeInt16LE(sample, writeOffset);
    upsampled.writeInt16LE(sample, writeOffset + 2);
    writeOffset += 4;
  }
  return upsampled;
}

function testWs() {
  console.log("Connecting to Sarvam STT WebSocket with 16kHz sample rate...");
  const ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=hi-IN", {
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
  });

  ws.on("open", () => {
    console.log("SUCCESS! Connection established successfully.");
    
    // Create raw 8kHz silent PCM buffer, upsample to 16kHz, and prepend WAV header
    const pcm8 = Buffer.alloc(3200); // 8kHz silent buffer
    const pcm16 = upsample8to16(pcm8);
    const header = getWavHeader(pcm16.length, 16000);
    const wavFile = Buffer.concat([header, pcm16]);
    
    ws.send(JSON.stringify({
      audio: {
        data: wavFile.toString("base64"),
        encoding: "audio/wav",
        sample_rate: 16000
      }
    }));
    
    console.log("Sent upsampled 16kHz WAV chunk. Waiting 3 seconds...");
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
