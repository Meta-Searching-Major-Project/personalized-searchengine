import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * track-dwell: REST endpoint for the Chrome extension to report
 * dwell time (T), page size, and copy-paste (C) data.
 *
 * Accepts: { search_result_id, dwell_time_ms, page_size_bytes?, copy_paste_chars? }
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the user's token by attaching the Auth header
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { search_result_id, dwell_time_ms, page_size_bytes, copy_paste_chars } =
      await req.json();

    if (!search_result_id || !dwell_time_ms) {
      return new Response(
        JSON.stringify({ error: "search_result_id and dwell_time_ms required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if feedback row already exists
    const { data: existing } = await supabase
      .from("user_feedback")
      .select("id, dwell_time_ms, copy_paste_chars")
      .eq("search_result_id", search_result_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const updateFields: Record<string, unknown> = {
      dwell_time_ms: dwell_time_ms,
      updated_at: new Date().toISOString(),
    };

    if (page_size_bytes && page_size_bytes > 0) {
      updateFields.page_size_bytes = page_size_bytes;
    }

    if (copy_paste_chars && copy_paste_chars > 0) {
      // Accumulate copy-paste chars (extension may report multiple times)
      const prevChars = existing?.copy_paste_chars ?? 0;
      updateFields.copy_paste_chars = prevChars + copy_paste_chars;
    }

    if (existing) {
      // If extension reports a longer dwell time, take the max
      // (in case both extension and web fallback report)
      if (existing.dwell_time_ms && existing.dwell_time_ms > dwell_time_ms) {
        updateFields.dwell_time_ms = existing.dwell_time_ms;
      }

      await supabase
        .from("user_feedback")
        .update(updateFields)
        .eq("id", existing.id);
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
