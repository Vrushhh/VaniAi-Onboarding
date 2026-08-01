import { createFileRoute } from "@tanstack/react-router";
import pdfParse from "pdf-parse";

function splitTextIntoChunks(text: string, minSize = 500, maxSize = 800): string[] {
  // Replace multiple line breaks with single newlines
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n\n");
  
  // Split into paragraphs first
  const paragraphs = normalizedText.split("\n\n");
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // If adding this paragraph exceeds maxSize, we push the current chunk (if not empty)
    if (currentChunk.length + trimmed.length + 2 > maxSize) {
      if (currentChunk.length >= minSize) {
        chunks.push(currentChunk);
        currentChunk = trimmed;
      } else {
        // If currentChunk is too small but adding trimmed overflows maxSize, 
        // we split trimmed by sentences.
        const sentences = trimmed.match(/[^.!?]+[.!?]+(\s|$)/g) || [trimmed];
        for (const sent of sentences) {
          const trimmedSent = sent.trim();
          if (!trimmedSent) continue;
          if (currentChunk.length + trimmedSent.length + 1 > maxSize) {
            if (currentChunk.length > 0) {
              chunks.push(currentChunk);
            }
            currentChunk = trimmedSent;
          } else {
            currentChunk = currentChunk ? `${currentChunk} ${trimmedSent}` : trimmedSent;
          }
        }
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export const Route = createFileRoute("/api/knowledge/upload-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const orgId = formData.get("orgId") as string;
          const name = formData.get("name") as string;
          const file = formData.get("file") as File;

          if (!orgId || !name || !file) {
            return new Response(
              JSON.stringify({ ok: false, error: "Missing required fields: orgId, name, or file." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // 1. Create a knowledge source record
          const { data: source, error: sourceErr } = await supabaseAdmin
            .from("knowledge_sources" as any)
            .insert({
              org_id: orgId,
              name: name,
              status: "processing",
            })
            .select("id")
            .single();

          if (sourceErr || !source) {
            throw new Error(`Failed to create knowledge source: ${sourceErr?.message}`);
          }

          const sourceId = (source as any).id;

          // 2. Upload file to Supabase storage
          const filePath = `${orgId}/${sourceId}/${file.name}`;
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const { error: uploadErr } = await supabaseAdmin.storage
            .from("knowledge-docs")
            .upload(filePath, buffer, {
              contentType: file.type,
              upsert: true,
            });

          if (uploadErr) {
            // Update source status to failed
            await supabaseAdmin
              .from("knowledge_sources" as any)
              .update({ status: "failed", error_message: uploadErr.message })
              .eq("id", sourceId);
            throw new Error(`Failed to upload document: ${uploadErr.message}`);
          }

          // Update file_path in source
          await supabaseAdmin
            .from("knowledge_sources" as any)
            .update({ file_path: filePath })
            .eq("id", sourceId);

          // 3. Extract text
          let text = "";
          try {
            if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
              const pdfParseModule: any = (await import("pdf-parse")).default || (await import("pdf-parse"));
              const pdfData = await pdfParseModule(buffer);
              text = pdfData.text;
            } else {
              text = new TextDecoder("utf-8").decode(arrayBuffer);
            }
          } catch (err: any) {
            await supabaseAdmin
              .from("knowledge_sources" as any)
              .update({ status: "failed", error_message: `Text extraction failed: ${err.message}` })
              .eq("id", sourceId);
            throw err;
          }

          if (!text.trim()) {
            await supabaseAdmin
              .from("knowledge_sources" as any)
              .update({ status: "failed", error_message: "Document does not contain extractable text." })
              .eq("id", sourceId);
            throw new Error("No text found in file.");
          }

          // 4. Chunk text (500-800 characters)
          const chunks = splitTextIntoChunks(text);
          if (chunks.length === 0) {
            await supabaseAdmin
              .from("knowledge_sources" as any)
              .update({ status: "failed", error_message: "No valid text chunks could be extracted." })
              .eq("id", sourceId);
            throw new Error("No chunks generated.");
          }

          // 5. Generate embeddings via Voyage AI
          const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
          if (!VOYAGE_API_KEY) {
            throw new Error("Missing VOYAGE_API_KEY environment variable. Document cannot be embedded.");
          }

          const embeddings: number[][] = [];
          const batchSize = 32;

          for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const res = await fetch("https://api.voyageai.com/v1/embeddings", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${VOYAGE_API_KEY}`,
              },
              body: JSON.stringify({
                input: batch,
                model: "voyage-3-lite",
              }),
            });

            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`Voyage AI API error: ${errText}`);
            }

            const resJson = await res.json();
            const batchEmbeddings = resJson.data.map((item: any) => item.embedding);
            embeddings.push(...batchEmbeddings);
          }

          // 6. Save chunks to knowledge_chunks
          const rowsToInsert = chunks.map((chunk, index) => ({
            source_id: sourceId,
            org_id: orgId,
            content: chunk,
            embedding: embeddings[index],
          }));

          const { error: chunkErr } = await supabaseAdmin
            .from("knowledge_chunks" as any)
            .insert(rowsToInsert);

          if (chunkErr) {
            throw new Error(`Failed to save chunks: ${chunkErr.message}`);
          }

          // 7. Update source status to ready
          await supabaseAdmin
            .from("knowledge_sources" as any)
            .update({ status: "ready" })
            .eq("id", sourceId);

          return new Response(JSON.stringify({ ok: true, sourceId }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("Document ingestion error:", err);
          return new Response(
            JSON.stringify({ ok: false, error: err.message || "Failed to process document." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
