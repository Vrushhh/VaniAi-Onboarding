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
// Uses 150 chars threshold to avoid over-fragmenting natural speech cadence
function breakLongSentence(sentence, maxLen = 150) {
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

// 4ms of silence at 8kHz mono 16-bit = 32 samples = 64 bytes — used as crossfade tail between TTS blocks
const SILENT_TAIL_PCM = Buffer.alloc(64, 0);

const DISCLOSURE_LINE =
  "Hi! I'm Vaani from Keezoono. I saw you just requested a demo call on our website. Am I speaking with a D2C brand owner or shopify business owner?";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "sk_3s02bv7w_4TYnAT6g6fXZHFabbzeScGEj";
export const SARVAM_AGENT_ID = process.env.SARVAM_AGENT_ID || "Kzuno-Agent-a7d3db0c-63be";

export function getSarvamAgentConfig() {
  return {
    agent_id: SARVAM_AGENT_ID,
    platform: "Sarvam Samvaad (Voice Agents)",
    dashboard_url: `https://indus.sarvam.ai/samvaad/build/update-agent/${SARVAM_AGENT_ID}`,
    supported_languages: [
      "en-IN", "hi-IN", "mr-IN", "ta-IN", "te-IN",
      "kn-IN", "ml-IN", "bn-IN", "gu-IN", "pa-IN"
    ],
    tools_webhook: "/api/sarvam/tools/execute",
    status: "active",
  };
}

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

/* ── Pre-ASR Telephony Noise Suppression (80Hz High-Pass + Soft-Knee Noise Gate) ── */
function applyPreAsrNoiseSuppression(pcm8Buffer) {
  if (!pcm8Buffer || pcm8Buffer.length < 2) return pcm8Buffer;

  const numSamples = Math.floor(pcm8Buffer.length / 2);
  const clean = Buffer.alloc(numSamples * 2);

  let prevIn = 0;
  let prevOut = 0;
  const alpha = 0.94; // 80Hz cutoff at Fs=8000Hz

  const NOISE_FLOOR_THRESH = 350; // Attenuation threshold for static/background noise (~-39dB)
  const GAIN_ATTENUATION = 0.25;  // Suppress traffic/fan/room noise to 25% during silent pauses

  for (let i = 0; i < numSamples; i++) {
    const rawSample = pcm8Buffer.readInt16LE(i * 2);

    // 1. High-Pass Filter: remove AC hum & wind rumble (<80Hz)
    const filteredSample = alpha * (prevOut + rawSample - prevIn);
    prevIn = rawSample;
    prevOut = filteredSample;

    // 2. Soft-knee Spectral Noise Gate: attenuate static/hiss when below speech threshold
    const absVal = Math.abs(filteredSample);
    let finalSample = filteredSample;
    if (absVal < NOISE_FLOOR_THRESH) {
      finalSample = filteredSample * GAIN_ATTENUATION;
    }

    const clamped = Math.max(-32768, Math.min(32767, Math.round(finalSample)));
    clean.writeInt16LE(clamped, i * 2);
  }

  return clean;
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

## 🎭 EXPRESSIVE PUNCTUATION & HUMAN VOICE TONALITY MANDATE
- Name: Vaani | Company: KZUNO (ALWAYS pronounced "Kee Zoo No". NEVER pronounce as Kazuno, Kizuno, K-Z-U-N-O, or Kuh-zuno!)
- Tone: Warm, energetic, engaging, empathetic, highly human-like, consultative.
- EXPRESSIVE PUNCTUATION: Use rich punctuation in EVERY response to guide the neural TTS voice with natural human feelings, pitch inflections, and conversational rhythm:
  - Use exclamations (!) for warm, upbeat energy: "Oh, wonderful!", "जी बिल्कुल!", "छान!"
  - Use em-dashes (—) or commas (,) for natural human breathing pauses between thoughts: "Well—that makes total sense!", "अच्छा—बताइए!"
  - Use question marks (?) for friendly, curious vocal pitch inflections at sentence ends.
- VOICE FEELINGS & EMPATHY:
  - Express genuine empathy when they share operational headaches: "Oh, I completely understand—high RTO on COD orders can eat right into your profit margins!"
  - Express excitement when they describe their brand: "Ah, Organic Glow—what a fantastic brand name!"
- Conversational Warmth: Use natural fillers & exclamations matched strictly to the turn's language:
  - For Hindi turns: "जी बिल्कुल!", "बहुत बढ़िया!", "समझ गई!", "अच्छा—बताइए!", "सही बात है!" (NEVER use Marathi words like "नक्कीच" in Hindi!).
  - For Marathi turns: "हो नक्कीच!", "छान!", "समजलं मला!", "बरोबर!"
  - For Tamil turns: ONLY use Tamil. NEVER mix Tamil with Hindi or Marathi.
  - For Telugu turns: ONLY use Telugu. NEVER mix Telugu with other languages.
  - For Kannada turns: ONLY use Kannada. NEVER mix Kannada with other languages.
  - For Malayalam turns: ONLY use Malayalam. NEVER mix Malayalam with other languages.
  - For English/Hinglish turns: "Makes total sense!", "Oh, wonderful!", "Understood!", "Ah, interesting!", "Right—absolutely!", "Definitely!"
  - ⚠️ STRICT REPETITIONS BAN: NEVER start responses with "Got it!", "Got it", "Got it thanks", "अरे वाह!", or "अरे वाह". Vary your opening words naturally every single turn, or jump straight into your response without repetitive filler prefix.
  - ⚠️ NO ABBREVIATED WORDS: NEVER say "Under!" or "Under". ALWAYS write out complete words like "Understood!" or "Got it!".

## MANDATORY MULTILINGUAL & CODE-SWITCHING RULE — STRICTLY ENFORCED
- YOU MUST RESPOND ENTIRELY IN THE SAME LANGUAGE AS THE CALLER'S MOST RECENT MESSAGE.
- If the caller speaks Tamil → respond 100% in Tamil.
- If the caller speaks Telugu → respond 100% in Telugu.
- If the caller speaks Kannada → respond 100% in Kannada.
- If the caller speaks Malayalam → respond 100% in Malayalam.
- If the caller speaks Hindi/Hinglish → respond 100% in Hindi.
- If the caller speaks Marathi → respond 100% in Marathi.
- NEVER mix scripts. NEVER insert a random language word into another language's response.
- If the caller switches languages, switch with them instantly.

## ⚠️ CRITICAL MEMORY & CONTEXT RULES — MANDATORY
- NEVER ask a question that has already been answered in this conversation.
- NEVER ask for the brand name if it has already been mentioned.
- NEVER ask what the caller sells if they already told you.
- NEVER ask about their pain points if they already described them.
- Before asking ANY question, scan ALL previous messages in the conversation history.
- If the caller already gave you information, ACKNOWLEDGE it and move forward.
- Example: If caller said "my brand is XYZ and I sell skincare" → do NOT ask "what is your brand name?" again.
- Treat the conversation as a continuous memory. NEVER reset or forget prior context.

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
    this.lastTriggeredTranscript = ""; // dedup guard against repeat triggers
    this.speakingEndTime = 0;
    this.greetingStarted = false;
    this.accumulatedPcm8 = Buffer.alloc(0);
    this.sendInterval = null;
    this.processingTurn = false;
    this.currentTurnToken = {};
    this.currentTurnLang = "en-IN"; // language locked per-turn

    this.agentId = SARVAM_AGENT_ID;
    this.conversationState = {
      brandName: null,
      productCategory: null,
      painPoint: null,
    };
    this.knownFacts = this.conversationState;

    // ── Language persistence: confirmed language survives across turns ──
    // Only updated when ASR confidently reports a language on a multi-word utterance
    this.confirmedLang = null;
  }

  connect() {
    logToFile("Connecting to Sarvam STT WebSocket [language_code=en-IN]...");
    // Use language_code=en-IN for high-precision Indian English speech recognition & zero random language hallucinations
    this.ws = new WebSocket("wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language_code=en-IN", {
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
      const rawPcm8 = Buffer.from(b64, "base64");
      // Pre-ASR Telephony Noise Suppression Filter: removes background hiss/traffic noise prior to ASR
      const cleanPcm8 = applyPreAsrNoiseSuppression(rawPcm8);
      if (!this.ws) {
        logToFile("STT WS closed. Reconnecting for new user turn...");
        this.connect();
      }
      this.accumulatedPcm8 = Buffer.concat([this.accumulatedPcm8, cleanPcm8]);
    } catch (err) {
      logToFile(`Failed to process caller audio: ${err.message}`);
    }
  }

  sendAccumulatedAudio() {
    if (this.ws?.readyState === WebSocket.OPEN && this.accumulatedPcm8.length > 0) {
      try {
        const chunkPcm8 = this.accumulatedPcm8;
        this.accumulatedPcm8 = Buffer.alloc(0); // Reset buffer immediately to send discrete 100ms packets and prevent payload bloat

        const pcm16 = upsample8to16(chunkPcm8);
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

      // ── Instant Barge-in / Interruption Handling ──
      // Only trigger barge-in if agent is actively playing audio on the phone line (speakingEndTime > Date.now())
      if (Date.now() < this.speakingEndTime) {
        const isNewSpeech = text.length > this.lastTriggeredTranscript.length + 2;
        if (isNewSpeech && isSpeakable(text)) {
          logToFile(`Barge-in / User Interruption detected: "${text}". Agent stepping back immediately.`);
          this.bridge.onSpeechStarted();
          this.ttsQueue = Promise.resolve();
          this.currentTurnToken = {};
          this.speakingEndTime = 0;
          this.processingTurn = false;
        }
      }

      if (this.processingTurn) return;

      // Only process growing transcripts
      if (text.length > this.currentTranscript.length) {
        logToFile(`Transcript updated (${this.currentTranscript.length} → ${text.length}): "${text}" [ASR Lang: ${msg.data.language_code || 'unknown'}]`);
        this.currentTranscript = text;

        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        this.silenceTimeout = setTimeout(() => {
          const finalText = this.currentTranscript.trim();
          // Dedup guard: skip if same transcript was already triggered
          if (!finalText || finalText === this.lastTriggeredTranscript) {
            logToFile(`Skipping duplicate/empty transcript: "${finalText}"`);
            this.currentTranscript = "";
            return;
          }
          logToFile(`Silence detected. Triggering response for: "${finalText}"`);
          this.lastTriggeredTranscript = finalText;
          this.triggerResponse(finalText);
        }, 500); // 500ms optimal silence timeout for accurate turn handoff
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
    const activeCallId = this.bridge.demoId || this.bridge.callId || "live-call";
    addTranscriptEntry(activeCallId, "agent", DISCLOSURE_LINE, { lang: "en-IN", greeting: true });

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

  /* ── Extract known facts from user utterance for context memory ── */
  extractKnownFacts(text) {
    if (!text) return;
    const lowerText = text.toLowerCase().trim();

    // 1. Explicit Brand Name extraction regex
    const brandMatch = text.match(/(?:my brand(?:\s+name)?\s+(?:is|called|named)|brand(?:\s+name)?\s+(?:is|called|named)|we\s+are|i\s+run|store(?:\s+name)?\s+(?:is|called)|हमारी\s+ब्रांड\s+है|हमारा\s+ब्रांड|ब्रांड\s+का\s+नाम|माझा\s+ब्रांड|अहे)\s+([a-zA-Z0-9\s\-\.\'\u0900-\u097F]{2,30})/i);
    if (brandMatch && brandMatch[1] && !this.knownFacts.brandName) {
      let candidate = brandMatch[1].replace(/\b(?:and|we|in|for|sell|a|the|is|are)\b.*$/i, "").trim();
      if (candidate.length > 1 && candidate.length < 30) {
        this.knownFacts.brandName = candidate;
        logToFile(`[Context Memory] Captured brand name: "${this.knownFacts.brandName}"`);
      }
    }

    // 2. Direct answer extraction when agent previously asked for brand name
    if (!this.knownFacts.brandName && this.lastAgentAsked === "brandName") {
      const cleaned = text.replace(/^(?:my brand is|it is|it's|called|name is|mera brand|brand hai|ha|yes|yeah)\s+/i, "").trim();
      if (cleaned.length >= 2 && cleaned.length <= 35 && !/^(hi|hello|hey|no|yes|ok|okay)$/i.test(cleaned)) {
        this.knownFacts.brandName = cleaned;
        logToFile(`[Context Memory] Captured brand name from direct answer: "${this.knownFacts.brandName}"`);
      }
    }

    // 3. Product Category extraction
    const categoryKeywords = [
      "skincare", "beauty", "cosmetics", "makeup", "clothing", "apparel", "fashion",
      "footwear", "shoes", "sneakers", "electronics", "gadgets", "jewellery", "jewelry",
      "food", "beverages", "supplements", "fitness", "home decor", "furniture", "toys", "baby products"
    ];
    for (const cat of categoryKeywords) {
      if (lowerText.includes(cat) && !this.knownFacts.productCategory) {
        this.knownFacts.productCategory = cat;
        logToFile(`[Context Memory] Captured product category: "${cat}"`);
        break;
      }
    }

    // 4. Direct answer extraction when agent previously asked for product category
    if (!this.knownFacts.productCategory && this.lastAgentAsked === "productCategory") {
      if (text.length >= 3 && text.length <= 40) {
        this.knownFacts.productCategory = text.trim();
        logToFile(`[Context Memory] Captured product category from direct answer: "${this.knownFacts.productCategory}"`);
      }
    }

    // 5. Operational Pain Point extraction
    if (!this.knownFacts.painPoint) {
      if (/\bRTO\b|return\s+to\s+origin|cod\s+fail|return|cancellation/i.test(text)) this.knownFacts.painPoint = "high RTO on COD orders";
      else if (/abandon(?:ed)?\s+cart|cart\s+recovery|cart/i.test(text)) this.knownFacts.painPoint = "abandoned carts";
      else if (/support\s+call|missed\s+call|customer\s+care|delay|delivery/i.test(text)) this.knownFacts.painPoint = "missed customer support calls";
    }
  }

  updateConversationState(text) {
    this.extractKnownFacts(text);
  }

  /* ── Build compact [KNOWN FACTS] reminder message for LLM ── */
  buildKnownFactsMessage() {
    const facts = [];
    if (this.knownFacts.brandName) facts.push(`Brand name: "${this.knownFacts.brandName}"`);
    if (this.knownFacts.productCategory) facts.push(`Product category: "${this.knownFacts.productCategory}"`);
    if (this.knownFacts.painPoint) facts.push(`Main pain point: "${this.knownFacts.painPoint}"`);
    if (this.confirmedLang) facts.push(`Preferred language: ${this.confirmedLang}`);
    if (facts.length === 0) return null;
    return `[KNOWN FACTS FROM THIS CONVERSATION — DO NOT RE-ASK THESE]: ${facts.join(" | ")}. Build on this information, do NOT ask again.`;
  }

  buildConversationContextMessage() {
    return this.buildKnownFactsMessage();
  }

  /* ── Streaming LLM response with incremental TTS ── */
  async triggerResponse(text) {
    // ── Robust Multilingual Detection & Regional Language Lock ──
    // Detects Devanagari (Hindi/Marathi), Tamil, Telugu, Kannada, Malayalam, Gujarati, Bengali, Punjabi
    // as well as Latin-transliterated regional keywords (e.g., "Mera brand Organic Glow hai", "Kiti charges ahet?")
    let detectedLang = "en-IN";

    if (this.currentSttLangCode && ["hi-IN", "mr-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "bn-IN", "gu-IN", "pa-IN"].includes(this.currentSttLangCode)) {
      detectedLang = this.currentSttLangCode;
    } else if (/[\u0900-\u097F]/.test(text)) {
      if (HINDI_EXPLICIT.test(text)) detectedLang = "hi-IN";
      else if (MARATHI_MARKERS.test(text)) detectedLang = "mr-IN";
      else detectedLang = "hi-IN";
    } else if (/[\u0B80-\u0BFF]/.test(text)) {
      detectedLang = "ta-IN";
    } else if (/[\u0C00-\u0C7F]/.test(text)) {
      detectedLang = "te-IN";
    } else if (/[\u0C80-\u0CFF]/.test(text)) {
      detectedLang = "kn-IN";
    } else if (/[\u0D00-\u0D7F]/.test(text)) {
      detectedLang = "ml-IN";
    } else if (/[\u0A80-\u0AFF]/.test(text)) {
      detectedLang = "gu-IN";
    } else if (MARATHI_LATIN.test(text)) {
      detectedLang = "mr-IN";
    } else if (HINDI_LATIN.test(text)) {
      detectedLang = "hi-IN";
    } else if (this.confirmedLang && this.confirmedLang !== "en-IN" && text.trim().split(/\s+/).length < 5) {
      detectedLang = this.confirmedLang;
    }

    if (detectedLang !== "en-IN") {
      this.confirmedLang = detectedLang;
    }
    this.currentTurnLang = detectedLang;

    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
    this.currentTranscript = "";
    if (!text || this.bridge.closed) return;

    this.processingTurn = true;
    const turnToken = {};
    this.currentTurnToken = turnToken;
    this.accumulatedPcm8 = Buffer.alloc(0);

    logToFile(`User transcription: "${text}". Triggering LLM response...`);
    this.updateConversationState(text);
    this.history.push({ role: "user", content: text });

    const activeCallId = this.bridge.demoId || this.bridge.callId || "live-call";
    addTranscriptEntry(activeCallId, "user", text, { lang: detectedLang });

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

    logToFile(`Detected language: ${detectedLang}`);

    // Build the messages array — inject known facts reminder if we have any
    const knownFactsMsg = this.buildKnownFactsMessage();
    const messages = [
      { role: "system", content: DEMO_INSTRUCTIONS },
      ...(knownFactsMsg ? [{ role: "system", content: knownFactsMsg }] : []),
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
          max_tokens: 350,  // Increased from 200 to prevent truncation-induced context loss
          stream: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam completions failed: ${errText}`);
      }

      // ── Two-phase TTS dispatch to eliminate inter-sentence gaps ──
      // Phase 1: Fire TTS for the first sentence immediately when it arrives
      // Phase 2: Collect all remaining text and send as a single second TTS call
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let sentenceBuffer = "";
      let firstSentenceDispatched = false;
      let remainderText = "";

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

            // Only dispatch the first sentence early (to minimize latency for first word)
            // All subsequent sentences are accumulated and sent as one batch after stream completes
            if (!firstSentenceDispatched) {
              const sentenceEndMatch = sentenceBuffer.match(/^(.*?[।\.?!\n]+)(.*)/s);
              if (sentenceEndMatch) {
                const completedSentence = sentenceEndMatch[1].trim();
                sentenceBuffer = sentenceEndMatch[2];

                const cleaned = completedSentence
                  .replace(/\(.*?\)/g, "")
                  .replace(/[*_#"`']/g, "")
                  .trim();

                if (isSpeakable(cleaned)) {
                  const lang = this.currentTurnLang;
                  logToFile(`First-sentence early TTS dispatch: "${cleaned}" [${lang}]`);
                  this.queueTextToSpeech(cleaned, turnToken, lang);
                  firstSentenceDispatched = true;
                }
              }
            }
          } catch { }
        }
      }

      // ── Batch remainder into a single TTS call ──
      // Combine any leftover sentenceBuffer into one coherent block and call TTS once
      if (this.currentTurnToken === turnToken) {
        const remainderRaw = sentenceBuffer.trim()
          .replace(/\(.*?\)/g, "")
          .replace(/[*_#"`']/g, "")
          .trim();

        if (isSpeakable(remainderRaw)) {
          const lang = this.currentTurnLang;
          logToFile(`Batched remainder TTS dispatch: "${remainderRaw}" [${lang}]`);
          // Send as a single TTS call — no fragmentation = no inter-sentence gaps
          this.queueTextToSpeech(remainderRaw, turnToken, lang);
        }
      }

      logToFile(`LLM Response (full): "${fullContent.trim()}"`);

      if (fullContent.trim()) {
        this.history.push({ role: "assistant", content: fullContent.trim() });
        const activeCallId = this.bridge.demoId || this.bridge.callId || "live-call";
        addTranscriptEntry(activeCallId, "agent", fullContent.trim(), { lang: this.currentTurnLang });

        // Track last agent question to capture direct user answers in context memory
        const lowerResp = fullContent.toLowerCase();
        if (/brand\s+name|store\s+name|what's\s+the\s+name|ब्रांड\s+का\s+नाम/i.test(lowerResp)) {
          this.lastAgentAsked = "brandName";
        } else if (/category|what\s+do\s+you\s+sell|what\s+products|कौन\s+सी\s+कैटेगरी|का\s+विकता/i.test(lowerResp)) {
          this.lastAgentAsked = "productCategory";
        } else {
          this.lastAgentAsked = null;
        }
      }

      // Mark turn complete — processingTurn is cleared after first TTS block completes
      this.processingTurn = false;

      // DO NOT reset currentSttLangCode to null — let confirmedLang persist across turns
      // Only reset the per-turn raw ASR code
      this.currentSttLangCode = null;
    } catch (e) {
      logToFile(`Error generating LLM response: ${e.message}`);
      this.processingTurn = false;
      this.currentSttLangCode = null;
    }
  }

  /* ── TTS with dynamic language & phonetic replacement ── */
  async fetchTts(text, lang = "hi-IN") {
    if (this.bridge.closed) return null;

    // MANDATORY PRONUNCIATION FIX FOR KZUNO:
    // Company name KZUNO must ALWAYS be pronounced as "Kee Zoo No"
    // (written as "Keezoono" in English, "कीज़ूनो" in Devanagari for Bulbul TTS)
    // NEVER "Kazuno", "Kizuno", "K-Z-U-N-O", or "Kuh-zuno"
    let cleanText = text;

    // MANDATORY FIX FOR 'UNDER!' ABBREVIATION:
    // Replace "Under!" or "Under," or "Under" with "Understood"
    cleanText = cleanText.replace(/\bUnder\b/gi, "Understood");

    if (/hi|mr|bn|gu|ta|te|kn|ml|pa|od/.test(lang)) {
      cleanText = cleanText.replace(/\b(?:KZUNO|Kzuno|KiZUNO|Kizuno|kzuno)'?s?\b/gi, "कीज़ूनो");
    } else {
      cleanText = cleanText.replace(/\b(?:KZUNO|Kzuno|KiZUNO|Kizuno|kzuno)'?s?\b/gi, "Keezoono");
    }

    logToFile(`Fetching Sarvam TTS [${lang}]: "${cleanText}"`);

    try {
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleanText,
          target_language_code: lang,
          speaker: "ritu",
          model: "bulbul:v3",
          pace: 0.98, // 0.98 pace gives Bulbul TTS natural room for warm human pitch inflections and breathing pauses
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
    // Start fetching immediately in parallel (non-blocking)
    const fetchPromise = this.fetchTts(text, lang);

    // Chain playback sequentially — each block waits for the previous to finish
    this.ttsQueue = this.ttsQueue.then(async () => {
      if (this.bridge.closed) return;
      if (this.currentTurnToken !== turnToken) return;

      const pcm8 = await fetchPromise;
      if (pcm8) {
        if (this.currentTurnToken !== turnToken) return;

        const durationMs = (pcm8.length / 16000) * 1000;
        this.speakingEndTime = Math.max(Date.now(), this.speakingEndTime) + durationMs;
        logToFile(`Queued TTS block: duration is ${durationMs.toFixed(0)}ms`);
        this.processingTurn = false;
        this.bridge.onAudioDelta(pcm8.toString("base64"));
      }
    });

    return this.ttsQueue;
  }

  downsample24to8(buffer) {
    // ── Proper RIFF chunk traversal to find PCM data offset ──
    // Avoid naive string search for "data" which can match inside INFO metadata chunks
    let raw = null;
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      let offset = 12; // Skip RIFF header (4) + file size (4) + WAVE (4)
      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === 'data') {
          raw = buffer.slice(offset + 8, offset + 8 + chunkSize);
          break;
        }
        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++; // RIFF chunks are padded to even byte boundaries
      }
    }
    // Fallback: if RIFF traversal failed, use fixed offset (handles edge cases)
    if (!raw) {
      raw = buffer.slice(44);
    }
    
    // Guarantee even byte length to prevent 16-bit LE PCM sample misalignment
    if (raw.length % 2 !== 0) {
      raw = raw.slice(0, raw.length - 1);
    }

    const totalSamples = Math.floor(raw.length / 2);
    const outSamples = Math.floor(totalSamples / 3);
    const downsampled = Buffer.alloc(outSamples * 2);

    // 5-tap Sinc FIR low-pass filter coefficients (Fc = 3.8kHz) for 3:1 decimation (24kHz -> 8kHz)
    // Completely eliminates high-frequency aliasing static & telephony noise
    const h0 = 0.06, h1 = 0.25, h2 = 0.38, h3 = 0.25, h4 = 0.06;

    let writeOffset = 0;
    for (let i = 0; i < outSamples; i++) {
      const center = i * 3;
      const s_m2 = (center >= 2) ? raw.readInt16LE((center - 2) * 2) : raw.readInt16LE(0);
      const s_m1 = (center >= 1) ? raw.readInt16LE((center - 1) * 2) : s_m2;
      const s0   = raw.readInt16LE(center * 2);
      const s_p1 = (center + 1 < totalSamples) ? raw.readInt16LE((center + 1) * 2) : s0;
      const s_p2 = (center + 2 < totalSamples) ? raw.readInt16LE((center + 2) * 2) : s_p1;

      // 5-tap anti-aliasing FIR filtering
      const filtered = (s_m2 * h0) + (s_m1 * h1) + (s0 * h2) + (s_p1 * h3) + (s_p2 * h4);
      // Clean 0.90x gain scaling to guarantee 0dB headroom and zero DAC clipping noise
      const scaled = Math.round(filtered * 0.90);
      const clamped = Math.max(-32768, Math.min(32767, scaled));

      downsampled.writeInt16LE(clamped, writeOffset);
      writeOffset += 2;
    }
    return downsampled;
  }
}
