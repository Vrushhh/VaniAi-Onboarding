// scratch/test-sarvam-downsample.js
// Manual test script to verify downsample24to8 outputs valid PCM data.

import fs from "node:fs";

const SARVAM_API_KEY = "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

function downsample24to8(buffer) {
  // Find the 'data' marker in the WAV file to dynamically extract raw PCM bytes
  const dataOffset = buffer.indexOf(Buffer.from("data"));
  const raw = dataOffset !== -1 ? buffer.slice(dataOffset + 8) : buffer.slice(44);
  
  console.log("Raw PCM data offset:", dataOffset !== -1 ? dataOffset + 8 : 44);
  console.log("Raw PCM bytes length:", raw.length);
  
  const length = raw.length / 2;
  const downsampled = Buffer.alloc(Math.floor(length / 3) * 2);
  let writeOffset = 0;
  for (var i = 0; i < length; i += 3) {
    if (writeOffset + 2 <= downsampled.length && (i * 2 + 1) < raw.length) {
      downsampled.writeInt16LE(raw.readInt16LE(i * 2), writeOffset);
      writeOffset += 2;
    }
  }
  return downsampled;
}

async function testWav() {
  console.log("Fetching Sarvam TTS audio...");
  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "नमस्ते!",
        target_language_code: "hi-IN",
        speaker: "shubh",
        model: "bulbul:v3"
      }),
    });

    const data = await res.json();
    const b64Wav = data.audios?.[0];
    if (b64Wav) {
      const wavBuffer = Buffer.from(b64Wav, "base64");
      const pcm = downsample24to8(wavBuffer);
      console.log("Downsampled PCM length:", pcm.length);
      
      // Let's check if the PCM buffer has non-zero data
      let nonZeroCount = 0;
      for (let i = 0; i < pcm.length; i++) {
        if (pcm[i] !== 0) {
          nonZeroCount++;
        }
      }
      console.log("Non-zero byte count:", nonZeroCount);
    } else {
      console.log("No audio generated.");
    }
  } catch (e) {
    console.error("Test Failed:", e);
  }
}

testWav();
