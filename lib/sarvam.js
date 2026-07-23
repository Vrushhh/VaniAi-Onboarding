// lib/sarvam.js
// Modular Adapter for Sarvam AI Voice Agent Integration.
// Orchestrates Saarika (STT WebSocket) ──► Sarvam LLM (Streaming REST) ──► Bulbul (TTS REST).

import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { updateCallStatus, addTranscriptEntry } from "./store.js";
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
  "Hi! I'm Vaani from KIIZUNO. I saw you just requested a demo call on our website. Am I speaking with a D2C brand owner or shopify business owner?";

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

const HINDI_EXPLICIT = /(?:करते हो|करते हैं|करते हु|करते हू|करते थे|करती हैं|करती हो|क्या करते|क्या करती|क्या करते हो|क्या क्या करते|क्या क्या करते हो|क्या करते हैं|बेचते हैं|बेचती हैं|आता है|आती है|आते हैं|देते हैं|लेते हैं|होता है|होती है|होते हैं|बात कर|सकती हूँ|सकता हूँ)/i;
const MARATHI_MARKERS = /(?:आहे|नाही|करू|शकत|तुम्ही|तुम्हाला|मला|काय|मध्ये|होतो|होती|होते|आम्ही|आम्हाला|तुमच|तुमची|तुमचे|आमच|आमची|आमचे|करतात|विकतो|विकते|विकतात|येतो|येते|येतात|दिवसात|दिवसाला|करायचं|करायचे|करणार|आपण|सांगा|बोला|पाहिजे|पाहिजेल|छान|काही|कसं|कशी|कसा|कसे|ऐका|नका|चालेल|होणार|केलं)/i;
const MARATHI_LATIN = /\b(?:aika|tumhi|tumhala|viktat|vikto|vikte|kasa|kashi|ahe|bhau|mhanje|nakos|shakata|mala|kiti|sangin|hoina|amhala|amhi|yetat|yeto|karaych|karayche|aapan|apna|divsat|roz|chalel|naka|pahije)\b/i;
const HINDI_LATIN = /\b(?:humko|hum|aata|aati|aate|hai|hain|kya|batao|boliye|bolo|haan|ji|hoon|hu|chahiye|kitna|kaise|sakte|dena|karo|bhi|mein|rooz|din|rahe|kuch|dukaan)\b/i;

function detectTtsLanguage(text) {
  if (!text) return "en-IN";

  // 1. Devanagari script (Hindi vs Marathi)
  if (/[\u0900-\u097F]/.test(text)) {
    if (HINDI_EXPLICIT.test(text)) return "hi-IN";
    if (MARATHI_MARKERS.test(text)) return "mr-IN";
    return "hi-IN";
  }

  // 2. Other explicit Indic scripts
  if (/[\u0980-\u09FF]/.test(text)) return "bn-IN"; // Bengali
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN"; // Gujarati
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta-IN"; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return "te-IN"; // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN"; // Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml-IN"; // Malayalam
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa-IN"; // Punjabi
  if (/[\u0B00-\u0B7F]/.test(text)) return "od-IN"; // Odia

  // 3. Transliterated Latin script checks
  if (MARATHI_LATIN.test(text)) return "mr-IN";
  if (HINDI_LATIN.test(text)) return "hi-IN";

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
You are Vaani, a warm, high-energy, empathetic sales representative for KZUNO (https://kzuno.in). Your goal is to understand the caller's D2C business, discover their operational challenges, and explain how KZUNO's voice AI agents automate their customer operations.

## PERSONA & VOICE STYLE
- Name: Vaani | Company: KZUNO (Pronounced "Kee-zoo-no")
- Tone: Warm, energetic, engaging, empathetic, highly human-like, consultative.
- Conversational Warmth: Use natural fillers & exclamations ("Acha!", "अरे वाह!", "नक्कीच!", "Got it", "Definitely"). Never monologue or sound like a script reader.

## MANDATORY MULTILINGUAL & CODE-SWITCHING RULE
- Reply in the EXACT language spoken by the caller on that turn (English, Hindi/Hinglish, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Odia).
- If the caller switches languages, switch with them instantly! (Use Devanagari script for Hindi/Marathi, Gujarati script for Gujarati, etc.)

## CONSULTATIVE CONVERSATION FLOW
1. GREETING & DISCOVERY:
   - Initial greeting is played. Acknowledge warmly in their language and ask: "What is your brand name and what category of products do you sell?"
2. UNDERSTANDING BOTTLENECKS:
   - Listen to their category warmly. Ask about their current operations: "Awesome! What is your biggest operational headache right now — high RTO on COD orders, missed customer support calls, or abandoned carts?"
3. TAILORED SOLUTION FIT:
   - Match KZUNO's solution to their specific bottleneck:
     - COD RTO: Explain how KZUNO calls customers in regional languages instantly after checkout to confirm addresses, cutting RTO by up to 25%.
     - Customer Support: Highlight 24/7 automated support calls in 10+ Indian regional languages.
     - Abandoned Carts: Recovery calls and instant WhatsApp follow-ups.
4. NATURAL NEXT STEP:
   - Ask: "How do you currently handle these customer calls, and would you like to see how KZUNO integrates with your store?"

## VOICE GUARDRAILS & COMMON OBJECTIONS
- Response Limit: 1-2 short sentences max per turn (vital for rapid voice back-and-forth).
- Zero Markdown: NEVER use asterisks, list bullets, hashes, or bold text.
- AI Identity Check ("Are you a real human?"): "I'm Vaani, KZUNO's AI sales representative! I sound just like a real person, which is exactly how your customers will experience your automated calls."
- Integrations: Connects seamlessly with Shopify, WooCommerce, Shiprocket, Unicommerce, and custom REST APIs.
- Pricing: Free starter tier and flexible volume plans starting at just 2 rupees per call.
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
      if (!this.ws) {
        logToFile("STT WS closed. Reconnecting for new user turn...");
        this.connect();
      }
      this.accumulatedPcm8 = Buffer.concat([this.accumulatedPcm8, pcm8]);
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

      if (msg.data.language_code && msg.data.language_code !== "unknown") {
        this.currentSttLangCode = msg.data.language_code;
      }

      // Instant barge-in detection during agent speech
      if (Date.now() < this.speakingEndTime) {
        logToFile(`Barge-in detected: "${text}". Cancelling playback immediately.`);
        this.bridge.onSpeechStarted();
        this.ttsQueue = Promise.resolve();
        this.currentTurnToken = {};
        this.speakingEndTime = 0;
        this.processingTurn = false;
      }

      if (this.processingTurn) return;

      // Only process growing transcripts
      if (text.length > this.currentTranscript.length) {
        logToFile(`Transcript updated (${this.currentTranscript.length} → ${text.length}): "${text}" [ASR Lang: ${msg.data.language_code || 'unknown'}]`);
        this.currentTranscript = text;

        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        this.silenceTimeout = setTimeout(() => {
          logToFile(`Silence detected. Triggering response for: "${this.currentTranscript}"`);
          this.triggerResponse(this.currentTranscript);
        }, 350); // 350ms silence timeout for ultra-fast response
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
    if (this.bridge.demoId) {
      addTranscriptEntry(this.bridge.demoId, "agent", DISCLOSURE_LINE, { lang: "en-IN", greeting: true });
    }

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

    // Use hybrid language classifier (HINDI_EXPLICIT + MARATHI_MARKERS + Indic script rules)
    const detectedLang = detectTtsLanguage(text);

    if (this.bridge.demoId) {
      addTranscriptEntry(this.bridge.demoId, "user", text, { lang: detectedLang });
    }

    // Barge-in: clear any playing audio
    this.bridge.onSpeechStarted();
    this.ttsQueue = Promise.resolve();

    const LANG_NAME_MAP = {
      "hi-IN": "HINDI (in Devanagari script)",
      "mr-IN": "MARATHI (in Devanagari script)",
      "gu-IN": "GUJARATI (in Gujarati script)",
      "ta-IN": "TAMIL (in Tamil script)",
      "te-IN": "TELUGU (in Telugu script)",
      "kn-IN": "KANNADA (in Kannada script)",
      "ml-IN": "MALAYALAM (in Malayalam script)",
      "bn-IN": "BENGALI (in Bengali script)",
      "pa-IN": "PUNJABI (in Gurmukhi script)",
      "od-IN": "ODIA (in Odia script)",
      "en-IN": "ENGLISH / HINGLISH",
    };

    const targetLangName = LANG_NAME_MAP[detectedLang] || "ENGLISH / HINGLISH";
    const langInstructionText = `CRITICAL MANDATE: The caller just spoke in ${targetLangName}. YOU MUST RESPOND ENTIRELY IN ${targetLangName}. DO NOT USE ANY OTHER LANGUAGE!`;

    logToFile(`Detected language: ${detectedLang} (${langInstructionText})`);

    const messages = [
      { role: "system", content: DEMO_INSTRUCTIONS },
      ...this.history,
      { role: "system", content: langInstructionText },
    ];

    try {
      const useXai = Boolean(process.env.XAI_API_KEY);
      const apiUrl = useXai
        ? "https://api.x.ai/v1/chat/completions"
        : "https://api.sarvam.ai/v1/chat/completions";

      const apiHeaders = useXai
        ? {
          "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        }
        : {
          "api-subscription-key": SARVAM_API_KEY,
          "Content-Type": "application/json",
        };

      const apiModel = useXai ? "grok-4.20-0309-non-reasoning" : "sarvam-30b";

      logToFile(`Calling LLM Chat Completions (${apiModel} streaming)...`);
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: apiModel,
          messages,
          max_tokens: 80,
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

            // Check if we have a complete natural sentence in the buffer
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
          } catch { }
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
        if (this.bridge.demoId) {
          addTranscriptEntry(this.bridge.demoId, "agent", fullContent.trim(), { lang: detectTtsLanguage(fullContent.trim()) });
        }
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
          speaker: "ritu",
          model: "bulbul:v3",
          pace: 1.0,
          enable_preprocessing: true,
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

      // Weighted 3-point anti-aliasing low-pass filter (center sample s1 gets 50% weight for consonant sharpness)
      const weighted = Math.round((s0 * 0.25) + (s1 * 0.50) + (s2 * 0.25));
      // Clean 0.95x gain scaling to prevent any digital clipping distortion
      const scaled = Math.round(weighted * 0.95);
      const clamped = Math.max(-32768, Math.min(32767, scaled));

      downsampled.writeInt16LE(clamped, writeOffset);
      writeOffset += 2;
    }
    return downsampled;
  }
}
