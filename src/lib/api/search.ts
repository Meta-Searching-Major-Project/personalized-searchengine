import { supabase } from "@/integrations/supabase/client";

export interface EngineRank {
  engine: string;
  rank: number;
}

export interface MergedResult {
  url: string;
  title: string;
  snippet: string;
  engines: EngineRank[];
}

export interface EngineSummary {
  engine: string;
  count: number;
  error?: string;
}

export interface SearchResponse {
  success: boolean;
  query?: string;
  merged?: MergedResult[];
  engineResults?: EngineSummary[];
  error?: string;
}

export async function multiSearch(query: string): Promise<SearchResponse> {
  const { data, error } = await supabase.functions.invoke("multi-search", {
    body: { query },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data as SearchResponse;
}
