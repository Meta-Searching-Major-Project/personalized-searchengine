import { supabase } from "@/integrations/supabase/client";

/**
 * Triggers the update-learning-index edge function to process
 * feedback from a completed search session and update the
 * personalized document index.
 */
export async function updateLearningIndex(searchHistoryId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("update-learning-index", {
      body: { search_history_id: searchHistoryId },
    });
    if (error) {
      console.error("Failed to update learning index:", error.message);
    }
  } catch (e) {
    console.error("Learning index update error:", e);
  }
}

/**
 * Triggers the compute-sqm edge function to calculate Spearman
 * rank-order correlation between engine rankings and the user's
 * preference ranking derived from implicit feedback.
 */
export async function computeSQM(searchHistoryId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("compute-sqm", {
      body: { search_history_id: searchHistoryId },
    });
    if (error) {
      console.error("Failed to compute SQM:", error.message);
    }
  } catch (e) {
    console.error("SQM computation error:", e);
  }
}
