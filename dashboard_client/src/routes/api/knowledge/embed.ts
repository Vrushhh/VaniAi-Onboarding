import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/knowledge/embed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { query } = await request.json();
          if (!query || !query.trim()) {
            return new Response(
              JSON.stringify({ ok: false, error: "Missing query text" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
          if (!VOYAGE_API_KEY) {
            throw new Error("Missing VOYAGE_API_KEY environment variable. Query cannot be embedded.");
          }

          const res = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${VOYAGE_API_KEY}`,
            },
            body: JSON.stringify({
              input: [query.trim()],
              model: "voyage-3-lite",
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Voyage AI API error: ${errText}`);
          }

          const resJson = await res.json();
          const embedding = resJson.data[0].embedding;

          return new Response(JSON.stringify({ ok: true, embedding }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("Embedding generation error:", err);
          return new Response(
            JSON.stringify({ ok: false, error: err.message || "Failed to generate embedding" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
