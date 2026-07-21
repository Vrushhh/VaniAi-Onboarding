// scratch/test-sarvam-stt-ws-accumulator.js
// Manual test script to simulate streaming accumulated WAV files to STT and check responses.

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
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate (sampleRate * 2 bytes/sample)
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

  let accumulatedPcm8 = Buffer.alloc(0);
  let sendCount = 0;
  let interval;

  ws.on("open", () => {
    console.log("SUCCESS! Connection established successfully.");
    
    interval = setInterval(() => {
      sendCount++;
      // Accumulate 8000 bytes (500ms of audio) each time
      const newChunk8 = Buffer.alloc(8000);
      accumulatedPcm8 = Buffer.concat([accumulatedPcm8, newChunk8]);
      
      const pcm16 = upsample8to16(accumulatedPcm8);
      const header = getWavHeader(pcm16.length, 16000);
      const wavFile = Buffer.concat([header, pcm16]);
      
      console.log(`Sending chunk #${sendCount}. Total audio size: ${accumulatedPcm8.length} bytes.`);
      
      ws.send(JSON.stringify({
        audio: {
          data: wavFile.toString("base64"),
          encoding: "audio/wav",
          sample_rate: 16000
        }
      }));

      if (sendCount >= 5) {
        clearInterval(interval);
        setTimeout(() => {
          ws.close();
        }, 2000);
      }
    }, 500);
  });

  ws.on("message", (data) => {
    console.log("Message received:", data.toString());
  });

  ws.on("close", (code, reason) => {
    console.log("Connection closed. Code:", code, "Reason:", reason.toString());
    if (interval) clearInterval(interval);
  });

  ws.on("error", (err) => {
    console.error("Connection Error:", err);
    if (interval) clearInterval(interval);
  });
}

testWs();
