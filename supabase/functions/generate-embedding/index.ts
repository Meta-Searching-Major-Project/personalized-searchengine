import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generates a 768-dimensional embedding for a given text using Lovable AI (Gemini Flash).
 * Uses tool calling to extract a structured numeric vector from the model.
 *
 * Accepts: { text: string } or { texts: string[] }
 * Returns: { embedding: number[] } or { embeddings: number[][] }
 */

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `You are an embedding generator. Given text, produce a 768-dimensional unit-normalized embedding vector that captures the semantic meaning. Call the store_embedding function with the vector. Focus on topical/semantic content, not style.`,
        },
        {
          role: "user",
          content: `Generate a semantic embedding for: "${text.slice(0, 2000)}"`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "store_embedding",
            description: "Store the generated embedding vector",
            parameters: {
              type: "object",
              properties: {
                vector: {
                  type: "array",
                  items: { type: "number" },
                  description: "768-dimensional unit-normalized embedding vector",
                },
              },
              required: ["vector"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "store_embedding" } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No tool call in AI response");
  }

  const args = JSON.parse(toolCall.function.arguments);
  let vector: number[] = args.vector;

  // Validate and normalize
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Invalid vector from AI");
  }

  // Pad or truncate to 768
  if (vector.length < 768) {
    vector = [...vector, ...new Array(768 - vector.length).fill(0)];
  } else if (vector.length > 768) {
    vector = vector.slice(0, 768);
  }

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    vector = vector.map((v) => v / norm);
  }

  return vector;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Single text
    if (body.text && typeof body.text === "string") {
      const embedding = await generateEmbedding(body.text, LOVABLE_API_KEY);
      return new Response(JSON.stringify({ embedding }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Multiple texts
    if (body.texts && Array.isArray(body.texts)) {
      const embeddings: number[][] = [];
      for (const text of body.texts.slice(0, 20)) {
        const embedding = await generateEmbedding(text, LOVABLE_API_KEY);
        embeddings.push(embedding);
      }
      return new Response(JSON.stringify({ embeddings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Provide 'text' or 'texts' field" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-embedding error:", error);
    const status = (error as any)?.message?.includes("429") ? 429 :
                   (error as any)?.message?.includes("402") ? 402 : 500;
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
