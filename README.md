# VANI — Live Demo Call (Exotel + xAI Grok Voice Agent)

Landing page + full backend. A visitor clicks **Get a demo call**, enters their
+91 number, and their phone rings from your ExoPhone. On answer they're talking
live to "Asha" — an AI agent running on xAI's Grok Voice Agent API — who opens
with a Hindi AI-disclosure line, then converses in Hindi/English/Hinglish.

## How a call flows

```
Browser ── POST /api/demo-call ──► Your server
                                      │ Exotel Connect API (From=user, CallerId=ExoPhone,
                                      │  StreamUrl=wss://you/exotel-media, StreamType=bidirectional)
                                      ▼
                                   Exotel rings the user's cell (real +91 caller ID)
                                      │ user answers
                                      ▼
        Exotel opens WS ──► /exotel-media  ◄──WS──► wss://api.x.ai/v1/realtime
                            (lib/bridge.js)          grok-voice-latest, voice "ara"

  caller audio  (base64 PCM16 8kHz)  ──► input_audio_buffer.append ──► Grok
  Grok audio    response.output_audio.delta ──► re-chunked (320B multiples) ──► caller
  barge-in      Grok VAD speech_started ──► Exotel "clear" (stops playback instantly)
```

No transcoding: Exotel streams 16-bit 8kHz mono PCM and xAI natively supports
`audio/pcm` at 8000 Hz on both input and output.

## Layout

```
server.js          Express + HTTP server; trigger API, status webhook, WS attach
lib/bridge.js      Exotel AgentStream ↔ xAI realtime bridge (the heart of it)
lib/exotel.js      Outbound call via Exotel Connect Voice AI API
lib/store.js       In-memory call records, +91 validation, rate limiting
public/index.html  Landing page with the demo-call modal + live stepper
```

## Setup

### 0. Secrets — do this first
Your Exotel key/token and xAI key have been shared in chat: **rotate all three**
(my.exotel.com → API settings; console.x.ai → API keys) and put the NEW values
in `.env`. Never commit `.env`.

### 1. Exotel prerequisites (one-time)
- **AgentStream / Voicebot streaming must be enabled on your account.** If it
  isn't yet, email hello@exotel.com: "Enable Stream/Voicebot Applet for vaniai2"
  with a one-line use case. KYC must be complete.
- Your ExoPhone (01141189661) must be allowed for outbound dialing.
- Note your subdomain: Singapore-cluster accounts often use `api.exotel.com`
  (already the default); Mumbai accounts use `api.in.exotel.com`.

### 2. Run
```bash
cp .env.example .env    # fill XAI_API_KEY, EXOTEL_API_KEY, EXOTEL_API_TOKEN
npm install
npm start
# Expose publicly — Exotel must reach your wss endpoint:
ngrok http 3000         # put the https URL into PUBLIC_BASE_URL, restart
```
Open the site → **Get a demo call** → your number → answer → talk to Asha.

### 3. If the call connects but is silent
1. Check `PUBLIC_BASE_URL` is the **https** ngrok URL (bridge derives wss from it).
2. Confirm AgentStream is enabled for your SID (silent calls = stream never opened).
3. Watch server logs: you should see `stream started (ss_…)` then no `xai error`.
4. Verify the xAI key has credit (a $5 grant covers many demo minutes).

## Built-in guardrails (keep these)
- Consent checkbox + user-initiated calls only (TRAI-relevant).
- Rate limit: 3 calls/number/hour (`DEMO_RATE_LIMIT`).
- 3-minute hard cap per call (`TimeLimit=180` on the Exotel API).
- Verbatim AI disclosure at call start via xAI `force_message`.

## Endpoints
| Method | Path                       | Purpose                                    |
| ------ | -------------------------- | ------------------------------------------ |
| POST   | `/api/demo-call`           | `{ phone, consent }` → places the call     |
| GET    | `/api/demo-call/:id`       | Poll status for the UI stepper             |
| WS     | `/exotel-media?demo_id=…`  | Exotel AgentStream ↔ Grok bridge           |
| POST   | `/webhooks/exotel-status`  | Exotel lifecycle → stepper updates         |
| GET    | `/healthz`                 | Liveness                                   |
