// lib/sarvam.js
// Modular Adapter for Sarvam AI Voice Agent Integration.
// Orchestrates Saarika (STT WebSocket) ──► Grok LLM (REST) ──► Bulbul (TTS REST).

import WebSocket from "ws";
import { updateCallStatus } from "./store.js";
global.debugLogs = global.debugLogs || [];

function logToFile(msg) {
  try {
    const formatted = `[${new Date().toISOString()}] ${msg}`;
    global.debugLogs.push(formatted);
    if (global.debugLogs.length > 200) {
      global.debugLogs.shift();
    }
  } catch (err) {
    console.error("Log error:", err);
  }
}

function splitIntoSentences(text) {
  const parts = text.split(/([।\n\.?!]+)/);
  const sentences = [];
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (/^[।\n\.?!]+$/.test(part)) {
      current += part;
      sentences.push(current.trim());
      current = "";
    } else {
      current += part;
    }
  }
  if (current.trim()) {
    sentences.push(current.trim());
  }
  return sentences.filter(s => s.length > 0);
}

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
    this.greetingStarted = false; // Prevent multiple greetings from concurrent start events
    this.accumulatedPcm8 = Buffer.alloc(0); // Buffer caller audio chunks to stream as a growing WAV
    this.sendInterval = null;
    this.processingTurn = false; // Flag to prevent duplicate triggerResponse calls during processing
    this.currentTurnToken = {}; // Token to cancel old concurrent TTS fetches on barge-in/new turns
  }

  connect() {
    logToFile("Connecting to Sarvam STT WebSocket with query parameters...");
    this.ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=hi-IN", {
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
      },
    });

    this.ws.on("open", () => {
      logToFile("Sarvam STT WebSocket opened.");

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

      // Start the 500ms sliding transmission loop for user speech chunks
      if (this.sendInterval) clearInterval(this.sendInterval);
      this.sendInterval = setInterval(() => {
        this.sendAccumulatedAudio();
      }, 500);
    });

    this.ws.on("message", (raw) => this.onSarvamMessage(raw));
    this.ws.on("close", (code, reason) => {
      logToFile(`Sarvam STT WS closed. Code: ${code}, Reason: ${reason}`);
      this.ready = false;
      this.ws = null;
      if (this.sendInterval) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }
    });
    this.ws.on("error", (e) => {
      logToFile(`Sarvam STT WS error: ${e.message}`);
      // Reconnection will handle the state recovery during the next caller talk slot
      this.ready = false;
      this.ws = null;
    });
  }

  sendCallerAudio(b64) {
    try {
      const pcm8 = Buffer.from(b64, "base64");
      // Only accumulate user speech if the agent is not currently playing audio (echo suppression)
      if (Date.now() >= this.speakingEndTime) {
        // Automatically reconnect a new WebSocket if it was closed at the end of the previous turn
        if (!this.ws) {
          logToFile("STT WS closed. Reconnecting for new user turn...");
          this.connect();
        }
        this.accumulatedPcm8 = Buffer.concat([this.accumulatedPcm8, pcm8]);
      }
    } catch (err) {
      logToFile(`Failed to process caller audio: ${err.message}`);
    }
  }

  sendAccumulatedAudio() {
    if (this.ws?.readyState === WebSocket.OPEN && this.accumulatedPcm8.length > 0) {
      try {
        const pcm16 = upsample8to16(this.accumulatedPcm8);
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
        logToFile(`Failed to send accumulated audio: ${err.message}`);
      }
    }
  }

  close() {
    this.ws?.close();
    if (this.sendInterval) clearInterval(this.sendInterval);
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

    logToFile(`STT Message: ${JSON.stringify(msg)}`);

    if (msg.type === "data" && msg.data?.transcript) {
      const text = msg.data.transcript.trim();
      if (!text) return;

      // Ignore STT inputs while a turn is already processing
      if (this.processingTurn) {
        return;
      }

      // Ignore STT inputs while the agent is playing audio (echo suppression)
      if (Date.now() < this.speakingEndTime) {
        logToFile(`Echo suppressed transcript: "${text}"`);
        return;
      }

      // Check if the transcript has actually grown in character length
      if (text.length > this.currentTranscript.length) {
        logToFile(`Transcript updated (grew from ${this.currentTranscript.length} to ${text.length}): "${text}"`);
        this.currentTranscript = text;

        // Reset the silence timeout ONLY when new speech content is transcribed and grows in length
        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        this.silenceTimeout = setTimeout(() => {
          logToFile(`Silence detected. Triggering response for: "${this.currentTranscript}"`);
          this.triggerResponse(this.currentTranscript);
        }, 1500);
      }
    }
  }

  async speakInitialGreeting() {
    if (this.greetingStarted) return;
    this.greetingStarted = true;

    if (this.bridge.closed) return;
    logToFile("Playing initial greeting...");

    const turnToken = {};
    this.currentTurnToken = turnToken;

    // Play the disclosure line at the start of the call
    this.history.push({ role: "assistant", content: DISCLOSURE_LINE });
    await this.queueTextToSpeech(DISCLOSURE_LINE, turnToken);
  }

  async triggerResponse(text) {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    this.currentTranscript = "";
    if (!text || this.bridge.closed) return;

    this.processingTurn = true; // Block incoming STT packets while processing the LLM turn
    const turnToken = {};
    this.currentTurnToken = turnToken;

    // Reset accumulated audio for the next user turn
    this.accumulatedPcm8 = Buffer.alloc(0);

    logToFile(`User transcription: "${text}". Triggering LLM response...`);
    this.history.push({ role: "user", content: text });

    // Barge-in: Stop any currently playing audio and reset the TTS queue immediately
    this.bridge.onSpeechStarted();
    this.ttsQueue = Promise.resolve();

    try {
      logToFile("Calling xAI Chat Completions REST API...");
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-latest",
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
      logToFile(`LLM Response: "${reply}"`);

      if (reply) {
        this.history.push({ role: "assistant", content: reply });
        
        // Split reply into sentences to fetch TTS sequentially with zero latency
        const sentences = splitIntoSentences(reply);
        for (const sentence of sentences) {
          this.queueTextToSpeech(sentence, turnToken);
        }
      } else {
        this.processingTurn = false;
      }
    } catch (e) {
      logToFile(`Error generating LLM response: ${e.message}`);
      this.processingTurn = false;
    }
  }

  async fetchTts(text) {
    if (this.bridge.closed) return null;
    logToFile(`Fetching Sarvam TTS for text: "${text}"`);

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
        return this.downsample24to8(wavBuffer);
      }
    } catch (e) {
      logToFile(`TTS Generation failed: ${e.message}`);
    }
    return null;
  }

  queueTextToSpeech(text, turnToken) {
    // Start fetching immediately in parallel (concurrently)
    const fetchPromise = this.fetchTts(text);

    // Chain the playback sequentially in the queue
    this.ttsQueue = this.ttsQueue.then(async () => {
      if (this.bridge.closed) return;

      // Check if turn was interrupted/changed before waiting for fetch
      if (this.currentTurnToken !== turnToken) {
        logToFile(`Discarding playback for "${text}" (turn token changed before fetch)`);
        return;
      }

      const pcm8 = await fetchPromise;
      if (pcm8) {
        // Double check after fetch completes
        if (this.currentTurnToken !== turnToken) {
          logToFile(`Discarding playback for "${text}" (turn token changed after fetch)`);
          return;
        }

        const durationMs = (pcm8.length / 16000) * 1000;
        this.speakingEndTime = Math.max(Date.now(), this.speakingEndTime) + durationMs;
        logToFile(`Queued TTS block: duration is ${durationMs}ms`);

        this.processingTurn = false; // Turn processing finished, ready for next user speech
        this.bridge.onAudioDelta(pcm8.toString("base64"));
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
