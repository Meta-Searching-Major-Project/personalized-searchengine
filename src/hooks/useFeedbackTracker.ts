import { useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tracks 7 implicit feedback signals per the Beg & Ahmad (2007) paper:
 * V = click order, T = dwell time, P = print, S = save,
 * B = bookmark, E = email, C = copy-paste chars
 */

interface ResultMeta {
  searchResultId: string;
  url: string;
}

export function useFeedbackTracker() {
  const { user } = useAuth();
  const clickCounter = useRef(0);
  const openTabs = useRef<Map<string, { clickOrder: number; openedAt: number }>>(new Map());

  const resetSession = useCallback(() => {
    clickCounter.current = 0;
    openTabs.current.clear();
  }, []);

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

  /** T — record dwell time when user returns from the opened page */
  const trackDwell = useCallback(
    (searchResultId: string) => {
      const entry = openTabs.current.get(searchResultId);
      if (!entry) return;
      const dwellMs = Date.now() - entry.openedAt;
      openTabs.current.delete(searchResultId);
      upsertFeedback(searchResultId, { dwell_time_ms: dwellMs });
    },
    [upsertFeedback],
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

  /** C — copy-paste character count (additive) */
  const trackCopyPaste = useCallback(
    async (searchResultId: string, charCount: number) => {
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
    [user, upsertFeedback],
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
  };
}
