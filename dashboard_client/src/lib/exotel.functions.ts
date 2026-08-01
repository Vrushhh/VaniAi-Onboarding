import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface InitiateTestCallInput {
  to: string;
  text: string;
  target_language_code?: string;
  speaker?: string;
}

function normalizeNumber(raw: string): string {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  if (!trimmed) throw new Error("Destination number is required");
  if (!/^\+?\d{7,15}$/.test(trimmed)) {
    throw new Error("Enter a valid phone number (digits, optional leading +)");
  }
  return trimmed;
}

async function synthesizeWav(input: {
  text: string;
  target_language_code: string;
  speaker: string;
}): Promise<Buffer> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error("SARVAM_API_KEY is not configured");
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      text: input.text,
      target_language_code: input.target_language_code,
      speaker: input.speaker,
      model: "bulbul:v2",
      enable_preprocessing: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sarvam TTS failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { audios?: string[] };
  const b64 = json.audios?.[0];
  if (!b64) throw new Error("Sarvam returned no audio");
  return Buffer.from(b64, "base64");
}

function originFromRequest(): string {
  const req = getRequest();
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const initiateTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: InitiateTestCallInput) => {
    if (!input || typeof input.text !== "string" || typeof input.to !== "string") {
      throw new Error("text and to are required");
    }
    const text = input.text.trim();
    if (!text) throw new Error("Text is empty");
    if (text.length > 1500) throw new Error("Text too long (max 1500 chars)");
    return {
      to: normalizeNumber(input.to),
      text,
      target_language_code: input.target_language_code || "en-IN",
      speaker: input.speaker || "anushka",
    };
  })
  .handler(async ({ data }) => {
    const sid = process.env.EXOTEL_SID;
    const apiKey = process.env.EXOTEL_API_KEY;
    const apiToken = process.env.EXOTEL_API_TOKEN;
    const subdomain = process.env.EXOTEL_SUBDOMAIN || "api.exotel.com";
    const callerId = process.env.EXOTEL_CALLER_ID;
    if (!sid || !apiKey || !apiToken || !callerId) {
      throw new Error("Exotel is not fully configured on the server");
    }

    // 1. Generate TTS
    const wav = await synthesizeWav({
      text: data.text,
      target_language_code: data.target_language_code,
      speaker: data.speaker,
    });

    // 2. Upload to private storage under a random id
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const audioId = crypto.randomUUID();
    const path = `${audioId}.wav`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("exotel-tts")
      .upload(path, wav, { contentType: "audio/wav", upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    // 3. Build public ExoML URL Exotel will fetch
    const origin = originFromRequest();
    const voiceUrl = `${origin}/api/public/exotel/voice/${audioId}`;

    // 4. Trigger Exotel Calls/connect
    const form = new URLSearchParams();
    form.set("From", data.to);
    form.set("CallerId", callerId);
    form.set("Url", voiceUrl);
    form.set("CallType", "trans");

    const auth = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
    const exotelUrl = `https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`;
    const res = await fetch(exotelUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Exotel call failed (${res.status}): ${bodyText.slice(0, 400)}`);
    }
    let sidReturned: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { Call?: { Sid?: string; Status?: string } };
      sidReturned = parsed.Call?.Sid;
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      audio_id: audioId,
      voice_url: voiceUrl,
      call_sid: sidReturned ?? null,
      to: data.to,
    };
  });
