// lib/bridge.js
// Bridges an Exotel bidirectional AgentStream to an xAI Grok Voice Agent session.
//
//   Exotel media (base64 PCM16 LE, 8kHz mono) ──► xAI input_audio_buffer.append
//   xAI response.output_audio.delta            ──► Exotel media (re-chunked)
//   xAI input_audio_buffer.speech_started      ──► Exotel "clear" (barge-in)
//
// Both sides use identical audio (16-bit 8kHz mono PCM) → no transcoding.
//
// xAI docs:    https://docs.x.ai/developers/model-capabilities/audio/voice-agent
// Exotel docs: https://developer.exotel.com/docs/agentstream/developer-guide

import WebSocket, { WebSocketServer } from "ws";
import { getCall, updateCallStatus } from "./store.js";

const XAI_AGENT_ID = process.env.XAI_AGENT_ID;
const XAI_URL = XAI_AGENT_ID
  ? `wss://api.x.ai/v1/realtime?agent_id=${XAI_AGENT_ID}`
  : `wss://api.x.ai/v1/realtime?model=${process.env.XAI_MODEL || "grok-voice-latest"}`;

// Exotel wants outbound chunks in multiples of 320 bytes; ~100ms (3200B) is ideal.
const CHUNK_BYTES = 3200;

/* ── Demo agent persona ─────────────────────────────────────────────── */
const DEMO_INSTRUCTIONS = `
You are "Asha", a friendly AI voice agent from VANI — a voice AI platform for
Indian D2C brands. You are on a short OUTBOUND DEMO CALL that the listener
requested seconds ago on the VANI website, to hear what a VANI agent sounds like.

Language: Start in Hindi. If the listener replies in English, Hinglish, or
another language, mirror their language naturally. Short, warm, conversational
sentences — this is a phone call.

Flow:
1. You have already disclosed you're an AI (a scripted line played first).
   Greet warmly and confirm this is the demo call they requested.
2. In two sentences, explain what VANI agents do for brands: order confirmation,
   lead qualification, payment reminders, and 24x7 inbound support in Indian languages.
3. Offer a mini role-play: "Want me to demo a quick order-confirmation call as if
   you were a customer?" If yes, do a playful 20–30 second role-play confirming a
   fictitious order. If no, answer their questions about VANI instead.
4. Close by inviting them to sign up on the VANI website, thank them, say goodbye.

Rules:
- Never claim to be human. If asked, say you're an AI agent built on VANI.
- Keep the whole call under ~2 minutes; wrap up politely if it runs long.
- Never collect personal or payment information. This is a demo only.
- If the listener says "stop", "band karo", or wants to end — thank them and say goodbye immediately.
`.trim();

const DISCLOSURE_LINE =
  "नमस्ते! यह VANI की तरफ़ से एक AI डेमो कॉल है, जो आपने अभी हमारी वेबसाइट पर रिक्वेस्ट की थी।";

/* ── Attach the WS server to the existing HTTP server ───────────────── */
export function attachBridge(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/exotel-media" });

  wss.on("connection", (exotelWs, req) => {
    const demoId = new URL(req.url, "http://x").searchParams.get("demo_id");
    console.log(`[bridge] Exotel stream connected (demo ${demoId || "?"})`);
    new CallBridge(exotelWs, demoId);
  });

  console.log("[bridge] WebSocket bridge listening on /exotel-media");
  return wss;
}

/* ── One live call ───────────────────────────────────────────────────── */
class CallBridge {
  constructor(exotelWs, demoId) {
    this.exotel = exotelWs;
    this.demoId = demoId;
    this.streamSid = null;
    this.xai = null;
    this.xaiReady = false;
    this.pendingCallerAudio = []; // caller audio buffered until xAI is ready
    this.outBuffer = Buffer.alloc(0); // xAI audio awaiting re-chunk to Exotel
    this.closed = false;

    this.exotel.on("message", (raw) => this.onExotelMessage(raw));
    this.exotel.on("close", () => this.teardown("exotel closed"));
    this.exotel.on("error", (e) => this.teardown(`exotel error: ${e.message}`));

    // Connect to xAI immediately — don't wait for Exotel's start event.
    this.connectXai();
  }

  /* ── xAI side ── */
  connectXai() {
    this.xai = new WebSocket(XAI_URL, {
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    });

    this.xai.on("open", () => {
      // Match Exotel's telephony format exactly: PCM16 @ 8kHz both directions.
      const sessionUpdate = {
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 8000 },
            transcription: { language_hint: "hi" },
          },
          output: { format: { type: "audio/pcm", rate: 8000 } },
        },
      };

      if (!process.env.XAI_AGENT_ID) {
        sessionUpdate.voice = "ara";
        sessionUpdate.instructions = DEMO_INSTRUCTIONS;
        sessionUpdate.turn_detection = {
          type: "server_vad",
          silence_duration_ms: 700,
          idle_timeout_ms: 6000,
        };
        sessionUpdate.replace = { VANI: "वाणी", D2C: "डी टू सी" };
      }

      this.xai.send(
        JSON.stringify({
          type: "session.update",
          session: sessionUpdate,
        })
      );

      if (!process.env.XAI_AGENT_ID) {
        // Verbatim AI-disclosure line (force_message IS the turn — no response.create for it)
        this.xai.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "force_message",
              role: "assistant",
              interruptible: false,
              content: [{ type: "output_text", text: DISCLOSURE_LINE }],
            },
          })
        );
      }

      // Then hand over to the model for the real greeting
      this.xai.send(JSON.stringify({ type: "response.create" }));

      this.xaiReady = true;
      if (this.demoId) updateCallStatus(this.demoId, "agent-joined");

      // Flush caller audio that arrived while we were connecting
      for (const b64 of this.pendingCallerAudio) this.sendCallerAudio(b64);
      this.pendingCallerAudio = [];
    });

    this.xai.on("message", (raw) => this.onXaiMessage(raw));
    this.xai.on("close", () => this.teardown("xai closed"));
    this.xai.on("error", (e) => this.teardown(`xai error: ${e.message}`));
  }

  sendCallerAudio(b64) {
    if (this.xai?.readyState === WebSocket.OPEN) {
      this.xai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
    }
  }

  onXaiMessage(raw) {
    let ev;
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (ev.type) {
      case "response.output_audio.delta": {
        const b64 = ev.delta ?? ev.audio;
        if (b64) this.pushAudioToExotel(Buffer.from(b64, "base64"));
        break;
      }
      case "input_audio_buffer.speech_started":
        // Caller barged in — stop queued playback on the phone immediately.
        this.sendToExotel({ event: "clear", stream_sid: this.streamSid });
        this.outBuffer = Buffer.alloc(0);
        break;
      case "error":
        console.error(`[bridge] xAI error:`, JSON.stringify(ev.error || ev).slice(0, 300));
        break;
      default:
        break;
    }
  }

  /* ── Exotel side ── */
  onExotelMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        break;
      case "start":
        this.streamSid = msg.start?.stream_sid || msg.stream_sid || msg.streamSid || null;
        console.log(`[bridge] stream started (${this.streamSid})`);
        if (this.demoId) updateCallStatus(this.demoId, "connected");
        break;
      case "media": {
        const b64 = msg.media?.payload;
        if (!b64) break;
        if (this.xaiReady) this.sendCallerAudio(b64);
        else this.pendingCallerAudio.push(b64);
        break;
      }
      case "dtmf":
        // Keypresses could drive menus later; log for now.
        console.log(`[bridge] dtmf: ${msg.dtmf?.digit}`);
        break;
      case "stop":
        this.teardown("exotel stop event");
        break;
      default:
        break;
    }
  }

  // Re-chunk xAI audio into Exotel-friendly frames (multiples of 320 bytes).
  pushAudioToExotel(buf) {
    this.outBuffer = Buffer.concat([this.outBuffer, buf]);
    while (this.outBuffer.length >= CHUNK_BYTES) {
      const chunk = this.outBuffer.subarray(0, CHUNK_BYTES);
      this.outBuffer = this.outBuffer.subarray(CHUNK_BYTES);
      this.sendToExotel({
        event: "media",
        stream_sid: this.streamSid,
        media: { payload: chunk.toString("base64") },
      });
    }
    // Flush a sub-chunk remainder rounded down to a 320-byte multiple
    const rem = this.outBuffer.length - (this.outBuffer.length % 320);
    if (rem >= 320) {
      const chunk = this.outBuffer.subarray(0, rem);
      this.outBuffer = this.outBuffer.subarray(rem);
      this.sendToExotel({
        event: "media",
        stream_sid: this.streamSid,
        media: { payload: chunk.toString("base64") },
      });
    }
  }

  sendToExotel(obj) {
    if (this.exotel?.readyState === WebSocket.OPEN && this.streamSid) {
      this.exotel.send(JSON.stringify(obj));
    }
  }

  /* ── Teardown ── */
  teardown(reason) {
    if (this.closed) return;
    this.closed = true;
    console.log(`[bridge] teardown (${reason})`);
    if (this.demoId) updateCallStatus(this.demoId, "completed");
    try {
      this.xai?.close();
    } catch {}
    try {
      this.exotel?.close(); // closing the Exotel WS ends the stream/flow
    } catch {}
  }
}
