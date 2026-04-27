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
  cached?: boolean;
}

export interface RichBlocks {
  weather?: any;
  dictionary?: any;
  images?: any[];
  knowledge_graph?: any;
  answer_box?: any;
}

export interface SearchResponse {
  success: boolean;
  query?: string;
  aggregation_method?: string;
  query_intent?: string;
  merged?: MergedResult[];
  engineResults?: EngineSummary[];
  richBlocks?: RichBlocks;
  error?: string;
}

export async function multiSearch(
  query: string,
  aggregationMethod: string = "borda",
  preferredEngines: string[] = []
): Promise<SearchResponse> {
  const { data, error } = await supabase.functions.invoke("multi-search", {
    body: { query, aggregation_method: aggregationMethod, preferred_engines: preferredEngines },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data as SearchResponse;
}
