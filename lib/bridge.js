// lib/bridge.js
// Bridges a Vobiz bidirectional stream to a Sarvam AI Voice Agent session.
//
//   Vobiz media (base64 PCM16 LE, 8kHz mono) ──► Sarvam STT → LLM → TTS
//   Sarvam TTS audio                           ──► Vobiz media (paced 20ms chunks)
//
// Audio is 16-bit 8kHz mono PCM throughout — no transcoding needed.

import WebSocket, { WebSocketServer } from "ws";
import { updateCallStatus } from "./store.js";
import { SarvamSessionAdapter } from "./sarvam.js";

/* ── Attach the WS server to the existing HTTP server ───────────────── */
export function attachBridge(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url, "http://x");
    if (pathname === "/vobiz-media") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const demoId = new URL(request.url, "http://x").searchParams.get("demo_id");
        console.log(`[bridge] Vobiz stream connected (demo ${demoId || "?"})`);
        new CallBridge(ws, demoId);
      });
    } else {
      socket.destroy();
    }
  });

  console.log("[bridge] WebSocket bridge listening on /vobiz-media");
  return wss;
}

/* ── One live call ───────────────────────────────────────────────────── */
class CallBridge {
  constructor(carrierWs, demoId) {
    this.carrier = carrierWs;
    this.demoId = demoId;
    this.streamSid = null;
    this.pendingCallerAudio = []; // caller audio buffered until session is ready
    this.outBuffer = Buffer.alloc(0); // audio awaiting re-chunk
    this.pacingInterval = null; // interval for output audio pacing
    this.closed = false;

    this.carrier.on("message", (raw) => this.onCarrierMessage(raw));
    this.carrier.on("close", () => this.teardown("carrier closed"));
    this.carrier.on("error", (e) => this.teardown(`carrier error: ${e.message}`));

    // Connect Sarvam session immediately
    this.session = new SarvamSessionAdapter(this);
    this.session.connect();
  }

  onAudioDelta(b64) {
    if (b64) this.pushAudioToCarrier(Buffer.from(b64, "base64"));
  }

  onSpeechStarted() {
    // Clear the carrier's audio buffer immediately (barge-in)
    this.sendToCarrier({ event: "clearAudio", streamId: this.streamSid });
    this.sendToCarrier({ event: "clear", streamId: this.streamSid });
    this.outBuffer = Buffer.alloc(0);
    this.stopPacing();
  }

  /* ── Inbound messages from Vobiz ── */
  onCarrierMessage(raw) {
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
        this.streamSid = msg.start?.streamId || msg.streamId || msg.start?.stream_sid || null;
        console.log(`[bridge] stream started (${this.streamSid})`);
        if (this.demoId) updateCallStatus(this.demoId, "connected");
        
        // Notify the adapter that the phone stream is active and ready to play audio
        if (this.session && typeof this.session.onStreamStarted === "function") {
          this.session.onStreamStarted();
        }
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
      default:
        break;
    }
  }

  stopPacing() {
    if (this.pacingInterval) {
      clearInterval(this.pacingInterval);
      this.pacingInterval = null;
    }
    this.silenceTicks = 0;
  }

  // Re-chunk and pace audio into Vobiz-friendly frames (320 bytes = 20ms at 8kHz PCM16).
  pushAudioToCarrier(buf) {
    if (!buf || buf.length === 0) return;
    // Enforce strict 16-bit LE PCM sample alignment (must be even byte length)
    if (buf.length % 2 !== 0) {
      buf = buf.subarray(0, buf.length - 1);
    }
    this.outBuffer = Buffer.concat([this.outBuffer, buf]);

    // Start pacing interval if it is not already running
    if (!this.pacingInterval) {
      const chunkSize = 320; // 20ms chunk at 8kHz PCM16 (16000 bytes/sec)
      const intervalMs = 20;
      this.silenceTicks = 0;

      this.pacingInterval = setInterval(() => {
        if (this.closed) {
          this.stopPacing();
          return;
        }

        if (this.outBuffer.length >= chunkSize) {
          const chunk = this.outBuffer.subarray(0, chunkSize);
          this.outBuffer = this.outBuffer.subarray(chunkSize);
          this.sendChunk(chunk);
          this.silenceTicks = 0;
        } else {
          this.silenceTicks++;
          // Only stop pacing after 25 consecutive silent ticks (500ms of true idle)
          // to prevent premature interval tearing between TTS stream chunks
          if (this.silenceTicks >= 25) {
            if (this.outBuffer.length > 0) {
              const rem = this.outBuffer.length - (this.outBuffer.length % chunkSize);
              if (rem > 0) {
                this.sendChunk(this.outBuffer.subarray(0, rem));
              }
              this.outBuffer = Buffer.alloc(0);
            }
            this.stopPacing();
          }
        }
      }, intervalMs);
    }
  }

  sendChunk(chunk) {
    const payload = chunk.toString("base64");
    this.sendToCarrier({
      event: "playAudio",
      streamId: this.streamSid,
      media: {
        contentType: "audio/x-l16",
        sampleRate: 8000,
        payload,
      },
    });
  }

  sendToCarrier(obj) {
    if (this.carrier?.readyState === WebSocket.OPEN && this.streamSid) {
      this.carrier.send(JSON.stringify(obj));
    }
  }

  /* ── Teardown ── */
  teardown(reason) {
    if (this.closed) return;
    this.closed = true;
    console.log(`[bridge] teardown (${reason})`);
    this.stopPacing();
    if (this.demoId) updateCallStatus(this.demoId, "completed");
    try {
      this.session?.close();
    } catch {}
    try {
      this.carrier?.close();
    } catch {}
  }
}
