import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * track-dwell: REST endpoint for the Chrome extension to report
 * dwell time (T), page size, copy-paste (C), and extended feedback signals.
 *
 * Accepts: {
 *   search_result_id, dwell_time_ms,
 *   page_size_bytes?, copy_paste_chars?,
 *   scroll_depth?, highlight_count?, hover_time_ms?,
 *   quick_bounce?, repeat_visit?
 * }
 * Auth: Bearer token from the signed-in user
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase   = createClient(supabaseUrl, serviceKey);

    // Verify token via Auth REST API (avoids local ES256 key issues)
    const authResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: anonKey },
    });

    if (!authResp.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = await authResp.json();
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      search_result_id,
      dwell_time_ms,
      page_size_bytes,
      copy_paste_chars,
      scroll_depth,
      highlight_count,
      hover_time_ms,
      quick_bounce,
      repeat_visit,
    } = body;

    if (!search_result_id || !dwell_time_ms) {
      return new Response(
        JSON.stringify({ error: "search_result_id and dwell_time_ms required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if feedback row already exists
    const { data: existing } = await supabase
      .from("user_feedback")
      .select("id, dwell_time_ms, copy_paste_chars")
      .eq("search_result_id", search_result_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const updateFields: Record<string, unknown> = {
      // Take max dwell time (extension may report multiple times; web fallback also reports)
      dwell_time_ms: existing?.dwell_time_ms && existing.dwell_time_ms > dwell_time_ms
        ? existing.dwell_time_ms
        : dwell_time_ms,
      updated_at: new Date().toISOString(),
    };

    if (page_size_bytes  && page_size_bytes  > 0) updateFields.page_size_bytes = page_size_bytes;
    if (copy_paste_chars && copy_paste_chars > 0) {
      // Accumulate: extension may report copy events incrementally
      updateFields.copy_paste_chars = (existing?.copy_paste_chars ?? 0) + copy_paste_chars;
    }

    // Extended signals — store if provided
    if (scroll_depth   !== undefined) updateFields.scroll_depth   = scroll_depth;
    if (highlight_count !== undefined) updateFields.highlight_count = highlight_count;
    if (hover_time_ms  !== undefined) updateFields.hover_time_ms  = hover_time_ms;
    if (quick_bounce   !== undefined) updateFields.quick_bounce   = quick_bounce;
    if (repeat_visit   !== undefined) updateFields.repeat_visit   = repeat_visit;

    if (existing) {
      await supabase.from("user_feedback").update(updateFields).eq("id", existing.id);
    } else {
      await supabase.from("user_feedback").insert({
        search_result_id,
        user_id: user.id,
        ...updateFields,
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("track-dwell error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
