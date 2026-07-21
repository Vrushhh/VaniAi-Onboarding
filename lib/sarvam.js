// lib/sarvam.js
// Modular Adapter for Sarvam AI Voice Agent Integration.
// Orchestrates Saarika (STT WebSocket) ──► Grok LLM (REST) ──► Bulbul (TTS REST).

import WebSocket from "ws";
import { updateCallStatus } from "./store.js";

const DISCLOSURE_LINE =
  "नमस्ते! यह KZUNO की तरफ़ से एक AI डेमो कॉल है, जो आपने अभी हमारी वेबसाइट पर रिक्वेस्ट की थी।";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

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
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate
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

const DEMO_INSTRUCTIONS = `
You are "Vaani", a friendly AI voice agent from KZUNO — a voice AI platform for
Indian D2C brands. You are on a short OUTBOUND DEMO CALL that the listener
requested seconds ago on the KZUNO website, to hear what a KZUNO agent sounds like.

Language: Start in Hindi. If the listener replies in English, Hinglish, or
another language, mirror their language naturally. Short, warm, conversational
sentences — this is a phone call.

Flow:
1. You have already disclosed you're an AI (a scripted line played first).
   Greet warmly and confirm this is the demo call they requested.
2. In two sentences, explain what KZUNO agents do for brands: order confirmation,
   lead qualification, payment reminders, and 24x7 inbound support in Indian languages.
3. Offer a mini role-play: "Want me to demo a quick order-confirmation call as if
   you were a customer?" If yes, do a playful 20–30 second role-play confirming a
   fictitious order. If no, answer their questions about KZUNO instead.
4. Close by inviting them to sign up on the KZUNO website, thank them, say goodbye.

Rules:
- Never claim to be human. If asked, say you're an AI agent built on KZUNO.
- Keep the whole call under ~2 minutes; wrap up politely if it runs long.
- Never collect personal or payment information. This is a demo only.
- If the listener says "stop", "band karo", or wants to end — thank them and say goodbye immediately.
`.trim();

export class SarvamSessionAdapter {
  constructor(bridge) {
    this.bridge = bridge;
    this.ws = null;
    this.ready = false;
    this.history = [];
    this.ttsQueue = Promise.resolve();
    this.silenceTimeout = null;
    this.currentTranscript = "";
    this.speakingEndTime = 0; // Tracks when agent audio playback completes to filter out echoes
  }

  connect() {
    console.log("[bridge-sarvam] Connecting to Sarvam STT WebSocket with query parameters...");
    this.ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=hi-IN", {
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
      },
    });

    this.ws.on("open", () => {
      console.log("[bridge-sarvam] Sarvam STT WebSocket opened.");

      this.ready = true;
      if (this.bridge.demoId) updateCallStatus(this.bridge.demoId, "agent-joined");

      // Flush caller audio that arrived while connecting
      for (const b64 of this.bridge.pendingCallerAudio) {
        this.sendCallerAudio(b64);
      }
      this.bridge.pendingCallerAudio = [];

      // Start the conversation greeting ONLY if the stream SID is already set.
      // Otherwise, we wait until the bridge receives the 'start' event.
      if (this.bridge.streamSid) {
        this.speakInitialGreeting();
      }
    });

    this.ws.on("message", (raw) => this.onSarvamMessage(raw));
    this.ws.on("close", () => this.bridge.teardown("sarvam closed"));
    this.ws.on("error", (e) => this.bridge.teardown(`sarvam error: ${e.message}`));
  }

  sendCallerAudio(b64) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        const pcm8 = Buffer.from(b64, "base64");
        const pcm16 = upsample8to16(pcm8);
        const header = getWavHeader(pcm16.length, 16000);
        const wavFile = Buffer.concat([header, pcm16]);

        this.ws.send(
          JSON.stringify({
            audio: {
              data: wavFile.toString("base64"),
              encoding: "audio/wav",
              sample_rate: 16000,
            },
          })
        );
      } catch (err) {
        console.error("[bridge-sarvam] Failed to send caller audio:", err);
      }
    }
  }

  close() {
    this.ws?.close();
  }

  onStreamStarted() {
    console.log("[bridge-sarvam] Phone stream active. Triggering greeting...");
    this.speakInitialGreeting();
  }

  onSarvamMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "data" && msg.data?.transcript) {
      const text = msg.data.transcript.trim();
      if (!text) return;

      // Ignore STT inputs while the agent is playing audio (echo suppression)
      if (Date.now() < this.speakingEndTime) {
        console.log(`[bridge-sarvam] Ignored feedback/echo transcript: "${text}"`);
        return;
      }

      console.log(`[sarvam-stt] Intermediate transcript: "${text}"`);
      this.currentTranscript = text;

      // Reset the silence timeout
      if (this.silenceTimeout) clearTimeout(this.silenceTimeout);

      if (msg.data.is_final) {
        this.triggerResponse(this.currentTranscript);
      } else {
        // Local fallback silence detector (1.2 seconds of pause)
        this.silenceTimeout = setTimeout(() => {
          this.triggerResponse(this.currentTranscript);
        }, 1200);
      }
    }
  }

  async speakInitialGreeting() {
    if (this.bridge.closed) return;
    console.log("[bridge-sarvam] Play initial greeting...");

    // 1. Play the disclosure line
    await this.queueTextToSpeech(DISCLOSURE_LINE);

    // 2. Play the main greeting line
    const greeting = "नमस्ते! मैं वाणी बोल रही हूँ कज़ूनो से। आपके ब्रांड के लिए वॉइस एजेंट की डेमो कॉल पर बात करने के लिए धन्यवाद। क्या मैं एक ब्रांड ओनर या बिल्डर से बात कर रही हूँ?";
    this.history.push({ role: "assistant", content: greeting });
    await this.queueTextToSpeech(greeting);
  }

  async triggerResponse(text) {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    this.currentTranscript = "";
    if (!text || this.bridge.closed) return;

    console.log(`[bridge-sarvam] User spoke: "${text}"`);
    this.history.push({ role: "user", content: text });

    // Barge-in: Stop any currently playing audio and reset the TTS queue immediately
    this.bridge.onSpeechStarted();
    this.ttsQueue = Promise.resolve();

    try {
      console.log("[bridge-sarvam] Calling xAI Chat Completions REST API...");
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [
            { role: "system", content: DEMO_INSTRUCTIONS },
            ...this.history,
          ],
          max_tokens: 150,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`xAI completions failed: ${errText}`);
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || "";
      console.log(`[bridge-sarvam] LLM Response: "${reply}"`);

      if (reply) {
        this.history.push({ role: "assistant", content: reply });
        await this.queueTextToSpeech(reply);
      }
    } catch (e) {
      console.error("[bridge-sarvam] Error generating LLM response:", e);
    }
  }

  queueTextToSpeech(text) {
    this.ttsQueue = this.ttsQueue.then(async () => {
      if (this.bridge.closed) return;
      console.log(`[bridge-sarvam] Fetching Sarvam TTS for text: "${text}"`);

      try {
        const res = await fetch("https://api.sarvam.ai/text-to-speech", {
          method: "POST",
          headers: {
            "api-subscription-key": SARVAM_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: text,
            target_language_code: "hi-IN",
            speaker: "shubh",
            model: "bulbul:v3",
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Sarvam TTS failed: ${errText}`);
        }

        const data = await res.json();
        const b64Wav = data.audios?.[0];
        if (b64Wav) {
          const wavBuffer = Buffer.from(b64Wav, "base64");
          // Resample/decimate the default 24kHz audio down to 8kHz PCM16 for telephony
          const pcm8 = this.downsample24to8(wavBuffer);
          
          // Calculate audio duration in milliseconds (16000 bytes per second for 8kHz Mono 16-bit PCM)
          const durationMs = (pcm8.length / 16000) * 1000;
          this.speakingEndTime = Math.max(Date.now(), this.speakingEndTime) + durationMs;
          console.log(`[bridge-sarvam] Queued TTS block: duration is ${durationMs}ms`);

          this.bridge.onAudioDelta(pcm8.toString("base64"));
        }
      } catch (e) {
        console.error("[bridge-sarvam] TTS Generation failed:", e);
      }
    });

    return this.ttsQueue;
  }

  downsample24to8(buffer) {
    // Find the 'data' marker in the WAV file to dynamically extract raw PCM bytes
    const dataOffset = buffer.indexOf(Buffer.from("data"));
    const raw = dataOffset !== -1 ? buffer.slice(dataOffset + 8) : buffer.slice(44);
    
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
}
