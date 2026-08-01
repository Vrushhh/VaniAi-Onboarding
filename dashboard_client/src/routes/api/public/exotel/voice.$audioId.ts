import { createFileRoute } from "@tanstack/react-router";

function buildExoML(audioId: string, request: Request): Response {
  const cleaned = audioId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!cleaned) return new Response("Bad request", { status: 400 });
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const audioUrl = `${proto}://${host}/api/public/exotel/audio/${cleaned}.wav`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${audioUrl}</Play></Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/public/exotel/voice/$audioId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => buildExoML(params.audioId, request),
      POST: async ({ params, request }) => buildExoML(params.audioId, request),
    },
  },
});
