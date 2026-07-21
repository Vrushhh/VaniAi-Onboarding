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
import { SarvamSessionAdapter } from "./sarvam.js";

const XAI_AGENT_ID = process.env.XAI_AGENT_ID;
const XAI_URL = XAI_AGENT_ID
  ? `wss://api.x.ai/v1/realtime?agent_id=${XAI_AGENT_ID}`
  : `wss://api.x.ai/v1/realtime?model=${process.env.XAI_MODEL || "grok-voice-latest"}`;

// Exotel wants outbound chunks in multiples of 320 bytes; ~100ms (3200B) is ideal.
const CHUNK_BYTES = 3200;

/* ── Demo agent persona ─────────────────────────────────────────────── */
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

const DISCLOSURE_LINE =
  "नमस्ते! यह KZUNO की तरफ़ से एक AI डेमो कॉल है, जो आपने अभी हमारी वेबसाइट पर रिक्वेस्ट की थी।";

/* ── Attach the WS server to the existing HTTP server ───────────────── */
export function attachBridge(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url, "http://x");
    if (pathname === "/exotel-media") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const demoId = new URL(request.url, "http://x").searchParams.get("demo_id");
        console.log(`[bridge] Exotel stream connected (demo ${demoId || "?"})`);
        new CallBridge(ws, demoId, "exotel");
      });
    } else if (pathname === "/vobiz-media") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const demoId = new URL(request.url, "http://x").searchParams.get("demo_id");
        console.log(`[bridge] Vobiz stream connected (demo ${demoId || "?"})`);
        new CallBridge(ws, demoId, "vobiz");
      });
    } else {
      socket.destroy();
    }
  });

  console.log("[bridge] WebSocket bridge listening on /exotel-media and /vobiz-media");
  return wss;
}

/* ── xAI Session Adapter ── */
class XaiSession {
  constructor(bridge) {
    this.bridge = bridge;
    this.xai = null;
  }

  get ready() {
    return this.bridge.xaiReady;
  }

  connect() {
    this.xai = new WebSocket(XAI_URL, {
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    });

    this.xai.on("open", () => {
      const rate = 8000;
      const sessionUpdate = {
        audio: {
          input: { format: { type: "audio/pcm", rate: rate } },
          output: { format: { type: "audio/pcm", rate: rate } },
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.8,
          silence_duration_ms: 800,
          idle_timeout_ms: 6000,
        },
      };

      if (!process.env.XAI_AGENT_ID) {
        sessionUpdate.voice = "ara";
        sessionUpdate.instructions = DEMO_INSTRUCTIONS;
        sessionUpdate.replace = { KZUNO: "कज़ूनो", D2C: "डी टू सी" };
      }

      this.xai.send(
        JSON.stringify({
          type: "session.update",
          session: sessionUpdate,
        })
      );

      if (!process.env.XAI_AGENT_ID) {
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

      this.xai.send(JSON.stringify({ type: "response.create" }));

      this.bridge.xaiReady = true;
      if (this.bridge.demoId) updateCallStatus(this.bridge.demoId, "agent-joined");

      for (const b64 of this.bridge.pendingCallerAudio) {
        this.sendCallerAudio(b64);
      }
      this.bridge.pendingCallerAudio = [];
    });

    this.xai.on("message", (raw) => this.bridge.onXaiMessage(raw));
    this.xai.on("close", () => this.bridge.teardown("xai closed"));
    this.xai.on("error", (e) => this.bridge.teardown(`xai error: ${e.message}`));
  }

  sendCallerAudio(b64) {
    if (this.xai?.readyState === WebSocket.OPEN) {
      this.xai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
    }
  }

  close() {
    this.xai?.close();
  }
}

/* ── One live call ───────────────────────────────────────────────────── */
class CallBridge {
  constructor(exotelWs, demoId, type = "exotel") {
    this.exotel = exotelWs;
    this.demoId = demoId;
    this.type = type;
    this.streamSid = null;
    this.xaiReady = false;
    this.pendingCallerAudio = []; // caller audio buffered until session is ready
    this.outBuffer = Buffer.alloc(0); // audio awaiting re-chunk to Exotel
    this.closed = false;

    this.exotel.on("message", (raw) => this.onExotelMessage(raw));
    this.exotel.on("close", () => this.teardown(`${this.type} closed`));
    this.exotel.on("error", (e) => this.teardown(`${this.type} error: ${e.message}`));

    // Connect session immediately — default to Sarvam unless xAI is explicitly requested.
    this.session = process.env.VOICE_PROVIDER === "xai"
      ? new XaiSession(this)
      : new SarvamSessionAdapter(this);
    
    this.session.connect();
  }

  onAudioDelta(b64) {
    if (b64) this.pushAudioToExotel(Buffer.from(b64, "base64"));
  }

  onSpeechStarted() {
    if (this.type === "exotel") {
      this.sendToExotel({ event: "clear", stream_sid: this.streamSid });
    } else if (this.type === "vobiz") {
      this.sendToExotel({ event: "clearAudio", streamId: this.streamSid });
    }
    this.outBuffer = Buffer.alloc(0);
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
        if (this.type === "exotel") {
          this.sendToExotel({ event: "clear", stream_sid: this.streamSid });
        } else if (this.type === "vobiz") {
          this.sendToExotel({ event: "clearAudio", streamId: this.streamSid });
        }
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
  /* ── Inbound Message from Carrier ── */
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
        this.streamSid = msg.start?.stream_sid || msg.start?.streamId || msg.streamId || msg.stream_sid || msg.streamSid || null;
        console.log(`[bridge] ${this.type} stream started (${this.streamSid})`);
        if (this.demoId) updateCallStatus(this.demoId, "connected");
        break;
      case "media": {
        const b64 = msg.media?.payload;
        if (!b64) break;
        if (this.session?.ready) this.session.sendCallerAudio(b64);
        else this.pendingCallerAudio.push(b64);
        break;
      }
      case "dtmf":
        console.log(`[bridge] dtmf: ${msg.dtmf?.digit}`);
        break;
      case "stop":
        if (this.type === "exotel") {
          this.teardown("exotel stop event");
        }
        break;
      default:
        break;
    }
  }

  // Re-chunk xAI audio into Exotel/Vobiz-friendly frames (multiples of 320 bytes).
  pushAudioToExotel(buf) {
    const minChunk = 320;
    const idealChunk = 3200;

    this.outBuffer = Buffer.concat([this.outBuffer, buf]);
    while (this.outBuffer.length >= idealChunk) {
      const chunk = this.outBuffer.subarray(0, idealChunk);
      this.outBuffer = this.outBuffer.subarray(idealChunk);
      this.sendChunk(chunk);
    }
    // Flush a sub-chunk remainder rounded down to a minChunk multiple
    const rem = this.outBuffer.length - (this.outBuffer.length % minChunk);
    if (rem >= minChunk) {
      const chunk = this.outBuffer.subarray(0, rem);
      this.outBuffer = this.outBuffer.subarray(rem);
      this.sendChunk(chunk);
    }
  }

  sendChunk(chunk) {
    const payload = chunk.toString("base64");
    if (this.type === "exotel") {
      this.sendToExotel({
        event: "media",
        stream_sid: this.streamSid,
        media: { payload },
      });
    } else if (this.type === "vobiz") {
      this.sendToExotel({
        event: "playAudio",
        streamId: this.streamSid,
        media: {
          contentType: "audio/x-l16",
          sampleRate: 8000,
          payload,
        },
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
      this.session?.close();
    } catch {}
    try {
      this.exotel?.close(); // closing the Exotel WS ends the stream/flow
    } catch {}
  }
}
