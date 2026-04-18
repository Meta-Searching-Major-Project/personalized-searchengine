import { supabase } from "@/integrations/supabase/client";

/**
 * Triggers the update-learning-index edge function to process
 * feedback from a completed search session and update the
 * personalized document index.
 */
export async function updateLearningIndex(searchHistoryId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-learning-index`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ search_history_id: searchHistoryId })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Failed to update learning index:", text);
      throw new Error(`update-learning-index failed: ${text}`);
    }
  } catch (e) {
    console.error("Learning index update error:", e);
    throw e;
  }
}

/**
 * Triggers the compute-sqm edge function to calculate Spearman
 * rank-order correlation between engine rankings and the user's
 * preference ranking derived from implicit feedback.
 */
export async function computeSQM(searchHistoryId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compute-sqm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ search_history_id: searchHistoryId })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Failed to compute SQM:", text);
      throw new Error(`compute-sqm failed: ${text}`);
    }
  } catch (e) {
    console.error("SQM computation error:", e);
    throw e;
  }
}
