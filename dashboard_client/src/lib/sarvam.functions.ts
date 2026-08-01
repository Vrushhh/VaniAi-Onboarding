import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SynthesizeInput {
  text: string;
  target_language_code?: string;
  speaker?: string;
}

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SynthesizeInput) => {
    if (!input || typeof input.text !== "string") {
      throw new Error("text is required");
    }
    const text = input.text.trim();
    if (!text) throw new Error("text is empty");
    if (text.length > 1500) throw new Error("text too long (max 1500 chars)");
    return {
      text,
      target_language_code: input.target_language_code || "en-IN",
      speaker: input.speaker || "anushka",
    };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) throw new Error("SARVAM_API_KEY is not configured");

    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        text: data.text,
        target_language_code: data.target_language_code,
        speaker: data.speaker,
        model: "bulbul:v2",
        enable_preprocessing: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Sarvam TTS failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { audios?: string[] };
    const audio = json.audios?.[0];
    if (!audio) throw new Error("Sarvam returned no audio");
    // base64-encoded WAV
    return { audio_base64: audio, mime_type: "audio/wav" };
  });
