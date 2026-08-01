import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/exotel/audio/$audioId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Strip .wav (or any) extension and sanitize
        const raw = params.audioId;
        const id = raw.replace(/\.[a-zA-Z0-9]+$/, "").replace(/[^a-zA-Z0-9-]/g, "");
        if (!id) return new Response("Bad request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage
          .from("exotel-tts")
          .download(`${id}.wav`);
        if (error || !data) {
          return new Response("Not found", { status: 404 });
        }
        const buf = await data.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(buf.byteLength),
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
