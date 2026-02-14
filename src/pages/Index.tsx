import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";
import SearchResultCard from "@/components/SearchResultCard";
import EngineStatusBar from "@/components/EngineStatusBar";
import { multiSearch, type MergedResult, type EngineSummary } from "@/lib/api/search";
import { updateLearningIndex } from "@/lib/api/learningIndex";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFeedbackTracker } from "@/hooks/useFeedbackTracker";

export interface ResultWithId extends MergedResult {
  /** Maps engine name → search_results row id */
  resultIds: Record<string, string>;
}

const Index = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultWithId[]>([]);
  const [engineSummary, setEngineSummary] = useState<EngineSummary[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [queryTime, setQueryTime] = useState<number | undefined>();
  const [aggregationMethod, setAggregationMethod] = useState("borda");
  const [usedMethod, setUsedMethod] = useState<string | undefined>();
  const startTimeRef = useRef<number>(0);
  const prevHistoryIdRef = useRef<string | null>(null);

  const feedback = useFeedbackTracker();

  // Fetch user's preferred aggregation method
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("default_aggregation_method")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.default_aggregation_method) {
          setAggregationMethod(data.default_aggregation_method);
        }
      });
  }, [user]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || !user) return;

    setLoading(true);
    setResults([]);
    setEngineSummary([]);
    // Process previous session's feedback before starting new search
    if (prevHistoryIdRef.current) {
      updateLearningIndex(prevHistoryIdRef.current);
    }

    feedback.resetSession();
    startTimeRef.current = Date.now();

    try {
      const response = await multiSearch(trimmed, aggregationMethod);
      const elapsed = Date.now() - startTimeRef.current;
      setQueryTime(elapsed);
      setUsedMethod(response.aggregation_method);

      if (!response.success) {
        toast({
          title: "Search failed",
          description: response.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      const merged = response.merged || [];
      setEngineSummary(response.engineResults || []);
      setSearchedQuery(trimmed);

      // Persist search history and results, then map IDs back
      const { data: historyRow, error: historyError } = await supabase
        .from("search_history")
        .insert({ query: trimmed, user_id: user.id })
        .select("id")
        .single();

      if (historyError) {
        console.error("Failed to save search history:", historyError);
        // Still show results even if persistence fails
        prevHistoryIdRef.current = null;
        setResults(merged.map((m) => ({ ...m, resultIds: {} })));
        return;
      }

      if (historyRow && merged.length > 0) {
        prevHistoryIdRef.current = historyRow.id;
        const resultRows: {
          search_history_id: string;
          engine: string;
          original_rank: number;
          title: string;
          url: string;
          snippet: string | null;
          aggregated_rank: number;
        }[] = [];

        merged.forEach((m, aggIdx) => {
          m.engines.forEach((eng) => {
            resultRows.push({
              search_history_id: historyRow.id,
              engine: eng.engine,
              original_rank: eng.rank,
              title: m.title,
              url: m.url,
              snippet: m.snippet || null,
              aggregated_rank: aggIdx + 1,
            });
          });
        });

        const { data: insertedResults, error: resultsError } = await supabase
          .from("search_results")
          .insert(resultRows)
          .select("id, url, engine");

        if (resultsError) {
          console.error("Failed to save search results:", resultsError);
          setResults(merged.map((m) => ({ ...m, resultIds: {} })));
          return;
        }

        // Build a map: url → { engine → id }
        const idMap = new Map<string, Record<string, string>>();
        insertedResults?.forEach((r) => {
          if (!idMap.has(r.url)) idMap.set(r.url, {});
          idMap.get(r.url)![r.engine] = r.id;
        });

        setResults(
          merged.map((m) => ({
            ...m,
            resultIds: idMap.get(m.url) || {},
          })),
        );
      } else {
        setResults(merged.map((m) => ({ ...m, resultIds: {} })));
      }
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: "Could not connect to search service",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Process learning index on page unload for the last session
  useEffect(() => {
    const handleUnload = () => {
      if (prevHistoryIdRef.current) {
        // Fire-and-forget via sendBeacon fallback
        updateLearningIndex(prevHistoryIdRef.current);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const hasResults = results.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main
        className={`flex flex-col items-center px-4 transition-all ${
          hasResults ? "pt-6" : "justify-center"
        }`}
        style={{ minHeight: "calc(100vh - 3.5rem)" }}
      >
        <div className={`w-full ${hasResults ? "max-w-3xl" : "max-w-xl text-center"}`}>
          {!hasResults && (
            <>
              <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
                PersonaSearch
              </h1>
              <p className="mb-8 text-muted-foreground">
                Personalized multi-engine search with intelligent rank aggregation
              </p>
            </>
          )}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the web..."
                className="pl-10"
                autoFocus
                disabled={loading}
              />
            </div>
            <Button type="submit" disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
            </Button>
          </form>

          {!hasResults && !loading && (
            <p className="mt-4 text-xs text-muted-foreground">
              Aggregates results from Google, Bing &amp; DuckDuckGo using fuzzy rank
              aggregation
            </p>
          )}

          {loading && (
            <div className="mt-12 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Querying Google, Bing &amp; DuckDuckGo in parallel…
              </p>
            </div>
          )}

          {hasResults && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  Results for &ldquo;{searchedQuery}&rdquo;
                </p>
              </div>
              <EngineStatusBar
                engines={engineSummary}
                totalResults={results.length}
                queryTime={queryTime}
                aggregationMethod={usedMethod}
              />
              <div className="space-y-2 pb-8">
                {results.map((result, i) => (
                  <SearchResultCard
                    key={result.url}
                    result={result}
                    index={i}
                    feedback={feedback}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
