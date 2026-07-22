// lib/sarvam.js
// Modular Adapter for Sarvam AI Voice Agent Integration.
// Orchestrates Saarika (STT WebSocket) ──► Sarvam LLM (Streaming REST) ──► Bulbul (TTS REST).

import WebSocket from "ws";
import fs from "fs";
import path from "path";
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

// Pre-load the cached disclosure greeting audio
let cachedDisclosureB64 = "";
try {
  const base64Path = path.resolve("./disclosure.base64");
  if (fs.existsSync(base64Path)) {
    cachedDisclosureB64 = fs.readFileSync(base64Path, "utf8").trim();
  }
} catch (err) {
  console.error("Failed to load cached disclosure audio:", err);
}

/* ── Sentence splitting ── */
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

// Break a long sentence into sub-sentences at commas if it exceeds maxLen chars
function breakLongSentence(sentence, maxLen = 80) {
  if (sentence.length <= maxLen) return [sentence];
  const parts = sentence.split(/,\s*/);
  const result = [];
  let buf = "";
  for (const part of parts) {
    if (buf && (buf + ", " + part).length > maxLen) {
      result.push(buf);
      buf = part;
    } else {
      buf = buf ? buf + ", " + part : part;
    }
  }
  if (buf) result.push(buf);
  return result.length > 0 ? result : [sentence];
}

const DISCLOSURE_LINE =
  "Hi! I'm Vaani from KZUNO. I saw you just requested a demo call on our website. Am I speaking with a D2C brand owner or shopify business owner?";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";

/* ── WAV helpers for STT ── */
function getWavHeader(numBytes, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + numBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
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

/* ── Language detection for TTS ── */
const LANG_MAP = {
  "hi-IN": /[\u0900-\u097F]/, // Devanagari (Hindi, Marathi)
  "mr-IN": /[\u0900-\u097F]/, // Marathi uses same script — detected by keywords
  "bn-IN": /[\u0980-\u09FF]/, // Bengali
  "ta-IN": /[\u0B80-\u0BFF]/, // Tamil
  "te-IN": /[\u0C00-\u0C7F]/, // Telugu
  "kn-IN": /[\u0C80-\u0CFF]/, // Kannada
  "ml-IN": /[\u0D00-\u0D7F]/, // Malayalam
  "gu-IN": /[\u0A80-\u0AFF]/, // Gujarati
  "pa-IN": /[\u0A00-\u0A7F]/, // Punjabi (Gurmukhi)
  "od-IN": /[\u0B00-\u0B7F]/, // Odia
};

// Marathi-specific keywords for disambiguating from Hindi (both Devanagari)
const MARATHI_MARKERS = /(?:आहे|करू|शकत|तुम्ही|मला|काय|मध्ये|नाही|होतो|होते|आम्ही|तुमच|आमच|करतो|करते)/;

function detectTtsLanguage(text) {
  // Check non-Devanagari Indic scripts first
  for (const [lang, regex] of Object.entries(LANG_MAP)) {
    if (lang === "hi-IN" || lang === "mr-IN") continue;
    if (regex.test(text)) return lang;
  }
  // Devanagari: check for Marathi markers vs Hindi
  if (/[\u0900-\u097F]/.test(text)) {
    if (MARATHI_MARKERS.test(text)) return "mr-IN";
    return "hi-IN";
  }
  // Default to en-IN for English/Latin script
  return "en-IN";
}

function isSpeakable(text) {
  if (!text || text.length < 2) return false;
  const cleaned = text.replace(/\(.*?\)/g, "").replace(/[*_#"`']/g, "").trim();
  const chars = cleaned.replace(/[^a-zA-Z0-9\u0900-\u0D7F]/g, "");
  return chars.length >= 2;
}

/* ── System prompt ── */
const DEMO_INSTRUCTIONS = `
You are Vaani, a warm, professional, and helpful female sales representative for KZUNO (https://kzuno.in). Your goal is to qualify callers, discover details about their business, and explain how KZUNO's voice AI agents help D2C brands automate customer operations.

## PERSONA & TONE
- Name: Vaani
- Company: KZUNO (Pronounced "Ka-zoo-no")
- Tone: High energy, warm, professional, engaging, and friendly female voice representative.
- Language & Multilingual Support: You are a fully multilingual Indian bot. You can understand and converse in all major regional Indian languages including English, Hindi, Hinglish, Assamese, Odia, Bengali, Marathi, Gujarati, Punjabi, Malayalam, Tamil, Telugu, and Kannada.
- Speech pattern: Colloquial, modern Indian sales representative. Use natural conversational fillers like "Got it", "Oh, nice", "Definitely".

## MANDATORY LANGUAGE SWITCHING RULE (CRITICAL)
- Match the caller's language IMMEDIATELY on every turn.
- If the user speaks in Hindi or Hinglish (e.g. "हाँ बोलिए", "हिंदी में बताओ", "ब्रांड ओनर हूँ"), YOU MUST IMMEDIATELY REPLY IN HINDI or HINGLISH.
- If the user speaks in Marathi, Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam, etc., YOU MUST IMMEDIATELY REPLY IN THAT SAME LANGUAGE.
- NEVER reply in English when the user speaks in Hindi or a regional Indian language.

## IMPORTANT CONVERSATION STYLE (CRITICAL FOR VOICE)
1. Keep responses extremely short (1-2 sentences max per turn). Telephony conversations require rapid back-and-forth; do not monologue.
2. If the user interrupts or starts talking while you are speaking, stop immediately, listen, and answer their point directly.
3. Never use markdown formatting (like asterisks, list bullets, or hashes) in your output, as it confuses the text-to-speech engine. Spell out symbols or URLs clearly (e.g. say "console dot kzuno dot in").

## CONVERSATION FLOW
1. GREETING:
   - "Hi! I'm Vaani from KZUNO. I saw you just requested a demo call on our website. Am I speaking with a D2C brand owner or shopify business owner?"
2. DISCOVERY & QUALIFICATION:
   - Once they confirm, ask about their business: "Awesome! What is the name of your brand, and what category of products do you sell?"
   - Follow up by asking about their volume: "Oh, nice! Roughly how many orders or customer inquiries do you handle on a daily basis?"
3. PITCHING VALUE:
   - Tailor your pitch based on their category:
     - If they have high COD (Cash on Delivery) orders: Explain how KZUNO calls customers in regional languages (Hindi, Tamil, etc.) within seconds of order placement to confirm addresses, reducing Return-to-Origin (RTO) rates by up to 25%.
     - If they are a premium brand: Explain how KZUNO recovers abandoned carts and handles customer feedback instantly.
4. CALL TO ACTION (CTA):
   - Direct them to start free: "To build and test an agent just like me, you can register a free account at console dot kzuno dot in in under five minutes. Would you like me to send you the sign-up link?"
   - If they are a high-volume enterprise (e.g. >100 orders/day): Offer to schedule a 15-minute call with the founders at calendly dot com slash kzuno.

## GUARDRAILS
- Stay strictly in character as Vaani from KZUNO.
- If asked technical questions about how it works, explain that KZUNO connects directly with Shopify, WooCommerce, and shipping gateways via APIs to automate calls instantly.
- If asked about pricing, mention that we have a free starter tier and custom plans based on call volume starting as low as 2 rupees per call.
`.trim();

/* ── Main adapter ── */
export class SarvamSessionAdapter {
  constructor(bridge) {
    this.bridge = bridge;
    this.ws = null;
    this.ready = false;
    this.history = [];
    this.ttsQueue = Promise.resolve();
    this.silenceTimeout = null;
    this.currentTranscript = "";
    this.speakingEndTime = 0;
    this.greetingStarted = false;
    this.accumulatedPcm8 = Buffer.alloc(0);
    this.sendInterval = null;
    this.processingTurn = false;
    this.currentTurnToken = {};
  }

  connect() {
    logToFile("Connecting to Sarvam STT WebSocket...");
    // Use language_code=unknown for multi-language auto-detection
    this.ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=unknown", {
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

      // Start greeting if stream is already active
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
      this.ready = false;
      this.ws = null;
    });
  }

  sendCallerAudio(b64) {
    try {
      const pcm8 = Buffer.from(b64, "base64");
      if (Date.now() >= this.speakingEndTime) {
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

  /* ── STT message handler with barge-in ── */
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

      if (this.processingTurn) return;

      // Barge-in detection during agent speech
      if (Date.now() < this.speakingEndTime) {
        if (text.length > 2 && text.length > this.currentTranscript.length) {
          logToFile(`Barge-in detected: "${text}". Cancelling playback.`);
          this.bridge.onSpeechStarted();
          this.ttsQueue = Promise.resolve();
          this.currentTurnToken = {};
          this.speakingEndTime = 0;
        } else {
          logToFile(`Echo suppressed: "${text}"`);
          return;
        }
      }

      // Only process growing transcripts
      if (text.length > this.currentTranscript.length) {
        logToFile(`Transcript updated (${this.currentTranscript.length} → ${text.length}): "${text}"`);
        this.currentTranscript = text;

        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        this.silenceTimeout = setTimeout(() => {
          logToFile(`Silence detected. Triggering response for: "${this.currentTranscript}"`);
          this.triggerResponse(this.currentTranscript);
        }, 750); // 750ms silence timeout for fast, natural response
      }
    }
  }

  /* ── Initial greeting ── */
  async speakInitialGreeting() {
    if (this.greetingStarted) return;
    this.greetingStarted = true;
    if (this.bridge.closed) return;
    logToFile("Playing initial greeting...");

    const turnToken = {};
    this.currentTurnToken = turnToken;
    this.history.push({ role: "assistant", content: DISCLOSURE_LINE });

    if (cachedDisclosureB64) {
      logToFile("Playing disclosure greeting instantly from local cache.");
      this.ttsQueue = this.ttsQueue.then(async () => {
        if (this.bridge.closed) return;
        if (this.currentTurnToken !== turnToken) return;
        const pcmBuffer = Buffer.from(cachedDisclosureB64, "base64");
        const durationMs = (pcmBuffer.length / 16000) * 1000;
        this.speakingEndTime = Math.max(Date.now(), this.speakingEndTime) + durationMs;
        logToFile(`Queued cached disclosure block: duration is ${durationMs}ms`);
        this.processingTurn = false;
        this.bridge.onAudioDelta(cachedDisclosureB64);
      });
    } else {
      await this.queueTextToSpeech(DISCLOSURE_LINE, turnToken, "en-IN");
    }
  }

  /* ── Streaming LLM response with incremental TTS ── */
  async triggerResponse(text) {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    this.currentTranscript = "";
    if (!text || this.bridge.closed) return;

    this.processingTurn = true;
    const turnToken = {};
    this.currentTurnToken = turnToken;
    this.accumulatedPcm8 = Buffer.alloc(0);

    logToFile(`User transcription: "${text}". Triggering LLM response...`);
    this.history.push({ role: "user", content: text });

    // Barge-in: clear any playing audio
    this.bridge.onSpeechStarted();
    this.ttsQueue = Promise.resolve();

    try {
      logToFile("Calling Sarvam Chat Completions (streaming)...");
      const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sarvam-30b",
          messages: [
            { role: "system", content: DEMO_INSTRUCTIONS },
            ...this.history,
          ],
          max_tokens: 80,
          reasoning_effort: null,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam completions failed: ${errText}`);
      }

      // Process streaming response — fire TTS as soon as each sentence completes
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let sentenceBuffer = "";
      let sentenceCount = 0;
      const MAX_SENTENCES = 4;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.currentTurnToken !== turnToken) break; // Turn was cancelled

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (!delta) continue;

            fullContent += delta;
            sentenceBuffer += delta;

            // Check if we have a complete sentence or clause in the buffer
            const sentenceEndMatch = sentenceBuffer.match(/^(.*?[।\.?!\n]+)(.*)/s);
            if (sentenceEndMatch && sentenceCount < MAX_SENTENCES) {
              const completedSentence = sentenceEndMatch[1].trim();
              sentenceBuffer = sentenceEndMatch[2];

              const cleaned = completedSentence
                .replace(/\(.*?\)/g, "")
                .replace(/[*_#"`']/g, "")
                .trim();

              if (isSpeakable(cleaned)) {
                const lang = detectTtsLanguage(cleaned);
                const subSentences = breakLongSentence(cleaned, 70);
                for (const sub of subSentences) {
                  if (sentenceCount >= MAX_SENTENCES) break;
                  logToFile(`Streaming TTS for: "${sub}" [${lang}]`);
                  this.queueTextToSpeech(sub, turnToken, lang);
                  sentenceCount++;
                }
              }
            }
          } catch {}
        }
      }

      // Handle any remaining text in the buffer
      if (sentenceBuffer.trim() && sentenceCount < MAX_SENTENCES && this.currentTurnToken === turnToken) {
        const cleaned = sentenceBuffer.trim()
          .replace(/\(.*?\)/g, "")
          .replace(/[*_#"`']/g, "")
          .trim();

        if (isSpeakable(cleaned)) {
          const lang = detectTtsLanguage(cleaned);
          const subSentences = breakLongSentence(cleaned, 70);
          for (const sub of subSentences) {
            if (sentenceCount >= MAX_SENTENCES) break;
            logToFile(`Streaming TTS (remainder): "${sub}" [${lang}]`);
            this.queueTextToSpeech(sub, turnToken, lang);
            sentenceCount++;
          }
        }
      }

      logToFile(`LLM Response (full): "${fullContent.trim()}"`);

      if (fullContent.trim()) {
        this.history.push({ role: "assistant", content: fullContent.trim() });
      }
      if (sentenceCount === 0) {
        this.processingTurn = false;
      }
    } catch (e) {
      logToFile(`Error generating LLM response: ${e.message}`);
      this.processingTurn = false;
    }
  }

  /* ── TTS with dynamic language ── */
  async fetchTts(text, lang = "hi-IN") {
    if (this.bridge.closed) return null;
    logToFile(`Fetching Sarvam TTS [${lang}]: "${text}"`);

    try {
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          target_language_code: lang,
          speaker: "kavya",
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

  queueTextToSpeech(text, turnToken, lang = "hi-IN") {
    // Start fetching immediately in parallel
    const fetchPromise = this.fetchTts(text, lang);

    // Chain playback sequentially
    this.ttsQueue = this.ttsQueue.then(async () => {
      if (this.bridge.closed) return;
      if (this.currentTurnToken !== turnToken) return;

      const pcm8 = await fetchPromise;
      if (pcm8) {
        if (this.currentTurnToken !== turnToken) return;
        const durationMs = (pcm8.length / 16000) * 1000;
        this.speakingEndTime = Math.max(Date.now(), this.speakingEndTime) + durationMs;
        logToFile(`Queued TTS block: duration is ${durationMs}ms`);
        this.processingTurn = false;
        this.bridge.onAudioDelta(pcm8.toString("base64"));
      }
    });

    return this.ttsQueue;
  }

  downsample24to8(buffer) {
    const dataOffset = buffer.indexOf(Buffer.from("data"));
    const raw = dataOffset !== -1 ? buffer.slice(dataOffset + 8) : buffer.slice(44);
    const totalSamples = Math.floor(raw.length / 2);
    const outSamples = Math.floor(totalSamples / 3);
    const downsampled = Buffer.alloc(outSamples * 2);
    
    let writeOffset = 0;
    for (let i = 0; i < outSamples * 3; i += 3) {
      const s0 = raw.readInt16LE(i * 2);
      const s1 = (i + 1 < totalSamples) ? raw.readInt16LE((i + 1) * 2) : s0;
      const s2 = (i + 2 < totalSamples) ? raw.readInt16LE((i + 2) * 2) : s1;
      
      // 3-sample average low-pass filter to eliminate high-frequency aliasing noise
      const avg = Math.round((s0 + s1 + s2) / 3);
      const clamped = Math.max(-32768, Math.min(32767, avg));
      downsampled.writeInt16LE(clamped, writeOffset);
      writeOffset += 2;
    }
    return downsampled;
  }
}
