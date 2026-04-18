import { useRef, useCallback, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tracks 7 implicit feedback signals per the Beg & Ahmad (2007) paper:
 * V = click order (1/2^(v-1)), T = dwell time (t/t_max), P = print, S = save,
 * B = bookmark, E = email, C = copy-paste chars (c/c_total)
 *
 * Dwell time is primarily tracked by the Chrome extension for accuracy.
 * The visibilitychange fallback is used when the extension is not installed.
 */

interface ResultMeta {
  searchResultId: string;
  url: string;
}

export function useFeedbackTracker() {
  const { user, session } = useAuth();
  const clickCounter = useRef(0);
  const openTabs = useRef<Map<string, { clickOrder: number; openedAt: number }>>(new Map());
  const [hasExtension, setHasExtension] = useState(false);

  // Detect if the Chrome extension is installed
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PERSONASEARCH_PONG") {
        setHasExtension(true);
      }
    };
    window.addEventListener("message", handler);

    // Send a ping to check if extension is installed
    window.postMessage({ type: "PERSONASEARCH_PING" }, "*");

    return () => window.removeEventListener("message", handler);
  }, []);

  const resetSession = useCallback(() => {
    clickCounter.current = 0;
    openTabs.current.clear();
  }, []);

  /** Get the current auth token (used by SearchResultCard to pass to extension) */
  const getAuthToken = useCallback((): string => {
    return session?.access_token || "";
  }, [session]);

  /** Upsert a feedback row, merging new fields into existing record */
  const upsertFeedback = useCallback(
    async (searchResultId: string, fields: Record<string, unknown>) => {
      if (!user) return;

      // Check if feedback already exists
      const { data: existing } = await supabase
        .from("user_feedback")
        .select("id")
        .eq("search_result_id", searchResultId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_feedback")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_feedback").insert({
          search_result_id: searchResultId,
          user_id: user.id,
          ...fields,
        });
      }
    },
    [user],
  );

  /** V — record click order and open time for dwell tracking */
  const trackClick = useCallback(
    (meta: ResultMeta) => {
      clickCounter.current += 1;
      const clickOrder = clickCounter.current;
      openTabs.current.set(meta.searchResultId, {
        clickOrder,
        openedAt: Date.now(),
      });
      upsertFeedback(meta.searchResultId, { click_order: clickOrder });
    },
    [upsertFeedback],
  );

  /**
   * T — record dwell time when user returns from the opened page.
   * This is the FALLBACK method — used only when the Chrome extension
   * is not installed. The extension provides much more accurate tracking
   * by monitoring actual active tab time.
   */
  const trackDwell = useCallback(
    (searchResultId: string) => {
      // Skip if extension handles this (extension reports directly to track-dwell)
      if (hasExtension) return;

      const entry = openTabs.current.get(searchResultId);
      if (!entry) return;
      const dwellMs = Date.now() - entry.openedAt;
      openTabs.current.delete(searchResultId);

      // Only record if meaningful (> 1 second)
      if (dwellMs > 1000) {
        upsertFeedback(searchResultId, { dwell_time_ms: dwellMs });
      }
    },
    [upsertFeedback, hasExtension],
  );

  /** P — print */
  const trackPrint = useCallback(
    (searchResultId: string) => upsertFeedback(searchResultId, { printed: true }),
    [upsertFeedback],
  );

  /** S — save */
  const trackSave = useCallback(
    (searchResultId: string) => upsertFeedback(searchResultId, { saved: true }),
    [upsertFeedback],
  );

  /** B — bookmark */
  const trackBookmark = useCallback(
    (searchResultId: string) => upsertFeedback(searchResultId, { bookmarked: true }),
    [upsertFeedback],
  );

  /** E — email */
  const trackEmail = useCallback(
    (searchResultId: string) => upsertFeedback(searchResultId, { emailed: true }),
    [upsertFeedback],
  );

  /** C — copy-paste character count (additive) — fallback for when extension is not installed */
  const trackCopyPaste = useCallback(
    async (searchResultId: string, charCount: number) => {
      // Skip if extension handles this
      if (hasExtension) return;
      if (!user) return;

      const { data: existing } = await supabase
        .from("user_feedback")
        .select("id, copy_paste_chars")
        .eq("search_result_id", searchResultId)
        .eq("user_id", user.id)
        .maybeSingle();

      const prev = existing?.copy_paste_chars ?? 0;
      upsertFeedback(searchResultId, { copy_paste_chars: prev + charCount });
    },
    [user, upsertFeedback, hasExtension],
  );

  return {
    resetSession,
    trackClick,
    trackDwell,
    trackPrint,
    trackSave,
    trackBookmark,
    trackEmail,
    trackCopyPaste,
    getAuthToken,
    hasExtension,
  };
}
