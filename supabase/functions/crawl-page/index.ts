import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * crawl-page: Processes URLs from the crawl_queue, fetches page content,
 * extracts clean text, generates embeddings, and stores in web_pages.
 *
 * Accepts: { batch_size?: number }  (default 5)
 * Returns: { success: true, crawled: number, skipped: number, failed: number }
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 50_000; // max chars of extracted text to store
const CRAWL_DELAY_MS = 500;    // delay between fetches for politeness
const MAX_ATTEMPTS = 3;

const USER_AGENT =
  "Mozilla/5.0 (compatible; PersonaSearchBot/1.0; +https://personasearch.app)";

// ─── HTML to text extraction ────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function extractMetaDescription(html: string): string {
  const match = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );
  return match?.[1]?.trim() || "";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || "";
}

function htmlToText(html: string): string {
  let text = html;

  // Remove script, style, nav, header, footer elements entirely
  text = text.replace(
    /<(script|style|nav|header|footer|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  // Remove all HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&[a-zA-Z]+;/g, " ");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// ─── Content hashing ────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Embedding via generate-embedding ───────────────────────────────

async function generateEmbedding(
  supabaseUrl: string,
  serviceKey: string,
  text: string
): Promise<number[] | null> {
  try {
    // Truncate for embedding (model limit)
    const truncated = text.slice(0, 8000);
    const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: truncated, task_type: "RETRIEVAL_DOCUMENT" }),
    });
    if (!resp.ok) {
      console.error("Embedding failed:", resp.status);
      return null;
    }
    const data = await resp.json();
    return data.embedding || null;
  } catch (e) {
    console.error("Embedding error:", e);
    return null;
  }
}

// ─── Fetch with timeout ─────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let batchSize = 5;
    try {
      const body = await req.json();
      if (body.batch_size && typeof body.batch_size === "number") {
        batchSize = Math.min(Math.max(body.batch_size, 1), 10);
      }
    } catch {
      // No body or invalid JSON — use default batch size
    }

    // 1. Pull pending items from crawl_queue
    const { data: queueItems, error: queueError } = await supabase
      .from("crawl_queue")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (queueError) {
      throw new Error(`Queue fetch failed: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No items in crawl queue", crawled: 0, skipped: 0, failed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark items as processing
    const queueIds = queueItems.map((q) => q.id);
    await supabase
      .from("crawl_queue")
      .update({ status: "processing" })
      .in("id", queueIds);

    let crawled = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of queueItems) {
      try {
        const url = item.url;
        const domain = extractDomain(url);

        // 2. Check if already crawled with recent content
        const { data: existing } = await supabase
          .from("web_pages")
          .select("id, content_hash, last_crawled_at, crawl_count")
          .eq("url", url)
          .maybeSingle();

        // Skip if crawled within the last 30 days
        if (existing?.last_crawled_at) {
          const age = Date.now() - new Date(existing.last_crawled_at).getTime();
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          if (age < thirtyDays) {
            await supabase
              .from("crawl_queue")
              .update({ status: "done", processed_at: new Date().toISOString() })
              .eq("id", item.id);
            skipped++;
            continue;
          }
        }

        // 3. Fetch the page
        let response: Response;
        try {
          response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Fetch failed";
          console.error(`Fetch failed for ${url}:`, msg);
          await supabase
            .from("crawl_queue")
            .update({
              status: "failed",
              attempts: (item.attempts || 0) + 1,
              processed_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          // Still record the page with metadata from SerpApi
          if (!existing) {
            await supabase.from("web_pages").upsert(
              {
                url,
                domain,
                title: item.title || "",
                extracted_text: item.snippet || "",
                meta_description: item.snippet || "",
                crawl_status: "failed",
                error_message: msg,
                crawl_count: 0,
              },
              { onConflict: "url" }
            );
          }
          failed++;
          continue;
        }

        if (!response.ok) {
          console.warn(`HTTP ${response.status} for ${url}`);
          await supabase
            .from("crawl_queue")
            .update({
              status: response.status === 404 ? "done" : "failed",
              attempts: (item.attempts || 0) + 1,
              processed_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          failed++;
          continue;
        }

        // Only process HTML pages
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          await supabase
            .from("crawl_queue")
            .update({ status: "done", processed_at: new Date().toISOString() })
            .eq("id", item.id);
          skipped++;
          continue;
        }

        // 4. Extract content
        const html = await response.text();
        const title = extractTitle(html) || item.title || "";
        const metaDesc = extractMetaDescription(html) || item.snippet || "";
        let extractedText = htmlToText(html);

        // Truncate to save storage
        if (extractedText.length > MAX_TEXT_LENGTH) {
          extractedText = extractedText.slice(0, MAX_TEXT_LENGTH);
        }

        const wordCount = extractedText.split(/\s+/).filter(Boolean).length;

        // 5. Content hash for dedup
        const contentHash = await sha256(extractedText);

        // Skip embedding if content hasn't changed
        if (existing?.content_hash === contentHash) {
          await supabase
            .from("web_pages")
            .update({
              last_crawled_at: new Date().toISOString(),
              crawl_count: (existing.crawl_count || 0) + 1,
              crawl_status: "crawled",
            })
            .eq("id", existing.id);
          await supabase
            .from("crawl_queue")
            .update({ status: "done", processed_at: new Date().toISOString() })
            .eq("id", item.id);
          skipped++;
          continue;
        }

        // 6. Generate embedding
        const embeddingText = `${title} ${metaDesc} ${extractedText.slice(0, 6000)}`;
        const embedding = await generateEmbedding(supabaseUrl, serviceKey, embeddingText);

        // 7. Upsert into web_pages
        const pageData: Record<string, any> = {
          url,
          domain,
          title,
          extracted_text: extractedText,
          meta_description: metaDesc,
          content_hash: contentHash,
          word_count: wordCount,
          last_crawled_at: new Date().toISOString(),
          crawl_count: existing ? (existing.crawl_count || 0) + 1 : 1,
          crawl_status: "crawled",
          error_message: null,
        };

        if (embedding) {
          pageData.embedding = `[${embedding.join(",")}]`;
        }

        await supabase.from("web_pages").upsert(pageData, { onConflict: "url" });

        // 8. Mark queue entry as done
        await supabase
          .from("crawl_queue")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", item.id);

        crawled++;
        console.log(`Crawled: ${url} (${wordCount} words)`);

        // Politeness delay
        if (queueItems.indexOf(item) < queueItems.length - 1) {
          await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error(`Crawl error for ${item.url}:`, msg);
        await supabase
          .from("crawl_queue")
          .update({
            status: "failed",
            attempts: (item.attempts || 0) + 1,
            processed_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        failed++;
      }
    }

    // Reset failed items with remaining attempts back to pending for retry
    await supabase
      .from("crawl_queue")
      .update({ status: "pending" })
      .eq("status", "failed")
      .lt("attempts", MAX_ATTEMPTS);

    return new Response(
      JSON.stringify({ success: true, crawled, skipped, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("crawl-page error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
